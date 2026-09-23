use super::*;

impl Session {
    pub(super) async fn live_timeline(
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
        let (typing_guard, mut typing_rx) = room.subscribe_to_typing_notifications();
        let session = self.clone();
        let room_id_string = room_id.to_string();
        let typing_task = tokio::spawn(async move {
            while let Ok(ids) = typing_rx.recv().await {
                session.emit(MxUpdate::Typing {
                    room_id: room_id_string.clone(),
                    user_ids: ids.into_iter().map(|id| id.to_string()).collect(),
                });
            }
        });
        let entry = Arc::new(LiveTimeline {
            timeline,
            task,
            typing_task,
            _typing_guard: typing_guard,
        });

        let mut live = self.live.lock().await;
        if let Some(existing) = live
            .iter()
            .find(|(id, _)| id == room_id)
            .map(|(_, live)| live.clone())
        {
            entry.task.abort();
            entry.typing_task.abort();
            return Ok(existing);
        }
        live.push((room_id.to_owned(), entry.clone()));
        while live.len() > LIVE_TIMELINES {
            let (_, dropped) = live.remove(0);
            dropped.task.abort();
            dropped.typing_task.abort();
        }
        Ok(entry)
    }

    pub(super) async fn touch_live(&self, room_id: &RoomId) -> Option<Arc<LiveTimeline>> {
        let mut live = self.live.lock().await;
        let index = live.iter().position(|(id, _)| id == room_id)?;
        let entry = live.remove(index);
        let timeline = entry.1.clone();
        live.push(entry);
        Some(timeline)
    }

    pub(super) async fn messages(
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
pub async fn mx_set_marked_unread(
    state: State<'_, Matrix>,
    room_id: String,
    unread: bool,
) -> Result<(), String> {
    let session = current(&state)?;
    session
        .room(&room_id)?
        .set_unread_flag(unread)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn mx_set_typing(
    state: State<'_, Matrix>,
    room_id: String,
    typing: bool,
) -> Result<(), String> {
    let session = current(&state)?;
    session
        .room(&room_id)?
        .typing_notice(typing)
        .await
        .map_err(err)
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
pub async fn mx_pinned_messages(
    state: State<'_, Matrix>,
    room_id: String,
) -> Result<Vec<MxEvent>, String> {
    let session = current(&state)?;
    let room = session.room(&room_id)?;
    let timeline = room
        .timeline_builder()
        .with_focus(TimelineFocus::PinnedEvents)
        .build()
        .await
        .map_err(err)?;
    Ok(timeline
        .items()
        .await
        .iter()
        .filter_map(|item| to_mx_event(room.room_id(), item))
        .collect())
}
