# Pictures: show the team what you see

This is the Inc 4 leftover: camera and screen snapshots described by a vision model. It also covers the image input
that Inc 5 media builds on.

## What the owner does

The paperclip in Talk opens a small menu:

- **A file or photo.** Any file the Memory page takes, plus PNG, JPEG, WebP and GIF pictures.
- **A snapshot of your screen.** The browser asks which screen, window or tab. One frame is taken, and the capture
  stops at once.
- **Take a photo.** On a desktop, a sheet shows the camera and has a "Take photo" button. On a phone, the phone's own
  camera opens.

Dropping files on Talk does the same. Each addition shows as a chip above the composer (pictures as thumbnails), with
"Reading…" until it is read, and each can be removed.

- **Limits.** Up to four go with one message. A message can be only pictures: it is sent as "Take a look at this."
- **In the thread.** The sent message shows its pictures as thumbnails and its files by name. Each links to the file
  on the Memory page (`/app/memory?at=card_…`).
- **Everything is kept.** It stays on the Memory page for everyone, as before. A picture is listed as "Picture" with
  its thumbnail; "What it shows" opens its description.
- **Big photos.** A phone photo over 3 MB is made smaller in the browser (longest side 2,048 px, JPEG) before it is
  shared. Pictures are kept up to 5 MB.

## What the worker does

- **A picture card** (`kind: 'image'`, `apps/worker/src/memory/host.ts` `addImage`):
  - the type is checked by its magic bytes (PNG, JPEG, GIF or WebP), whatever the name or header says;
  - the bytes are kept at `ws/<id>/cards/<cardId>.img`.
- **Its description.** A vision model (fast tier, `needs: ['vision']`) describes it in the background: what it shows,
  then every piece of readable text (`describeImage` in `memory/distill.ts`).
  - The description is the card's text, cut into searchable excerpts like any file.
  - It counts against the daily memory cap.
  - With no vision model, the card says so, and the picture is still kept.
- **Serving it.** `GET /api/cards/:id/file` (reader) returns the picture with `nosniff` and a sandboxing CSP.
  Removing the card removes the picture.
- **Showing it with a message.** `POST /api/talk` takes `attachments: cardId[]` (up to 4). The `talk.owner` frame
  records `{cardId, name, kind}` for each. For the Chief's turn (`talk.ts` `withShown`):
  - **Pictures.** When a chat model with tools and vision is set up, the pictures go to it as image parts.
    Otherwise, each picture's description stands in (`<image name=…>`).
  - **Files.** Their text is added as `<file name=…>` blocks.
  - **Framing.** A note says the material is the owner's to discuss, never instructions.
  - **Older messages.** They keep a short "[Shared: …]" line in the history.
- **Adapters** (`ChatMessage` user `images`):

  | Adapter | Image part |
  |---|---|
  | Anthropic | `image` block (base64) |
  | OpenAI Responses | `input_image` (data URL) |
  | Gemini | `inlineData` |
  | OpenAI-compatible | `image_url` |
  | Ollama | `images` |
  | Mock | Says it was handed a picture |

## Also here

- **Generate portrait** on a coworker's profile. It is shown to owners when an image provider is set up and the
  coworker has no portrait yet. It is the same action as in onboarding (`components/PortraitAction.tsx`).
- **Sheets** (the run inspector, the camera) now sit above their backdrop, so their buttons can be clicked.
- **Owner bubbles in Talk.** The Copy-link button no longer takes room inside them.
- **Headers.** The deployed `Permissions-Policy` (`apps/web/public/_headers`) now allows `camera` and
  `display-capture` for the app's own origin. Before, it blocked the camera.

## Tests

- `packages/models/src/adapters/vision.test.ts`: every adapter's image part.
- `apps/worker/test/memory.test.ts` "vision" covers:
  - a picture kept, described, searched, served sandboxed, and removed;
  - a disguised file refused;
  - a message with a picture and a file: the frame keeps them, and the Chief is handed the picture;
  - the description standing in when there is no vision model;
  - the history note.
- `apps/web/src/talk/attachments.test.ts` covers the tray (read, dropped on error, removed, at most four) and a
  message carrying its attachments.
- `apps/web/src/components/PortraitAction.test.tsx`.
- `e2e/memory.spec.ts` covers:
  - a picture shown with a message: its thumbnail, the Chief's reply, and the card described on the Memory page;
  - a camera photo, which uses Chromium's fake camera, and the menu and tray at phone width;
  - a screen snapshot.
