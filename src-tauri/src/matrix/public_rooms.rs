use super::*;

#[tauri::command]
pub async fn mx_preview_public_room(
    state: State<'_, Matrix>,
    id_or_alias: String,
    via: Vec<String>,
) -> Result<MxPublicRoom, String> {
    let session = current(&state)?;
    let target = RoomOrAliasId::parse(&id_or_alias).map_err(err)?;
    let servers = via
        .iter()
        .map(|name| name.parse().map_err(err))
        .collect::<Result<Vec<_>, _>>()?;
    let preview = session
        .client
        .get_room_preview(&target, servers)
        .await
        .map_err(err)?;
    Ok(MxPublicRoom {
        id: preview.room_id.to_string(),
        name: preview
            .name
            .or_else(|| {
                preview
                    .canonical_alias
                    .as_ref()
                    .map(|alias| alias.to_string())
            })
            .unwrap_or(id_or_alias),
        topic: preview.topic,
        avatar_url: preview.avatar_url.map(|url| url.to_string()),
        member_count: preview.num_joined_members,
        joined: preview.state == Some(RoomState::Joined),
        can_join: matches!(preview.join_rule.as_ref(), Some(JoinRuleSummary::Public)),
        can_request_join: matches!(
            preview.join_rule.as_ref(),
            Some(JoinRuleSummary::Knock | JoinRuleSummary::KnockRestricted(_))
        ),
    })
}

#[tauri::command]
pub async fn mx_join_public_room(
    state: State<'_, Matrix>,
    id_or_alias: String,
    via: Vec<String>,
) -> Result<String, String> {
    let session = current(&state)?;
    let target = RoomOrAliasId::parse(&id_or_alias).map_err(err)?;
    let servers = via
        .iter()
        .map(|name| name.parse().map_err(err))
        .collect::<Result<Vec<_>, _>>()?;
    session
        .client
        .join_room_by_id_or_alias(&target, &servers)
        .await
        .map(|room| room.room_id().to_string())
        .map_err(err)
}

#[tauri::command]
pub async fn mx_knock_public_room(
    state: State<'_, Matrix>,
    id_or_alias: String,
    via: Vec<String>,
) -> Result<(), String> {
    let session = current(&state)?;
    let target = RoomOrAliasId::parse(&id_or_alias).map_err(err)?;
    let servers = via
        .iter()
        .map(|name| name.parse().map_err(err))
        .collect::<Result<Vec<_>, _>>()?;
    session
        .client
        .knock(target, None, servers)
        .await
        .map(|_| ())
        .map_err(err)
}
