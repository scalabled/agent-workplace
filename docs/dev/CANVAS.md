# The canvas

The canvas holds apps and documents made for the owner. Ask the Chief of Staff in Talk ("build me a tip calculator",
"write a one-page opening checklist"), or describe it on the Canvas page (`/app/canvas`, ⌘K "Canvas"). It is ported
from personagram-ai's canvas (`src/worker/experiences.ts`, `builder.ts`, `src/web/canvas.ts`) and extended to
documents and PDF.

- **An app** is one self-contained HTML page: no network, sandboxed wherever it is opened.
  - A quick first version (150–250 lines) plays within seconds while the full one (1,000+ lines) is written alongside.
  - A full version short of the bar gets one pass to deepen it.
  - If the full build fails, a working first version is kept.
- **A document** is Markdown (a plan, report, proposal, checklist or guide). It is rendered to a styled page with
  print styles. Raw HTML in it shows as text; only web and mail links survive.
- **Changing it** ("Make the change", or the Chief with `revise`) builds a new version from the current one. The
  current version stays on screen meanwhile, and the versions menu keeps every version.
- **Errors an app reports.** Runtime errors, rejected promises and `console.error` reach the page through a one-line
  reporter that is never in a download. The page offers **Fix it**: a new version briefed with those errors, which are
  bounded and treated as data.
- **Export**
  - **HTML** downloads the page: the app itself, or the rendered document.
  - **PDF** opens a sandboxed print page that opens the browser's print dialog, where "Save as PDF" writes the file.
  - A document's **Markdown** can be downloaded too. The source view shows the code or the Markdown.

## How it runs

1. Builds are queued in the Everyday ProjectDO (the `canvases` table). Content lives in R2 at
   `ws/<ws>/canvas/<id>.html|.md`, plus `.preview.html` for a first version.
2. The alarm starts a build and keeps a 5 s heartbeat while it runs. The build itself runs detached (`waitUntil`),
   streaming through the model registry at the `reason` tier.
3. A build whose heartbeat stops (an eviction, a deploy) is picked up once more, then failed.
4. The page polls `GET /api/canvas/:id` for progress: lines written and the last of them. `canvas.updated` frames
   tell the feed about each status change.

**Sandbox policies** (`apps/worker/src/canvas/render.ts`)

| Page | Policy |
|---|---|
| App | `sandbox allow-scripts allow-pointer-lock`; no network; framed only by our pages |
| Document | `sandbox` (no scripts at all) |
| Print page | `sandbox allow-scripts allow-modals`, so `print()` can open |

The canvas frame on the page also carries the `sandbox` attribute.

**API**

| Route | Does |
|---|---|
| `GET` / `POST /api/canvas` | list / create |
| `GET /api/canvas/:id` | the canvas, with progress while it builds |
| `POST …/revise` · `…/repair` · `…/retry` | change it, fix reported errors, build a failed one again |
| `DELETE /api/canvas/:id` | delete a version |
| `GET …/view[?preview=1]` · `…/download` · `…/print` · `…/source[?download=1]` | serve, download, print, source |

**The Chief** has the `create_canvas` tool: `kind` is `app` or `document`, and `revise: true` changes the latest
canvas. The reply links to the canvas.

| Setting (worker env) | Default | What it does |
|---|---|---|
| `CANVAS_DAILY_LIMIT` | 40 | Builds per day (repairs and changes included). |

**Keyless.** The Mock builder writes a small working app (particles, a slider, a Burst button) or a short document
with a table, streamed like a real build.

**Tests**
- `apps/worker/test/canvas.test.ts`
- `apps/web/src/canvas/canvas.test.tsx`
- e2e `canvas.spec.ts`: build, use in the sandbox, download, print view, change, and a document from Talk.

**Not ported from personagram-ai:**
- Files the owner attaches for the builder (images embedded, documents as reference).
- The WebGL on/off choice (the builder chooses).
- Public share links for guests.
