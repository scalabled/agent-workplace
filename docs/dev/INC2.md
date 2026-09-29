# Increment 2 · Rooms, voices and listen-in

A team's meetings are real now. The kickoff, a review of the work so far, or a discussion of your question runs as
turns, one coworker after another. Your Chief of Staff opens and closes each meeting, and the lead chairs it. Each
speaker hears the meeting from their own seat.

- **Listen in.** Lines stay text until you listen in. Then each line plays in the speaker's team voice while their
  face moves. Voiced lines are kept, so a replay is free.
- **Take the floor.** Whoever you address answers next. You can also whisper to one coworker, and only they hear it.
- **Replay.** Any meeting can be replayed later with captions.
- **Now-playing bar.** The bar keeps a meeting going while you move around the app.

Binding inputs:
- [MVP-PLAN](../MVP-PLAN.md) Inc 2
- [OWNER-DIRECTIVES](../OWNER-DIRECTIVES.md): D2 communication first, D3 minimalist
- [catalog/FORMATION.md](../../catalog/FORMATION.md): voices unique within a team

---

## 1. Run it

Nothing new to install, and storage needs no migration. `tmeetings` and the channel's `meeting_id` and `handled`
columns are created on first use.

Keyless (`pnpm dev --mock`), meetings play as captions ("reading along"). With `--mock-media`, or a TTS key, they play
as voices.

| Setting (worker env) | Default | What it does |
|---|---|---|
| `KICKOFF` | on | `off` skips the kickoff meeting (held for teams of three or more). |
| `TTS_DAILY_LIMIT` | 3000 | Voiced sentences per day. Replays from the cache do not count. |

## 2. Meetings (worker: `apps/worker/src/projects/team-host.ts`)

**Kinds.** A meeting is a `kickoff` (automatic, before the first step), a `review` (the question is the work so far)
or a `discussion` (your question).
- You call one from the project page (**Call a meeting**), or ask the Chief (`team_discussion`, now with `kind`).
- It opens at once, so you can take the floor before the first turn. The turns run on the next tick.

**Order.**
1. The Chief opens (a moderator line).
2. The chair frames the question.
3. Each member opens.
4. Later rounds are a debate.
5. The chair sums up.
6. The Chief closes.

The summary becomes direction for the next steps ("Kickoff agreement", "Review outcome", "Discussion outcome").

**The floor arbiter**, checked before every turn:
- **The owner first.** Whoever you named (or @mentioned) answers next, in a `reply` turn. Otherwise the chair answers.
  - If you speak during the last turn, the chair answers before the close.
  - At most 6 answers to you per meeting.
- **Then raised hands.** A teammate @mentioned in the last turn speaks next. At most 3 per meeting, never chained
  from a reply, never after the close.
- **Then the speaking order.**

**Perspective.** Each speaker's prompt has the meeting as they heard it:
- their own lines as "You";
- the owner and the Chief by role;
- whispers only when meant for them.

The team channel's agent context drops whispers entirely.

**API**
- `POST /api/projects/:id/discuss {question?, rounds?, kind?}` → `meetingId`
- `GET /api/projects/:id/meetings`
- `GET /api/projects/:id/meetings/:meetingId`: lines in order; the owner also sees whispers.
- `POST …/meetings/:meetingId/say {text, toId?, whisper?}`

Stopping the project stops a meeting that has not finished.

## 3. Voices, cache, listen-in (web: `apps/web/src/meetings/`)

**Voices.** Each line plays in its speaker's team voice:
- the staffing-time `TeamMember.voice` ids and provider, with the catalog speed and style;
- the Chief in the lead's voice.

Playback goes through the office's `RoomPlayer`: two lines of TTS look-ahead, 250 ms between speakers, and a caption
for its reading time when a line cannot be voiced.

**Cache.** `TtsRequest.cache: true` keeps a voiced line in R2 (`ws/<ws>/tts/<sha256>.json`). The same words in the
same voice come back without a provider call and without counting against the daily limit (`x-tts-cache: hit`).

**Listening.**
- Listening takes the voice for this tab (one voice per workspace).
- A live meeting keeps adding lines as they are said, and the Chief's closing words end it.
- Pause and resume keep the line. Next skips it.

**The bar.** The now-playing bar sits beside the Chief's bubble on every page. It shows who is speaking (with lip
sync), the caption, the position, and controls for pause, next and stop. When there is no voice here, it says
"Reading along" and offers "Play here" if the voice is on another tab.

## 4. Tests

- **Worker:** `test/meetings.test.ts` covers:
  - the floor, and whispers heard only by their addressee (checked in the run prompts);
  - raised hands;
  - review and kickoff meetings;
  - stop.

  `src/media/speech.test.ts` covers the replay cache.
- **Web:** `routes/parity.test.tsx` "meetings (Inc 2)" covers calling a meeting, whispering, and the bar's line,
  position, pause and stop.
- **e2e:**
  - `meetings.spec.ts` (keyless): replay the kickoff; the bar follows you to Talk.
  - `meeting-voice.spec.ts` (Mock TTS): lines voiced in team voices through the cache, and a replay served from it.

## 5. The Chief of Staff's live voice

**Hands-free talk** (`apps/web/src/voice/live.ts`; the headphones button in Talk, shown when provider STT is set up):
- The mic stays open, and a pause of about 650 ms ends the owner's turn. Blips under 450 ms are ignored, and a turn
  is cut at 45 s.
- The words are transcribed and sent as a spoken turn. The mic listens again at once.
- Speaking over the Chief for 250 ms interrupts them (barge-in). Playback is not ducked while hands-free; echo
  cancellation keeps the Chief's own voice out.
- Holding to talk takes the mic back, and leaving Talk ends it.

**The voice front** (`apps/worker/src/workspace/voice-front.ts`, ARCHITECTURE §8.2), for spoken turns:
1. The WorkspaceDO opens a per-turn xAI realtime socket (`grok-voice-think-fast-2.0`; `REALTIME_VOICE_MODEL`). The key
   stays server-side.
2. The socket is set up with text in and PCM16 24 kHz audio out, told to acknowledge in under eight words and never to
   answer, in the lead's realtime voice.
3. Its audio reaches the owner's tab as `talk.front` frames and plays in the Chief's voice before the answer.
4. If the brain's first words come before any acknowledgement audio (small talk), the acknowledgement is dropped
   (`cancelled`).

While a front is available, the living layer's pre-voiced acknowledgement and filler stand down (`frontAcks`).
Barge-in stops the front too.

| Setting (worker env) | Default | What it does |
|---|---|---|
| `VOICE_FRONT` | on with `XAI_API_KEY` | `off` disables it. `mock` (with `MOCK_MEDIA`) is the keyless test double. |
| `REALTIME_VOICE_MODEL` | grok-voice-think-fast-2.0 | The xAI realtime model. |
| `VOICE_FRONT_DAILY_LIMIT` | 600 | Acknowledgements per day. |

**Tests**
- `apps/worker/test/voice-front.test.ts`: the protocol against a fake socket, errors, supersession, and the talk turn
  in mock mode.
- `apps/web/src/voice/front.test.ts` and `live.test.ts`.
- e2e `live-voice.spec.ts` (fake microphone): hands-free end to end.

**Not verified.** The xAI realtime protocol comes from personagram-ai, which ran it against xAI. It has not been run
here with a real key; `VOICE_FRONT=off` falls back to the pre-voiced acknowledgements.

**Not built:**
- Streaming STT with provider endpointing. Turns end on the browser's voice activity, then batch STT.
- An OpenAI realtime front.
