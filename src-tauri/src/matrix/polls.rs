use super::*;

#[tauri::command]
pub async fn mx_create_poll(
    state: State<'_, Matrix>,
    room_id: String,
    question: String,
    options: Vec<String>,
) -> Result<(), String> {
    let session = current(&state)?;
    let answers = UnstablePollAnswers::try_from(
        options
            .into_iter()
            .enumerate()
            .map(|(index, text)| UnstablePollAnswer::new(index.to_string(), text))
            .collect::<Vec<_>>(),
    )
    .map_err(err)?;
    let mut poll = UnstablePollStartContentBlock::new(&question, answers);
    poll.kind = PollKind::Disclosed;
    session
        .room(&room_id)?
        .send(NewUnstablePollStartEventContent::plain_text(question, poll))
        .await
        .map(|_| ())
        .map_err(err)
}

#[tauri::command]
pub async fn mx_vote_poll(
    state: State<'_, Matrix>,
    room_id: String,
    event_id: String,
    answer_ids: Vec<String>,
) -> Result<(), String> {
    let session = current(&state)?;
    let event_id = EventId::parse(&event_id).map_err(err)?;
    session
        .room(&room_id)?
        .send(UnstablePollResponseEventContent::new(answer_ids, event_id))
        .await
        .map(|_| ())
        .map_err(err)
}
