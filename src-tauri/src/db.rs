//! One SQLCipher connection per database file, addressed by name. The
//! JavaScript side serialises its own work per account, so plain
//! `BEGIN`/`COMMIT` statements over `db_exec` are real transactions.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::paths::{data_dir, safe_component};

type Shared = Arc<Mutex<Connection>>;

#[derive(Default)]
pub struct Databases(Mutex<HashMap<String, Shared>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    changes: usize,
    last_insert_row_id: i64,
}

#[derive(Serialize)]
pub struct Rows {
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
}

fn database_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    safe_component(name, "database name")?;
    Ok(data_dir(app, "databases")?.join(name))
}

fn to_sql(value: Value) -> Result<SqlValue, String> {
    Ok(match value {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(b as i64),
        Value::Number(n) => match (n.as_i64(), n.as_f64()) {
            (Some(i), _) => SqlValue::Integer(i),
            (None, Some(f)) => SqlValue::Real(f),
            _ => return Err(format!("Unsupported number: {n}")),
        },
        Value::String(s) => SqlValue::Text(s),
        other => return Err(format!("Unsupported bind value: {other}")),
    })
}

fn from_sql(value: ValueRef) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::Array(b.iter().map(|x| Value::from(*x)).collect()),
    }
}

fn bind(params: Vec<Value>) -> Result<Vec<SqlValue>, String> {
    params.into_iter().map(to_sql).collect()
}

fn connection(dbs: &State<Databases>, name: &str) -> Result<Shared, String> {
    let open = dbs.0.lock().map_err(|e| e.to_string())?;
    open.get(name)
        .cloned()
        .ok_or_else(|| format!("Database {name} is not open."))
}

/// SQL blocks, so it runs off the async runtime, holding only its own connection.
async fn query<T: Send + 'static>(
    conn: Shared,
    work: impl FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        work(&conn).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Closes now when nothing else holds the connection; otherwise it closes
/// with its last user.
fn close_named(open: &mut HashMap<String, Shared>, name: &str) -> Result<(), String> {
    if let Some(shared) = open.remove(name) {
        if let Ok(mutex) = Arc::try_unwrap(shared) {
            let conn = mutex.into_inner().map_err(|e| e.to_string())?;
            conn.close().map_err(|(_, e)| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn db_open(
    app: AppHandle,
    dbs: State<'_, Databases>,
    name: String,
) -> Result<(), String> {
    let path = database_path(&app, &name)?;
    let mut open = dbs.0.lock().map_err(|e| e.to_string())?;
    if open.contains_key(&name) {
        return Ok(());
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    open.insert(name, Arc::new(Mutex::new(conn)));
    Ok(())
}

#[tauri::command]
pub async fn db_exec(dbs: State<'_, Databases>, name: String, sql: String) -> Result<(), String> {
    query(connection(&dbs, &name)?, move |conn| {
        conn.execute_batch(&sql)
    })
    .await
}

#[tauri::command]
pub async fn db_run(
    dbs: State<'_, Databases>,
    name: String,
    sql: String,
    params: Vec<Value>,
) -> Result<RunResult, String> {
    let params = bind(params)?;
    query(connection(&dbs, &name)?, move |conn| {
        let changes = conn
            .prepare_cached(&sql)?
            .execute(params_from_iter(params))?;
        Ok(RunResult {
            changes,
            last_insert_row_id: conn.last_insert_rowid(),
        })
    })
    .await
}

#[tauri::command]
pub async fn db_all(
    dbs: State<'_, Databases>,
    name: String,
    sql: String,
    params: Vec<Value>,
) -> Result<Rows, String> {
    let params = bind(params)?;
    query(connection(&dbs, &name)?, move |conn| {
        let mut stmt = conn.prepare_cached(&sql)?;
        let columns: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
        let mut cursor = stmt.query(params_from_iter(params))?;
        let mut rows = Vec::new();
        while let Some(row) = cursor.next()? {
            rows.push(
                (0..columns.len())
                    .map(|i| row.get_ref(i).map(from_sql))
                    .collect::<rusqlite::Result<_>>()?,
            );
        }
        Ok(Rows { columns, rows })
    })
    .await
}

#[tauri::command]
pub async fn db_close(dbs: State<'_, Databases>, name: String) -> Result<(), String> {
    let mut open = dbs.0.lock().map_err(|e| e.to_string())?;
    close_named(&mut open, &name)
}

#[tauri::command]
pub async fn db_delete(
    app: AppHandle,
    dbs: State<'_, Databases>,
    name: String,
) -> Result<(), String> {
    let path = database_path(&app, &name)?;
    {
        let mut open = dbs.0.lock().map_err(|e| e.to_string())?;
        close_named(&mut open, &name)?;
    }
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let file = PathBuf::from(format!("{}{suffix}", path.display()));
        match std::fs::remove_file(&file) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}
