use super::*;

pub(super) fn preview_of(latest: LatestEventValue) -> Option<MxPreview> {
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
pub(super) fn to_mx_event(room_id: &RoomId, item: &TimelineItem) -> Option<MxEvent> {
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
        edited: msg_like.is_some_and(
            |m| matches!(&m.kind, MsgLikeKind::Message(message) if message.is_edited()),
        ),
    })
}

pub(super) fn name_of(
    profile: &TimelineDetails<matrix_sdk_ui::timeline::Profile>,
) -> Option<String> {
    match profile {
        TimelineDetails::Ready(profile) => profile.display_name.clone(),
        _ => None,
    }
}

pub(super) fn media_of(
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

pub(super) fn map_content(content: &TimelineItemContent) -> Option<MxContent> {
    match content {
        TimelineItemContent::MsgLike(msg) => match &msg.kind {
            MsgLikeKind::Message(message) => map_message(message.msgtype()),
            MsgLikeKind::Sticker(sticker) => Some(MxContent::Sticker {
                body: sticker.content().body.clone(),
            }),
            MsgLikeKind::Poll(poll) => {
                let result = poll.results();
                Some(MxContent::Poll {
                    question: result.question,
                    answers: result
                        .answers
                        .into_iter()
                        .map(|answer| MxPollAnswer {
                            id: answer.id,
                            text: answer.text,
                        })
                        .collect(),
                    votes: result.votes,
                    max_selections: result.max_selections,
                    closed: result.end_time.is_some(),
                })
            }
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

pub(super) fn html_of(formatted: Option<&FormattedBody>) -> Option<String> {
    formatted
        .filter(|f| f.format == MessageFormat::Html)
        .map(|f| f.body.clone())
}

pub(super) fn map_message(msgtype: &MessageType) -> Option<MxContent> {
    Some(match msgtype {
        MessageType::Text(t) => MxContent::Text {
            body: t.body.clone(),
            html: html_of(t.formatted.as_ref()),
            msgtype: None,
        },
        MessageType::Notice(n) => MxContent::Text {
            body: n.body.clone(),
            html: html_of(n.formatted.as_ref()),
            msgtype: Some("notice"),
        },
        MessageType::Emote(e) => MxContent::Text {
            body: e.body.clone(),
            html: html_of(e.formatted.as_ref()),
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
        MessageType::Video(v) => MxContent::Video {
            media: media_of(
                &v.source,
                v.filename(),
                v.info.as_ref().and_then(|info| info.mimetype.as_deref()),
                v.info.as_ref().and_then(|info| info.size),
            ),
            width: v.info.as_ref().and_then(|info| info.width).map(Into::into),
            height: v.info.as_ref().and_then(|info| info.height).map(Into::into),
            duration_ms: v
                .info
                .as_ref()
                .and_then(|info| info.duration)
                .map(|duration| duration.as_millis() as u64),
            caption: v.caption().map(str::to_string),
        },
        MessageType::Location(_) => MxContent::Location,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use matrix_sdk::ruma::events::room::message::{
        ImageMessageEventContent, NoticeMessageEventContent, TextMessageEventContent,
    };
    use serde_json::json;

    fn mapped(msgtype: MessageType) -> serde_json::Value {
        serde_json::to_value(map_message(&msgtype).expect("shown")).unwrap()
    }

    #[test]
    fn text_keeps_its_html_and_kind() {
        assert_eq!(
            mapped(MessageType::Text(TextMessageEventContent::html(
                "hi",
                "<b>hi</b>"
            ))),
            json!({ "kind": "text", "body": "hi", "html": "<b>hi</b>" })
        );
        assert_eq!(
            mapped(MessageType::Notice(NoticeMessageEventContent::plain(
                "bot says"
            ))),
            json!({ "kind": "text", "body": "bot says", "msgtype": "notice" })
        );
    }

    #[test]
    fn media_carries_the_source_and_name() {
        let image =
            ImageMessageEventContent::plain("cat.png".into(), "mxc://example.org/abc".into());
        let value = mapped(MessageType::Image(image));
        assert_eq!(value["kind"], "image");
        assert_eq!(value["name"], "cat.png");
        assert_eq!(value["source"], r#"{"url":"mxc://example.org/abc"}"#);
    }
}
