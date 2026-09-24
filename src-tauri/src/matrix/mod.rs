use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{stream, StreamExt};
use matrix_sdk::attachment::{
    AttachmentConfig, AttachmentInfo, BaseAudioInfo, BaseFileInfo, BaseImageInfo, BaseVideoInfo,
};
use matrix_sdk::authentication::matrix::MatrixSession;
use matrix_sdk::encryption::EncryptionSettings;
use matrix_sdk::event_handler::EventHandlerDropGuard;
use matrix_sdk::media::{MediaFormat, MediaRequestParameters};
use matrix_sdk::room::reply::{EnforceThread, Reply};
use matrix_sdk::ruma::api::client::receipt::create_receipt::v3::ReceiptType;
use matrix_sdk::ruma::api::client::room::create_room;
use matrix_sdk::ruma::events::poll::start::PollKind;
use matrix_sdk::ruma::events::poll::unstable_response::UnstablePollResponseEventContent;
use matrix_sdk::ruma::events::poll::unstable_start::{
    NewUnstablePollStartEventContent, UnstablePollAnswer, UnstablePollAnswers,
    UnstablePollStartContentBlock,
};
use matrix_sdk::ruma::events::room::encryption::RoomEncryptionEventContent;
use matrix_sdk::ruma::events::room::message::{
    AddMentions, FormattedBody, MessageFormat, MessageType, ReplacementMetadata, ReplyWithinThread,
    RoomMessageEventContentWithoutRelation, TextMessageEventContent,
};
use matrix_sdk::ruma::events::room::power_levels::UserPowerLevel;
use matrix_sdk::ruma::events::{
    EmptyStateKey, InitialStateEvent, Mentions, MessageLikeEventType, StateEventContentChange,
    StateEventType,
};
use matrix_sdk::ruma::room::JoinRuleSummary;
use matrix_sdk::ruma::{EventId, Int, OwnedEventId, OwnedRoomId, RoomId, RoomOrAliasId, UserId};
use matrix_sdk::sliding_sync::{Version as SlidingSyncVersion, VersionBuilder};
use matrix_sdk::{
    AuthSession, Client, Room, RoomMemberships, RoomState, SessionChange, SessionMeta,
    SessionTokens, SqliteStoreConfig,
};
use matrix_sdk_ui::eyeball_im::{Vector, VectorDiff};
use matrix_sdk_ui::room_list_service::filters::{
    new_filter_all, new_filter_non_left, new_filter_not, new_filter_space,
};
use matrix_sdk_ui::sync_service::SyncService;
use matrix_sdk_ui::timeline::{
    AnyOtherStateEventContentChange, EventSendState, LatestEventValue, MembershipChange,
    MsgLikeKind, RoomExt, Timeline, TimelineDetails, TimelineEventItemId, TimelineFocus,
    TimelineItem, TimelineItemContent, TimelineReadReceiptTracking,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use tokio::task::JoinHandle;

use crate::paths::remove_dir;

mod lifecycle;
mod map;
mod media;
mod polls;
mod public_rooms;
mod rooms;
mod send;
mod sync;
mod timeline;

pub use lifecycle::*;
use map::*;
pub use media::*;
pub use polls::*;
pub use public_rooms::*;
pub use rooms::*;
pub use send::*;
pub use timeline::*;

const ROOM_PAGE: usize = 500;

const HISTORY_PAGE: u16 = 40;

const LIVE_TIMELINES: usize = 16;

const ANNOUNCE_CONCURRENCY: usize = 8;

const UPDATE_EVENT: &str = "matrix://update";

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
    #[serde(skip_serializing_if = "Option::is_none")]
    topic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    canonical_alias: Option<String>,
    member_count: u64,
    is_dm: bool,
    broadcast: bool,
    can_send: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    peer: Option<String>,
    membership: &'static str,
    heroes: Vec<String>,
    self_role: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    inviter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    latest: Option<MxPreview>,
    unread_count: u64,
    mention_count: u64,
    marked_unread: bool,
    can_pin: bool,
    can_delete_others: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    send_level: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_level: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MxMember {
    user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    role: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    power_level: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MxProfile {
    user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MxPublicRoom {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    topic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar_url: Option<String>,
    member_count: u64,
    joined: bool,
    can_join: bool,
    can_request_join: bool,
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
    thread_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reactions: Option<Vec<MxReaction>>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    edited: bool,
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
        html: Option<String>,
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
    Video {
        #[serde(flatten)]
        media: MxMediaOut,
        #[serde(skip_serializing_if = "Option::is_none")]
        width: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        height: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        caption: Option<String>,
    },
    Sticker {
        body: String,
    },
    Poll {
        question: String,
        answers: Vec<MxPollAnswer>,
        votes: HashMap<String, Vec<String>>,
        #[serde(rename = "maxSelections")]
        max_selections: u64,
        closed: bool,
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

#[derive(Clone, Serialize)]
pub struct MxPollAnswer {
    id: String,
    text: String,
}

#[derive(Deserialize)]
pub struct MxText {
    body: String,
    html: Option<String>,
    mentions: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MxOutgoing {
    Text(MxText),
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
    Video {
        path: String,
        mime_type: Option<String>,
        width: Option<u64>,
        height: Option<u64>,
        duration_ms: Option<u64>,
        size: Option<u64>,
        caption: Option<String>,
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
    #[serde(rename_all = "camelCase")]
    Typing {
        room_id: String,
        user_ids: Vec<String>,
    },
    SignedOut,
}

struct LiveTimeline {
    timeline: Arc<Timeline>,
    task: JoinHandle<()>,
    typing_task: JoinHandle<()>,
    _typing_guard: EventHandlerDropGuard,
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
}

async fn take(state: &State<'_, Matrix>) -> Option<PathBuf> {
    let session = state.0.lock().unwrap().take()?;
    session.stop_sync().await;
    Some(session.data_directory())
}
