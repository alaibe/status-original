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
mod wire;

pub use lifecycle::*;
use map::*;
pub use media::*;
pub use polls::*;
pub use public_rooms::*;
pub use rooms::*;
pub use send::*;
pub use timeline::*;
pub use wire::*;

const ROOM_PAGE: usize = 500;

const HISTORY_PAGE: u16 = 40;

const ANCHOR_SEARCH_PAGES: usize = 25;

const LIVE_TIMELINES: usize = 16;

const ANNOUNCE_CONCURRENCY: usize = 8;

const UPDATE_EVENT: &str = "matrix://update";

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
