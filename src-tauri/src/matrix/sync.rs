use super::*;

impl Session {
    pub(super) async fn start_sync(self: &Arc<Self>) -> Result<(), String> {
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

    pub(super) async fn stop_sync(&self) {
        for (_, live) in self.live.lock().await.drain(..) {
            live.task.abort();
            live.typing_task.abort();
        }
        for task in self.tasks.lock().unwrap().drain(..) {
            task.abort();
        }
        let sync = self.sync.lock().unwrap().take();
        if let Some(sync) = sync {
            sync.stop().await;
        }
    }

    pub(super) async fn announce(self: &Arc<Self>, room: &Room) {
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
                    thread_root: None,
                    reactions: None,
                    edited: false,
                },
            });
        }
    }
}

pub(super) fn changed_by(diff: &VectorDiff<Room>) -> Vec<Room> {
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
pub(super) fn removed_by(entries: &Vector<Room>, diff: &VectorDiff<Room>) -> Vec<Room> {
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
