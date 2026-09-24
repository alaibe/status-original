use super::*;

impl Session {
    /// Straight to the homeserver, so a rejection rejects here; the echo brings the event id.
    pub(super) async fn send(
        &self,
        room_id: &RoomId,
        content: MxOutgoing,
        reply_to: Option<String>,
        thread_root: Option<String>,
    ) -> Result<(), String> {
        let room = self.room(room_id.as_str())?;
        let parse = |id: Option<String>| id.map(|id| EventId::parse(id).map_err(err)).transpose();
        let reply = relation(parse(reply_to)?, parse(thread_root)?);
        match content {
            MxOutgoing::Text(text) => {
                let content = text_content(text)?;
                let content = match reply {
                    Some(reply) => room.make_reply_event(content, reply).await.map_err(err)?,
                    None => content.with_relation(None),
                };
                room.send(content).await.map_err(err)?;
            }
            other => {
                let (name, mime, data, info, caption) = attachment(other).await?;
                let config = AttachmentConfig::new()
                    .info(info)
                    .caption(caption.map(TextMessageEventContent::plain))
                    .reply(reply);
                room.send_attachment(name, &mime, data, config)
                    .await
                    .map_err(err)?;
            }
        }
        Ok(())
    }
}

pub(super) fn reply(event_id: OwnedEventId) -> Reply {
    Reply {
        event_id,
        enforce_thread: EnforceThread::MaybeThreaded,
        add_mentions: AddMentions::Yes,
    }
}

/// In a thread, a message that replies to nothing still points at the root, as the fallback for clients without threads.
fn relation(reply_to: Option<OwnedEventId>, thread_root: Option<OwnedEventId>) -> Option<Reply> {
    let Some(root) = thread_root else {
        return reply_to.map(reply);
    };
    let within = if reply_to.is_some() {
        ReplyWithinThread::Yes
    } else {
        ReplyWithinThread::No
    };
    Some(Reply {
        event_id: reply_to.unwrap_or(root),
        enforce_thread: EnforceThread::Threaded(within),
        add_mentions: AddMentions::Yes,
    })
}

/// The page names files itself; the SDK would otherwise use the path's basename.
pub(super) async fn attachment(
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
        MxOutgoing::Video {
            path,
            mime_type,
            width,
            height,
            duration_ms,
            size,
            caption,
        } => Ok((
            basename(&path),
            parse(mime_type, "video/mp4")?,
            tokio::fs::read(&path).await.map_err(err)?,
            AttachmentInfo::Video(BaseVideoInfo {
                width: width.map(uint),
                height: height.map(uint),
                duration: duration_ms.map(Duration::from_millis),
                size: size.map(uint),
                ..Default::default()
            }),
            caption,
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
        MxOutgoing::Text(_) => Err("Not an attachment".to_string()),
    }
}

pub(super) fn uint(value: u64) -> matrix_sdk::ruma::UInt {
    matrix_sdk::ruma::UInt::new(value).unwrap_or(matrix_sdk::ruma::UInt::MAX)
}

#[tauri::command]
pub async fn mx_send(
    state: State<'_, Matrix>,
    room_id: String,
    content: MxOutgoing,
    reply_to: Option<String>,
    thread_root: Option<String>,
) -> Result<(), String> {
    let session = current(&state)?;
    let room_id = RoomId::parse(&room_id).map_err(err)?;
    session.send(&room_id, content, reply_to, thread_root).await
}

#[tauri::command]
pub async fn mx_edit(
    state: State<'_, Matrix>,
    room_id: String,
    event_id: String,
    content: MxText,
) -> Result<(), String> {
    let session = current(&state)?;
    let event_id = EventId::parse(&event_id).map_err(err)?;
    let replacement = text_content(content)?;
    session
        .room(&room_id)?
        .send(replacement.make_replacement(ReplacementMetadata::new(event_id, None)))
        .await
        .map(|_| ())
        .map_err(err)
}

#[tauri::command]
pub async fn mx_redact(
    state: State<'_, Matrix>,
    room_id: String,
    event_id: String,
) -> Result<(), String> {
    let session = current(&state)?;
    let event_id = EventId::parse(&event_id).map_err(err)?;
    session
        .room(&room_id)?
        .redact(&event_id, None, None)
        .await
        .map(|_| ())
        .map_err(err)
}

#[tauri::command]
pub async fn mx_set_pinned(
    state: State<'_, Matrix>,
    room_id: String,
    event_id: String,
    pinned: bool,
) -> Result<(), String> {
    let session = current(&state)?;
    let event_id = EventId::parse(&event_id).map_err(err)?;
    let room = session.room(&room_id)?;
    if pinned {
        room.pin_event(&event_id).await.map_err(err)?;
    } else {
        room.unpin_event(&event_id).await.map_err(err)?;
    }
    Ok(())
}

fn text_content(text: MxText) -> Result<RoomMessageEventContentWithoutRelation, String> {
    let content = match text.html {
        Some(html) => RoomMessageEventContentWithoutRelation::text_html(text.body, html),
        None => RoomMessageEventContentWithoutRelation::text_plain(text.body),
    };
    let user_ids = text
        .mentions
        .unwrap_or_default()
        .into_iter()
        .map(|id| UserId::parse(&id).map_err(err))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(if user_ids.is_empty() {
        content
    } else {
        content.add_mentions(Mentions::with_user_ids(user_ids))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(body: &str, html: Option<&str>, mentions: &[&str]) -> MxText {
        MxText {
            body: body.into(),
            html: html.map(Into::into),
            mentions: (!mentions.is_empty())
                .then(|| mentions.iter().map(|id| id.to_string()).collect()),
        }
    }

    #[test]
    fn plain_or_html_with_the_people_it_mentions() {
        let plain = text_content(text("hi", None, &[])).unwrap();
        assert!(plain.mentions.is_none());
        assert_eq!(plain.msgtype.body(), "hi");

        let mentioned =
            text_content(text("hi Bob", Some("hi <a>Bob</a>"), &["@bob:example.org"])).unwrap();
        let ids: Vec<String> = mentioned
            .mentions
            .expect("mentions")
            .user_ids
            .iter()
            .map(|id| id.to_string())
            .collect();
        assert_eq!(ids, ["@bob:example.org"]);
    }

    #[test]
    fn a_thread_message_replies_to_its_root_unless_it_replies_to_something_else() {
        let root = OwnedEventId::try_from("$root").unwrap();
        let other = OwnedEventId::try_from("$other").unwrap();

        let plain = relation(None, Some(root.clone())).unwrap();
        assert_eq!(plain.event_id, root);
        assert_eq!(
            plain.enforce_thread,
            EnforceThread::Threaded(ReplyWithinThread::No)
        );

        let answer = relation(Some(other.clone()), Some(root)).unwrap();
        assert_eq!(answer.event_id, other);
        assert_eq!(
            answer.enforce_thread,
            EnforceThread::Threaded(ReplyWithinThread::Yes)
        );

        let outside = relation(Some(other), None).unwrap();
        assert_eq!(outside.enforce_thread, EnforceThread::MaybeThreaded);
        assert!(relation(None, None).is_none());
    }

    #[test]
    fn refuses_a_mention_that_is_not_a_user_id() {
        assert!(text_content(text("hi", None, &["bob"])).is_err());
    }
}
