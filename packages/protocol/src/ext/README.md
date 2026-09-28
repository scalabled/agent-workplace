# protocol extensions

Builders may ADD files here named after their ownership area (`models.ts`, `worker-core.ts`, `media.ts`,
`avatar.ts`, `audio.ts`, `web.ts`) for additive types that more than one package needs.

Rules:
- Additive only: new interfaces/types/consts. Never redefine or augment core types in `../*.ts`.
- New frame types: declare the data shape here, then ask the integrator to add the entry to
  `FrameDataMap` in `../frames.ts` (core stays integrator-owned).
- Import from other packages as `@headcount/protocol/ext/<name>`.
