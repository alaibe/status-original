//! Matrix through matrix-rust-sdk, the crate behind Element X. The page
//! drives it the way the phone drives the same crate's uniffi bindings: one
//! client at a time, rooms from the sliding-sync room list, and a room's
//! messages from an SDK timeline that stays live for the most recently
//! opened rooms. Updates reach the page as `matrix://update` events.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{stream, StreamExt};
use matrix_sdk::attachment::{
    AttachmentConfig, AttachmentInfo, BaseAudioInfo, BaseFileInfo, BaseImageInfo,
};
use matrix_sdk::authentication::matrix::MatrixSession;
use matrix_sdk::encryption::EncryptionSettings;
use matrix_sdk::media::{MediaFormat, MediaRequestParameters};
use matrix_sdk::room::reply::{EnforceThread, Reply};
use matrix_sdk::ruma::api::client::receipt::create_receipt::v3::ReceiptType;
use matrix_sdk::ruma::api::client::room::create_room;
use matrix_sdk::ruma::events::room::encryption::RoomEncryptionEventContent;
use matrix_sdk::ruma::events::room::message::{
    AddMentions, MessageType, RoomMessageEventContent, RoomMessageEventContentWithoutRelation,
    TextMessageEventContent,
};
use matrix_sdk::ruma::events::{EmptyStateKey, InitialStateEvent, StateEventContentChange};
use matrix_sdk::ruma::{EventId, OwnedEventId, OwnedRoomId, RoomId, UserId};
use matrix_sdk::sliding_sync::{Version as SlidingSyncVersion, VersionBuilder};
use matrix_sdk::{
    AuthSession, Client, Room, RoomMemberships, RoomState, SessionChange, SessionMeta,
    SessionTokens,
};
use matrix_sdk_ui::eyeball_im::{Vector, VectorDiff};
use matrix_sdk_ui::room_list_service::filters::{
    new_filter_all, new_filter_non_left, new_filter_not, new_filter_space,
};
use matrix_sdk_ui::sync_service::SyncService;
use matrix_sdk_ui::timeline::{
    AnyOtherStateEventContentChange, EventSendState, LatestEventValue, MembershipChange,
    MsgLikeKind, RoomExt, Timeline, TimelineDetails, TimelineEventItemId, TimelineItem,
    TimelineItemContent, TimelineReadReceiptTracking,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use tokio::task::JoinHandle;

use crate::paths::remove_dir;

const ROOM_PAGE: usize = 500;
const HISTORY_PAGE: u16 = 40;
const LIVE_TIMELINES: usize = 16;
const ANNOUNCE_CONCURRENCY: usize = 8;
const UPDATE_EVENT: &str = "matrix://update";

// ---- wire types, mirrored in src/protocols/matrix/api.ts ----

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MxSession {
    access_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    refresh_token: Option<String>,
    user_id: String,
    device_id: String,
    homeserver_url: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartParams {
    data_directory: String,
    store_passphrase: String,
    homeserver_url: String,
    user_id: String,
    device_name: String,
    session: Option<MxSession>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MxRoom {
    id: String,
    name: String,
    is_dm: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    peer: Option<String>,
    membership: &'static str,
    heroes: Vec<String>,
    self_role: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    inviter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    latest: Option<MxPreview>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MxMember {
    user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    role: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MxProfile {
    user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct MxReaction {
    key: String,
    senders: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MxPreview {
    sender: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sender_name: Option<String>,
    timestamp: u64,
    is_own: bool,
    content: MxContent,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MxEvent {
    id: String,
    room_id: String,
    #[serde(flatten)]
    preview: MxPreview,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reactions: Option<Vec<MxReaction>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MxMediaOut {
    source: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MxContent {
    Text {
        body: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        msgtype: Option<&'static str>,
    },
    Image {
        #[serde(flatten)]
        media: MxMediaOut,
        #[serde(skip_serializing_if = "Option::is_none")]
        width: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        height: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        caption: Option<String>,
    },
    File {
        #[serde(flatten)]
        media: MxMediaOut,
        #[serde(skip_serializing_if = "Option::is_none")]
        caption: Option<String>,
    },
    Audio {
        #[serde(flatten)]
        media: MxMediaOut,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        voice: bool,
    },
    Video,
    Sticker {
        body: String,
    },
    Poll {
        question: String,
    },
    Location,
    Redacted,
    Undecryptable,
    Membership {
        change: &'static str,
        user: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        user_name: Option<String>,
    },
    State {
        change: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MxOutgoing {
    Text {
        body: String,
    },
    Image {
        path: String,
        mime_type: Option<String>,
        width: Option<u64>,
        height: Option<u64>,
        size: Option<u64>,
        caption: Option<String>,
    },
    File {
        path: String,
        name: String,
        mime_type: Option<String>,
        size: Option<u64>,
    },
    Voice {
        path: String,
        duration_ms: u64,
        mime_type: Option<String>,
        size: Option<u64>,
    },
}

#[derive(Deserialize)]
pub struct MxMedia {
    source: String,
    name: String,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum MxUpdate {
    Room {
        room: MxRoom,
    },
    #[serde(rename_all = "camelCase")]
    RoomGone {
        room_id: String,
    },
    Event {
        event: MxEvent,
    },
    SignedOut,
}

// ---- the client ----

struct LiveTimeline {
    timeline: Arc<Timeline>,
    task: JoinHandle<()>,
}

struct Session {
    app: AppHandle,
    client: Client,
    params: StartParams,
    sync: Mutex<Option<Arc<SyncService>>>,
    tasks: Mutex<Vec<JoinHandle<()>>>,
    latest_seen: Mutex<HashMap<OwnedRoomId, u64>>,
    /// Most recently used last.
    live: tokio::sync::Mutex<Vec<(OwnedRoomId, Arc<LiveTimeline>)>>,
}

#[derive(Default)]
pub struct Matrix(Mutex<Option<Arc<Session>>>);

fn current(state: &State<Matrix>) -> Result<Arc<Session>, String> {
    state
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No Matrix client".to_string())
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

impl Session {
    fn emit(&self, update: MxUpdate) {
        let _ = self.app.emit(UPDATE_EVENT, &update);
    }

    fn data_directory(&self) -> PathBuf {
        PathBuf::from(&self.params.data_directory)
    }

    fn session(&self) -> Result<MxSession, String> {
        match self.client.session() {
            Some(AuthSession::Matrix(session)) => Ok(MxSession {
                access_token: session.tokens.access_token,
                refresh_token: session.tokens.refresh_token,
                user_id: session.meta.user_id.to_string(),
                device_id: session.meta.device_id.to_string(),
                homeserver_url: self.client.homeserver().to_string(),
            }),
            _ => Err("The client has no session".to_string()),
        }
    }

    // ---- sync ----

    async fn start_sync(self: &Arc<Self>) -> Result<(), String> {
        if matches!(self.client.sliding_sync_version(), SlidingSyncVersion::None) {
            return Err(
                "This homeserver does not support sliding sync (MSC4186), which the app needs."
                    .to_string(),
            );
        }
        let session = self.clone();
        self.tasks.lock().unwrap().push(tokio::spawn(async move {
            let mut changes = session.client.subscribe_to_session_changes();
            while let Ok(change) = changes.recv().await {
                if let SessionChange::UnknownToken { .. } = change {
                    session.emit(MxUpdate::SignedOut);
                }
            }
        }));

        let sync = Arc::new(
            SyncService::builder(self.client.clone())
                .build()
                .await
                .map_err(err)?,
        );
        let room_list = sync.room_list_service().all_rooms().await.map_err(err)?;
        let session = self.clone();
        let service = sync.room_list_service();
        self.tasks.lock().unwrap().push(tokio::spawn(async move {
            let (diffs, controller) = room_list.entries_with_dynamic_adapters(ROOM_PAGE);
            controller.set_filter(Box::new(new_filter_all(vec![
                Box::new(new_filter_non_left()),
                Box::new(new_filter_not(Box::new(new_filter_space()))),
            ])));
            // Any change the SDK considers notable shows up here as a `Set`, so nothing else needs watching.
            let mut entries: Vector<Room> = Vector::new();
            let mut subscribed: HashSet<OwnedRoomId> = HashSet::new();
            futures_util::pin_mut!(diffs);
            while let Some(batch) = diffs.next().await {
                let mut touched: HashMap<OwnedRoomId, Room> = HashMap::new();
                let mut grew = false;
                for diff in batch {
                    let diff = diff.map(|item| item.into_inner());
                    grew |= matches!(diff, VectorDiff::Append { .. } | VectorDiff::Reset { .. });
                    let changed = changed_by(&diff);
                    // A `Set` or `Reset` brings fresh handles for the same rooms; only rooms that left the list are gone.
                    for room in removed_by(&entries, &diff) {
                        if changed.iter().any(|kept| kept.room_id() == room.room_id()) {
                            continue;
                        }
                        touched.remove(room.room_id());
                        session.emit(MxUpdate::RoomGone {
                            room_id: room.room_id().to_string(),
                        });
                    }
                    for room in changed {
                        touched.insert(room.room_id().to_owned(), room);
                    }
                    diff.apply(&mut entries);
                }
                // The SDK only computes a room's latest event once it is subscribed to, as a list in view would be.
                let fresh: Vec<OwnedRoomId> = touched
                    .keys()
                    .filter(|id| subscribed.insert((*id).clone()))
                    .cloned()
                    .collect();
                if !fresh.is_empty() {
                    service
                        .set_room_subscriptions(
                            &fresh.iter().map(|id| id.as_ref()).collect::<Vec<_>>(),
                        )
                        .await;
                }
                stream::iter(touched.into_values())
                    .for_each_concurrent(ANNOUNCE_CONCURRENCY, |room| {
                        let session = session.clone();
                        async move { session.announce(&room).await }
                    })
                    .await;
                if grew && !entries.is_empty() && entries.len() % ROOM_PAGE == 0 {
                    controller.add_one_page();
                }
            }
        }));
        sync.start().await;
        *self.sync.lock().unwrap() = Some(sync);
        Ok(())
    }

    async fn stop_sync(&self) {
        for (_, live) in self.live.lock().await.drain(..) {
            live.task.abort();
        }
        for task in self.tasks.lock().unwrap().drain(..) {
            task.abort();
        }
        let sync = self.sync.lock().unwrap().take();
        if let Some(sync) = sync {
            sync.stop().await;
        }
    }

    async fn announce(self: &Arc<Self>, room: &Room) {
        let Some((mapped, latest_id)) = self.to_mx_room(room).await else {
            return;
        };
        let preview = mapped.latest.clone();
        let joined = mapped.membership == "joined";
        self.emit(MxUpdate::Room { room: mapped });

        let (Some(preview), true) = (preview, joined) else {
            return;
        };
        let id = room.room_id().to_owned();
        let seen = {
            let mut seen = self.latest_seen.lock().unwrap();
            let previous = seen.get(&id).copied();
            if previous.is_some_and(|p| p >= preview.timestamp) {
                return;
            }
            seen.insert(id.clone(), preview.timestamp);
            previous
        };
        // A live timeline already reported it; otherwise the latest event stands in, with its real id.
        if seen.is_none() || self.touch_live(&id).await.is_some() {
            return;
        }
        if let Some(event_id) = latest_id {
            self.emit(MxUpdate::Event {
                event: MxEvent {
                    id: event_id.to_string(),
                    room_id: id.to_string(),
                    preview,
                    status: "sent",
                    reply_to: None,
                    reactions: None,
                },
            });
        }
    }

    // ---- rooms ----

    fn room(&self, id: &str) -> Result<Room, String> {
        let room_id = RoomId::parse(id).map_err(err)?;
        self.client
            .get_room(&room_id)
            .ok_or_else(|| format!("Unknown room {id}"))
    }

    /// The room for the page, plus the id of its latest event when the SDK has one.
    async fn to_mx_room(&self, room: &Room) -> Option<(MxRoom, Option<OwnedEventId>)> {
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
                is_dm,
                peer,
                membership,
                heroes,
                self_role,
                inviter,
                latest,
            },
            latest_id,
        ))
    }

    // ---- timelines ----

    async fn live_timeline(
        self: &Arc<Self>,
        room_id: &RoomId,
    ) -> Result<Arc<LiveTimeline>, String> {
        if let Some(existing) = self.touch_live(room_id).await {
            return Ok(existing);
        }
        // Built without holding the lock: the SDK may need the sync tasks, which also announce rooms.
        let room = self.room(room_id.as_str())?;
        // The app shows no receipts, and tracking them re-emits every message whenever one moves.
        let timeline = Arc::new(
            room.timeline_builder()
                .track_read_marker_and_receipts(TimelineReadReceiptTracking::Disabled)
                .build()
                .await
                .map_err(err)?,
        );
        let (_, stream) = timeline.subscribe().await;
        let session = self.clone();
        let id = room_id.to_owned();
        let task = tokio::spawn(async move {
            futures_util::pin_mut!(stream);
            while let Some(diffs) = stream.next().await {
                for diff in diffs {
                    // New or changed items only; bulk loads are what `messages` reads.
                    let item = match diff {
                        VectorDiff::PushBack { value } | VectorDiff::Set { value, .. } => value,
                        _ => continue,
                    };
                    if let Some(event) = to_mx_event(&id, &item) {
                        session
                            .latest_seen
                            .lock()
                            .unwrap()
                            .insert(id.clone(), event.preview.timestamp);
                        session.emit(MxUpdate::Event { event });
                    }
                }
            }
        });
        let entry = Arc::new(LiveTimeline { timeline, task });

        let mut live = self.live.lock().await;
        if let Some(existing) = live
            .iter()
            .find(|(id, _)| id == room_id)
            .map(|(_, live)| live.clone())
        {
            entry.task.abort();
            return Ok(existing);
        }
        live.push((room_id.to_owned(), entry.clone()));
        while live.len() > LIVE_TIMELINES {
            let (_, dropped) = live.remove(0);
            dropped.task.abort();
        }
        Ok(entry)
    }

    /// Marks a live timeline as most recently used and returns it.
    async fn touch_live(&self, room_id: &RoomId) -> Option<Arc<LiveTimeline>> {
        let mut live = self.live.lock().await;
        let index = live.iter().position(|(id, _)| id == room_id)?;
        let entry = live.remove(index);
        let timeline = entry.1.clone();
        live.push(entry);
        Some(timeline)
    }

    async fn messages(
        self: &Arc<Self>,
        room_id: &RoomId,
        limit: usize,
        before: Option<&str>,
    ) -> Result<Vec<MxEvent>, String> {
        let live = self.live_timeline(room_id).await?;
        loop {
            let items = live.timeline.items().await;
            let end = match before {
                Some(id) => items.iter().position(|item| {
                    item.as_event()
                        .and_then(|e| e.event_id())
                        .is_some_and(|e| e == id)
                }),
                None => Some(items.len()),
            };
            if let Some(end) = end {
                let mut page: Vec<MxEvent> = items
                    .iter()
                    .take(end)
                    .filter_map(|item| to_mx_event(room_id, item))
                    .collect();
                if page.len() >= limit {
                    page.drain(..page.len() - limit);
                    return Ok(page);
                }
                let short = limit - page.len();
                let hit_start = live
                    .timeline
                    .paginate_backwards(HISTORY_PAGE.max(short as u16))
                    .await
                    .map_err(err)?;
                if hit_start {
                    return Ok(page);
                }
            } else {
                let hit_start = live
                    .timeline
                    .paginate_backwards(HISTORY_PAGE)
                    .await
                    .map_err(err)?;
                if hit_start {
                    return Ok(Vec::new());
                }
            }
        }
    }

    // ---- sending ----

    /// Straight to the homeserver, so a rejection rejects here; the echo brings the event id.
    async fn send(
        &self,
        room_id: &RoomId,
        content: MxOutgoing,
        reply_to: Option<String>,
    ) -> Result<(), String> {
        let room = self.room(room_id.as_str())?;
        let reply_to = reply_to
            .map(|id| EventId::parse(id).map_err(err))
            .transpose()?;
        match content {
            MxOutgoing::Text { body } => match reply_to {
                Some(event_id) => {
                    let content = room
                        .make_reply_event(
                            RoomMessageEventContentWithoutRelation::text_plain(body),
                            reply(event_id),
                        )
                        .await
                        .map_err(err)?;
                    room.send(content).await.map_err(err)?;
                }
                None => {
                    room.send(RoomMessageEventContent::text_plain(body))
                        .await
                        .map_err(err)?;
                }
            },
            other => {
                let (name, mime, data, info, caption) = attachment(other).await?;
                let config = AttachmentConfig::new()
                    .info(info)
                    .caption(caption.map(TextMessageEventContent::plain))
                    .reply(reply_to.map(reply));
                room.send_attachment(name, &mime, data, config)
                    .await
                    .map_err(err)?;
            }
        }
        Ok(())
    }

    // ---- media ----

    async fn media(&self, media: MxMedia) -> Result<String, String> {
        let dir = self.data_directory().join("media");
        let digest = format!("{:x}", Sha256::digest(media.source.as_bytes()));
        let path = dir.join(format!("{}{}", &digest[..32], extension_of(&media.name)));
        if !path.exists() {
            let source = serde_json::from_str(&media.source).map_err(err)?;
            let request = MediaRequestParameters {
                source,
                format: MediaFormat::File,
            };
            // The file is the cache; the SDK's own would hold a second copy.
            let bytes = self
                .client
                .media()
                .get_media_content(&request, false)
                .await
                .map_err(err)?;
            tokio::fs::create_dir_all(&dir).await.map_err(err)?;
            tokio::fs::write(&path, bytes).await.map_err(err)?;
        }
        Ok(path.to_string_lossy().into_owned())
    }
}

/// The rooms a diff brings in or changes.
fn changed_by(diff: &VectorDiff<Room>) -> Vec<Room> {
    match diff {
        VectorDiff::Append { values } | VectorDiff::Reset { values } => {
            values.iter().cloned().collect()
        }
        VectorDiff::PushFront { value } | VectorDiff::PushBack { value } => vec![value.clone()],
        VectorDiff::Insert { value, .. } | VectorDiff::Set { value, .. } => vec![value.clone()],
        _ => Vec::new(),
    }
}

/// The rooms a diff takes out of the list, read before it is applied.
fn removed_by(entries: &Vector<Room>, diff: &VectorDiff<Room>) -> Vec<Room> {
    let at = |index: usize| entries.get(index).cloned().into_iter().collect::<Vec<_>>();
    match diff {
        VectorDiff::Clear | VectorDiff::Reset { .. } => entries.iter().cloned().collect(),
        VectorDiff::PopFront => at(0),
        VectorDiff::PopBack => entries.len().checked_sub(1).map(at).unwrap_or_default(),
        VectorDiff::Remove { index } => at(*index),
        VectorDiff::Set { index, .. } => at(*index),
        VectorDiff::Truncate { length } => entries.iter().skip(*length).cloned().collect(),
        _ => Vec::new(),
    }
}

// ---- mapping ----

fn reply(event_id: OwnedEventId) -> Reply {
    Reply {
        event_id,
        enforce_thread: EnforceThread::MaybeThreaded,
        add_mentions: AddMentions::Yes,
    }
}

fn preview_of(latest: LatestEventValue) -> Option<MxPreview> {
    let (timestamp, sender, is_own, profile, content) = match latest {
        LatestEventValue::Remote {
            timestamp,
            sender,
            is_own,
            profile,
            content,
        } => (timestamp, sender, is_own, profile, content),
        LatestEventValue::Local {
            timestamp,
            sender,
            profile,
            content,
            ..
        } => (timestamp, sender, true, profile, content),
        _ => return None,
    };
    Some(MxPreview {
        sender: sender.to_string(),
        sender_name: name_of(&profile),
        timestamp: timestamp.0.into(),
        is_own,
        content: map_content(&content)?,
    })
}

/// Local echoes and events the app never shows are skipped; our own sends surface once the homeserver has them.
fn to_mx_event(room_id: &RoomId, item: &TimelineItem) -> Option<MxEvent> {
    let event = item.as_event()?;
    let event_id = event.event_id()?;
    let content = map_content(event.content())?;
    let msg_like = match event.content() {
        TimelineItemContent::MsgLike(msg) => Some(msg),
        _ => None,
    };
    let reactions: Vec<MxReaction> = msg_like
        .map(|m| {
            m.reactions
                .iter()
                .map(|(key, senders)| MxReaction {
                    key: key.clone(),
                    senders: senders.keys().map(|user| user.to_string()).collect(),
                })
                .collect()
        })
        .unwrap_or_default();
    Some(MxEvent {
        id: event_id.to_string(),
        room_id: room_id.to_string(),
        preview: MxPreview {
            sender: event.sender().to_string(),
            sender_name: name_of(event.sender_profile()),
            timestamp: event.timestamp().0.into(),
            is_own: event.is_own(),
            content,
        },
        status: match event.send_state() {
            None | Some(EventSendState::Sent { .. }) => "sent",
            Some(EventSendState::SendingFailed { .. }) => "failed",
            Some(EventSendState::NotSentYet { .. }) => "sending",
        },
        reply_to: msg_like.and_then(|m| m.in_reply_to.as_ref().map(|r| r.event_id.to_string())),
        reactions: (!reactions.is_empty()).then_some(reactions),
    })
}

fn name_of(profile: &TimelineDetails<matrix_sdk_ui::timeline::Profile>) -> Option<String> {
    match profile {
        TimelineDetails::Ready(profile) => profile.display_name.clone(),
        _ => None,
    }
}

fn media_of(
    source: &matrix_sdk::ruma::events::room::MediaSource,
    name: &str,
    mime_type: Option<&str>,
    size: Option<matrix_sdk::ruma::UInt>,
) -> MxMediaOut {
    MxMediaOut {
        source: serde_json::to_string(source).unwrap_or_default(),
        name: name.to_string(),
        mime_type: mime_type.map(str::to_string),
        size: size.map(Into::into),
    }
}

/// None for events the app never shows, so they never count as messages.
fn map_content(content: &TimelineItemContent) -> Option<MxContent> {
    match content {
        TimelineItemContent::MsgLike(msg) => match &msg.kind {
            MsgLikeKind::Message(message) => map_message(message.msgtype()),
            MsgLikeKind::Sticker(sticker) => Some(MxContent::Sticker {
                body: sticker.content().body.clone(),
            }),
            MsgLikeKind::Poll(poll) => Some(MxContent::Poll {
                question: poll.results().question,
            }),
            MsgLikeKind::Redacted => Some(MxContent::Redacted),
            MsgLikeKind::UnableToDecrypt(_) => Some(MxContent::Undecryptable),
            MsgLikeKind::LiveLocation(_) => Some(MxContent::Location),
            MsgLikeKind::Other(_) => None,
        },
        TimelineItemContent::MembershipChange(change) => {
            let change_str = match change.change()? {
                MembershipChange::Joined | MembershipChange::InvitationAccepted => "joined",
                MembershipChange::Left => "left",
                MembershipChange::Invited => "invited",
                MembershipChange::Kicked | MembershipChange::KickedAndBanned => "kicked",
                MembershipChange::Banned => "banned",
                MembershipChange::Unbanned => "unbanned",
                MembershipChange::InvitationRejected => "invitationRejected",
                MembershipChange::InvitationRevoked => "invitationRevoked",
                _ => return None,
            };
            Some(MxContent::Membership {
                change: change_str,
                user: change.user_id().to_string(),
                user_name: change.display_name(),
            })
        }
        TimelineItemContent::OtherState(state) => {
            let (change, value) = match state.content() {
                AnyOtherStateEventContentChange::RoomName(c) => (
                    "name",
                    match c {
                        StateEventContentChange::Original { content, .. } => {
                            Some(content.name.clone()).filter(|n| !n.is_empty())
                        }
                        StateEventContentChange::Redacted(_) => None,
                    },
                ),
                AnyOtherStateEventContentChange::RoomTopic(c) => (
                    "topic",
                    match c {
                        StateEventContentChange::Original { content, .. } => {
                            Some(content.topic.clone())
                        }
                        StateEventContentChange::Redacted(_) => None,
                    },
                ),
                AnyOtherStateEventContentChange::RoomAvatar(_) => ("avatar", None),
                AnyOtherStateEventContentChange::RoomCreate(_) => ("created", None),
                AnyOtherStateEventContentChange::RoomEncryption(_) => ("encryption", None),
                _ => return None,
            };
            Some(MxContent::State { change, value })
        }
        _ => None,
    }
}

fn map_message(msgtype: &MessageType) -> Option<MxContent> {
    Some(match msgtype {
        MessageType::Text(t) => MxContent::Text {
            body: t.body.clone(),
            msgtype: None,
        },
        MessageType::Notice(n) => MxContent::Text {
            body: n.body.clone(),
            msgtype: Some("notice"),
        },
        MessageType::Emote(e) => MxContent::Text {
            body: e.body.clone(),
            msgtype: Some("emote"),
        },
        MessageType::Image(i) => MxContent::Image {
            media: media_of(
                &i.source,
                i.filename(),
                i.info.as_ref().and_then(|info| info.mimetype.as_deref()),
                i.info.as_ref().and_then(|info| info.size),
            ),
            width: i.info.as_ref().and_then(|info| info.width).map(Into::into),
            height: i.info.as_ref().and_then(|info| info.height).map(Into::into),
            caption: i.caption().map(str::to_string),
        },
        MessageType::File(f) => MxContent::File {
            media: media_of(
                &f.source,
                f.filename(),
                f.info.as_ref().and_then(|info| info.mimetype.as_deref()),
                f.info.as_ref().and_then(|info| info.size),
            ),
            caption: f.caption().map(str::to_string),
        },
        MessageType::Audio(a) => MxContent::Audio {
            media: media_of(
                &a.source,
                a.filename(),
                a.info.as_ref().and_then(|info| info.mimetype.as_deref()),
                a.info.as_ref().and_then(|info| info.size),
            ),
            duration_ms: a
                .info
                .as_ref()
                .and_then(|info| info.duration)
                .or_else(|| a.audio.as_ref().map(|audio| audio.duration))
                .map(|d| d.as_millis() as u64),
            voice: a.voice.is_some(),
        },
        MessageType::Video(_) => MxContent::Video,
        MessageType::Location(_) => MxContent::Location,
        _ => return None,
    })
}

fn role_str(role: matrix_sdk::room::RoomMemberRole) -> &'static str {
    use matrix_sdk::room::RoomMemberRole;
    match role {
        RoomMemberRole::Creator => "owner",
        RoomMemberRole::Administrator | RoomMemberRole::Moderator => "admin",
        RoomMemberRole::User => "member",
    }
}

/// The page names files itself; the SDK would otherwise use the path's basename.
async fn attachment(
    content: MxOutgoing,
) -> Result<(String, mime::Mime, Vec<u8>, AttachmentInfo, Option<String>), String> {
    let parse = |mime_type: Option<String>, fallback: &str| -> Result<mime::Mime, String> {
        mime_type
            .unwrap_or_else(|| fallback.to_string())
            .parse::<mime::Mime>()
            .map_err(err)
    };
    let basename = |path: &str| {
        Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    };
    match content {
        MxOutgoing::Image {
            path,
            mime_type,
            width,
            height,
            size,
            caption,
        } => Ok((
            basename(&path),
            parse(mime_type, "image/jpeg")?,
            tokio::fs::read(&path).await.map_err(err)?,
            AttachmentInfo::Image(BaseImageInfo {
                width: width.map(uint),
                height: height.map(uint),
                size: size.map(uint),
                ..Default::default()
            }),
            caption,
        )),
        MxOutgoing::File {
            path,
            name,
            mime_type,
            size,
        } => Ok((
            name,
            parse(mime_type, "application/octet-stream")?,
            tokio::fs::read(&path).await.map_err(err)?,
            AttachmentInfo::File(BaseFileInfo {
                size: size.map(uint),
            }),
            None,
        )),
        MxOutgoing::Voice {
            path,
            duration_ms,
            mime_type,
            size,
        } => Ok((
            basename(&path),
            parse(mime_type, "audio/mp4")?,
            tokio::fs::read(&path).await.map_err(err)?,
            AttachmentInfo::Voice(BaseAudioInfo {
                duration: Some(Duration::from_millis(duration_ms)),
                size: size.map(uint),
                waveform: None,
            }),
            None,
        )),
        MxOutgoing::Text { .. } => Err("Not an attachment".to_string()),
    }
}

fn uint(value: u64) -> matrix_sdk::ruma::UInt {
    matrix_sdk::ruma::UInt::new(value).unwrap_or(matrix_sdk::ruma::UInt::MAX)
}

fn extension_of(name: &str) -> String {
    match Path::new(name).extension().and_then(|ext| ext.to_str()) {
        Some(ext) if ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()) => {
            format!(".{}", ext.to_ascii_lowercase())
        }
        _ => String::new(),
    }
}

// ---- commands ----

async fn build_session(app: AppHandle, params: StartParams) -> Result<Arc<Session>, String> {
    let data_directory = PathBuf::from(&params.data_directory);
    // A store only makes sense with its session; without one it belongs to a device that is gone.
    if params.session.is_none() {
        remove_dir(&data_directory)?;
    }
    std::fs::create_dir_all(&data_directory).map_err(err)?;
    let client = Client::builder()
        .homeserver_url(&params.homeserver_url)
        .sqlite_store(data_directory.join("store"), Some(&params.store_passphrase))
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
pub async fn mx_room(state: State<'_, Matrix>, id: String) -> Result<Option<MxRoom>, String> {
    let session = current(&state)?;
    match session.room(&id) {
        Ok(room) => Ok(session.to_mx_room(&room).await.map(|(room, _)| room)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub async fn mx_messages(
    state: State<'_, Matrix>,
    room_id: String,
    limit: usize,
    before: Option<String>,
) -> Result<Vec<MxEvent>, String> {
    let session = current(&state)?;
    let room_id = RoomId::parse(&room_id).map_err(err)?;
    session.messages(&room_id, limit, before.as_deref()).await
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

#[tauri::command]
pub async fn mx_send(
    state: State<'_, Matrix>,
    room_id: String,
    content: MxOutgoing,
    reply_to: Option<String>,
) -> Result<(), String> {
    let session = current(&state)?;
    let room_id = RoomId::parse(&room_id).map_err(err)?;
    session.send(&room_id, content, reply_to).await
}

#[tauri::command]
pub async fn mx_toggle_reaction(
    state: State<'_, Matrix>,
    room_id: String,
    event_id: String,
    key: String,
) -> Result<(), String> {
    let session = current(&state)?;
    let room_id = RoomId::parse(&room_id).map_err(err)?;
    let event_id: OwnedEventId = EventId::parse(&event_id).map_err(err)?;
    let live = session.live_timeline(&room_id).await?;
    live.timeline
        .toggle_reaction(&TimelineEventItemId::EventId(event_id), &key)
        .await
        .map(|_| ())
        .map_err(err)
}

#[tauri::command]
pub async fn mx_mark_read(state: State<'_, Matrix>, room_id: String) -> Result<(), String> {
    let session = current(&state)?;
    let room_id = RoomId::parse(&room_id).map_err(err)?;
    let live = session.live_timeline(&room_id).await?;
    live.timeline
        .mark_as_read(ReceiptType::Read)
        .await
        .map(|_| ())
        .map_err(err)
}

#[tauri::command]
pub async fn mx_media(state: State<'_, Matrix>, media: MxMedia) -> Result<String, String> {
    let session = current(&state)?;
    session.media(media).await
}

async fn take(state: &State<'_, Matrix>) -> Option<PathBuf> {
    let session = state.0.lock().unwrap().take()?;
    session.stop_sync().await;
    Some(session.data_directory())
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
