use super::*;

impl Session {
    pub(super) fn room(&self, id: &str) -> Result<Room, String> {
        let room_id = RoomId::parse(id).map_err(err)?;
        self.client
            .get_room(&room_id)
            .ok_or_else(|| format!("Unknown room {id}"))
    }

    pub(super) async fn to_mx_room(&self, room: &Room) -> Option<(MxRoom, Option<OwnedEventId>)> {
        if room.is_space() {
            return None;
        }
        let membership = match room.state() {
            RoomState::Joined => "joined",
            RoomState::Invited => "invited",
            RoomState::Left => "left",
            RoomState::Knocked => "knocked",
            RoomState::Banned => "banned",
        };
        let joined = membership == "joined";
        let name = match room.display_name().await.ok()? {
            matrix_sdk::RoomDisplayName::Named(n)
            | matrix_sdk::RoomDisplayName::Aliased(n)
            | matrix_sdk::RoomDisplayName::Calculated(n)
            | matrix_sdk::RoomDisplayName::EmptyWas(n) => n,
            matrix_sdk::RoomDisplayName::Empty => String::new(),
        };
        // A bridge's bot sits in every room it bridges and declares itself a service member.
        let service_members = room
            .update_active_service_members()
            .await
            .ok()
            .flatten()
            .map_or(0, |members| members.len() as u64);
        let is_dm = room.is_direct().await.unwrap_or(false)
            && room.active_members_count().saturating_sub(service_members) <= 2;
        let power = if joined {
            room.power_levels().await.ok()
        } else {
            None
        };
        let broadcast = !is_dm
            && power.as_ref().is_some_and(|levels| {
                levels.for_message(MessageLikeEventType::RoomMessage) > levels.users_default
            });
        let can_send = joined
            && power.as_ref().is_none_or(|levels| {
                levels.user_can_send_message(room.own_user_id(), MessageLikeEventType::RoomMessage)
            });
        let own = room.own_user_id();
        let can_pin = joined
            && power.as_ref().is_none_or(|levels| {
                levels.user_can_send_state(own, StateEventType::RoomPinnedEvents)
            });
        let can_delete_others = joined
            && power
                .as_ref()
                .is_some_and(|levels| levels.user_can_redact_event_of_other(own));
        let peer = is_dm
            .then(|| {
                room.direct_targets()
                    .into_iter()
                    .find_map(|target| target.as_user_id().map(|id| id.to_string()))
            })
            .flatten();
        let heroes = room
            .heroes()
            .await
            .into_iter()
            .map(|hero| hero.user_id.to_string())
            .collect();
        let (self_role, latest) = if joined {
            let (role, latest) = futures_util::join!(
                room.get_suggested_user_role(room.own_user_id()),
                RoomExt::latest_event(room)
            );
            (role.map(role_str).unwrap_or("member"), preview_of(latest))
        } else {
            ("member", None)
        };
        let inviter = if membership == "invited" {
            room.invite_details()
                .await
                .ok()
                .and_then(|invite| invite.inviter.map(|m| m.user_id().to_string()))
        } else {
            None
        };
        let latest_id = joined.then(|| (**room).latest_event().event_id()).flatten();
        Some((
            MxRoom {
                id: room.room_id().to_string(),
                name,
                topic: room.topic(),
                avatar_url: room.avatar_url().map(|url| url.to_string()),
                canonical_alias: room.canonical_alias().map(|alias| alias.to_string()),
                member_count: room.active_members_count(),
                is_dm,
                broadcast,
                can_send,
                peer,
                membership,
                heroes,
                self_role,
                inviter,
                latest,
                unread_count: room.num_unread_messages(),
                mention_count: room.num_unread_mentions(),
                marked_unread: room.is_marked_unread(),
                can_pin,
                can_delete_others,
                send_level: power
                    .as_ref()
                    .map(|levels| levels.for_message(MessageLikeEventType::RoomMessage).into()),
                default_level: power.as_ref().map(|levels| levels.users_default.into()),
            },
            latest_id,
        ))
    }
}

pub(super) fn role_str(role: matrix_sdk::room::RoomMemberRole) -> &'static str {
    use matrix_sdk::room::RoomMemberRole;
    match role {
        RoomMemberRole::Creator => "owner",
        RoomMemberRole::Administrator | RoomMemberRole::Moderator => "admin",
        RoomMemberRole::User => "member",
    }
}

#[tauri::command]
pub async fn mx_room(state: State<'_, Matrix>, id: String) -> Result<Option<MxRoom>, String> {
    let session = current(&state)?;
    match session.room(&id) {
        Ok(room) => Ok(session.to_mx_room(&room).await.map(|(room, _)| room)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub async fn mx_members(
    state: State<'_, Matrix>,
    room_id: String,
) -> Result<Vec<MxMember>, String> {
    let session = current(&state)?;
    let members = session
        .room(&room_id)?
        .members(RoomMemberships::JOIN)
        .await
        .map_err(err)?;
    Ok(members
        .into_iter()
        .map(|member| MxMember {
            user_id: member.user_id().to_string(),
            display_name: member.display_name().map(str::to_string),
            role: role_str(member.suggested_role_for_power_level()),
            power_level: match member.power_level() {
                UserPowerLevel::Int(level) => Some(level.into()),
                _ => None,
            },
        })
        .collect())
}

#[tauri::command]
pub async fn mx_profile(
    state: State<'_, Matrix>,
    user_id: String,
) -> Result<Option<MxProfile>, String> {
    let session = current(&state)?;
    let user = UserId::parse(&user_id).map_err(err)?;
    match session.client.account().fetch_user_profile_of(&user).await {
        Ok(profile) => Ok(Some(MxProfile {
            user_id,
            display_name: profile
                .data
                .get("displayname")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        })),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub async fn mx_create_dm(state: State<'_, Matrix>, user_id: String) -> Result<String, String> {
    let session = current(&state)?;
    let user = UserId::parse(&user_id).map_err(err)?;
    let room = session.client.create_dm(&user).await.map_err(err)?;
    Ok(room.room_id().to_string())
}

#[tauri::command]
pub async fn mx_create_room(
    state: State<'_, Matrix>,
    user_ids: Vec<String>,
    name: String,
) -> Result<String, String> {
    let session = current(&state)?;
    let mut request = create_room::v3::Request::new();
    request.name = Some(name);
    request.invite = user_ids
        .iter()
        .map(|id| UserId::parse(id).map_err(err))
        .collect::<Result<_, _>>()?;
    request.preset = Some(create_room::v3::RoomPreset::PrivateChat);
    request.initial_state = vec![InitialStateEvent::new(
        EmptyStateKey,
        RoomEncryptionEventContent::with_recommended_defaults(),
    )
    .to_raw_any()];
    let room = session.client.create_room(request).await.map_err(err)?;
    Ok(room.room_id().to_string())
}

#[tauri::command]
pub async fn mx_invite(
    state: State<'_, Matrix>,
    room_id: String,
    user_id: String,
) -> Result<(), String> {
    let session = current(&state)?;
    let user = UserId::parse(&user_id).map_err(err)?;
    session
        .room(&room_id)?
        .invite_user_by_id(&user)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn mx_kick(
    state: State<'_, Matrix>,
    room_id: String,
    user_id: String,
) -> Result<(), String> {
    let session = current(&state)?;
    let user = UserId::parse(&user_id).map_err(err)?;
    session
        .room(&room_id)?
        .kick_user(&user, None)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn mx_ban(
    state: State<'_, Matrix>,
    room_id: String,
    user_id: String,
) -> Result<(), String> {
    let session = current(&state)?;
    let user = UserId::parse(&user_id).map_err(err)?;
    session
        .room(&room_id)?
        .ban_user(&user, None)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn mx_set_power_level(
    state: State<'_, Matrix>,
    room_id: String,
    user_id: String,
    level: i64,
) -> Result<(), String> {
    let session = current(&state)?;
    let user = UserId::parse(&user_id).map_err(err)?;
    let level = Int::new(level).ok_or("That power level is out of range.")?;
    session
        .room(&room_id)?
        .update_power_levels(vec![(&user, level)])
        .await
        .map(|_| ())
        .map_err(err)
}

#[tauri::command]
pub async fn mx_set_name(
    state: State<'_, Matrix>,
    room_id: String,
    name: String,
) -> Result<(), String> {
    let session = current(&state)?;
    session
        .room(&room_id)?
        .set_name(name)
        .await
        .map(|_| ())
        .map_err(err)
}

#[tauri::command]
pub async fn mx_join(state: State<'_, Matrix>, room_id: String) -> Result<(), String> {
    let session = current(&state)?;
    session.room(&room_id)?.join().await.map_err(err)
}

#[tauri::command]
pub async fn mx_leave(state: State<'_, Matrix>, room_id: String) -> Result<(), String> {
    let session = current(&state)?;
    session.room(&room_id)?.leave().await.map_err(err)
}

#[tauri::command]
pub async fn mx_ignore(
    state: State<'_, Matrix>,
    user_id: String,
    ignored: bool,
) -> Result<(), String> {
    let session = current(&state)?;
    let user = UserId::parse(&user_id).map_err(err)?;
    if ignored {
        session
            .client
            .account()
            .ignore_user(&user)
            .await
            .map_err(err)
    } else {
        session
            .client
            .account()
            .unignore_user(&user)
            .await
            .map_err(err)
    }
}
