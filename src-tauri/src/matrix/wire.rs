use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MxSession {
    pub(super) access_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) refresh_token: Option<String>,
    pub(super) user_id: String,
    pub(super) device_id: String,
    pub(super) homeserver_url: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartParams {
    pub(super) data_directory: String,
    pub(super) store_passphrase: String,
    pub(super) homeserver_url: String,
    pub(super) user_id: String,
    pub(super) device_name: String,
    pub(super) session: Option<MxSession>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MxRoom {
    pub(super) id: String,
    pub(super) name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) topic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) canonical_alias: Option<String>,
    pub(super) member_count: u64,
    pub(super) is_dm: bool,
    pub(super) broadcast: bool,
    pub(super) can_send: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) peer: Option<String>,
    pub(super) membership: &'static str,
    pub(super) heroes: Vec<String>,
    pub(super) self_role: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) inviter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) latest: Option<MxPreview>,
    pub(super) unread_count: u64,
    pub(super) mention_count: u64,
    pub(super) marked_unread: bool,
    pub(super) can_pin: bool,
    pub(super) can_delete_others: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) send_level: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) default_level: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MxMember {
    pub(super) user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) display_name: Option<String>,
    pub(super) role: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) power_level: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MxProfile {
    pub(super) user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) display_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MxPublicRoom {
    pub(super) id: String,
    pub(super) name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) topic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) avatar_url: Option<String>,
    pub(super) member_count: u64,
    pub(super) joined: bool,
    pub(super) can_join: bool,
    pub(super) can_request_join: bool,
}

#[derive(Clone, Serialize)]
pub struct MxReaction {
    pub(super) key: String,
    pub(super) senders: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MxPreview {
    pub(super) sender: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) sender_name: Option<String>,
    pub(super) timestamp: u64,
    pub(super) is_own: bool,
    pub(super) content: MxContent,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MxEvent {
    pub(super) id: String,
    pub(super) room_id: String,
    #[serde(flatten)]
    pub(super) preview: MxPreview,
    pub(super) status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) reply_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) thread_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) reactions: Option<Vec<MxReaction>>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub(super) edited: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MxMediaOut {
    pub(super) source: String,
    pub(super) name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) size: Option<u64>,
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
    pub(super) id: String,
    pub(super) text: String,
}

#[derive(Deserialize)]
pub struct MxText {
    pub(super) body: String,
    pub(super) html: Option<String>,
    pub(super) mentions: Option<Vec<String>>,
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
    pub(super) source: String,
    pub(super) name: String,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MxUpdate {
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
