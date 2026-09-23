use super::*;

pub(super) async fn build_session(
    app: AppHandle,
    params: StartParams,
) -> Result<Arc<Session>, String> {
    let data_directory = PathBuf::from(&params.data_directory);
    // A store only makes sense with its session; without one it belongs to a device that is gone.
    if params.session.is_none() {
        remove_dir(&data_directory)?;
    }
    std::fs::create_dir_all(&data_directory).map_err(err)?;
    let client = Client::builder()
        .homeserver_url(&params.homeserver_url)
        // The default pool is four connections per physical core for each of four
        // databases, which alone exhausts macOS's 256 open files on a large Mac.
        .sqlite_store_with_config_and_cache_path(
            SqliteStoreConfig::new(data_directory.join("store"))
                .passphrase(Some(&params.store_passphrase))
                .pool_max_size(4),
            None::<PathBuf>,
        )
        .sliding_sync_version_builder(VersionBuilder::DiscoverNative)
        .with_encryption_settings(EncryptionSettings {
            auto_enable_cross_signing: true,
            ..Default::default()
        })
        .build()
        .await
        .map_err(err)?;
    Ok(Arc::new(Session {
        app,
        client,
        params,
        sync: Mutex::new(None),
        tasks: Mutex::new(Vec::new()),
        latest_seen: Mutex::new(HashMap::new()),
        live: tokio::sync::Mutex::new(Vec::new()),
    }))
}

#[tauri::command]
pub async fn mx_start(
    app: AppHandle,
    state: State<'_, Matrix>,
    params: StartParams,
) -> Result<Option<MxSession>, String> {
    let previous = state.0.lock().unwrap().take();
    if let Some(previous) = previous {
        previous.stop_sync().await;
    }
    let session = build_session(app, params).await?;
    *state.0.lock().unwrap() = Some(session.clone());

    let Some(saved) = session.params.session.clone() else {
        return Ok(None);
    };
    session
        .client
        .restore_session(MatrixSession {
            meta: SessionMeta {
                user_id: UserId::parse(&saved.user_id).map_err(err)?,
                device_id: saved.device_id.into(),
            },
            tokens: SessionTokens {
                access_token: saved.access_token,
                refresh_token: saved.refresh_token,
            },
        })
        .await
        .map_err(err)?;
    session.start_sync().await?;
    Ok(Some(session.session()?))
}

#[tauri::command]
pub async fn mx_login(state: State<'_, Matrix>, password: String) -> Result<MxSession, String> {
    let session = current(&state)?;
    session
        .client
        .matrix_auth()
        .login_username(&session.params.user_id, &password)
        .initial_device_display_name(&session.params.device_name)
        .await
        .map_err(err)?;
    session.start_sync().await?;
    session.session()
}

#[tauri::command]
pub async fn mx_logout(state: State<'_, Matrix>) -> Result<(), String> {
    let session = current(&state)?;
    session.stop_sync().await;
    session.client.logout().await.map_err(err)
}

#[tauri::command]
pub async fn mx_close(state: State<'_, Matrix>) -> Result<(), String> {
    take(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn mx_erase(state: State<'_, Matrix>) -> Result<(), String> {
    match take(&state).await {
        Some(dir) => remove_dir(&dir),
        None => Ok(()),
    }
}
