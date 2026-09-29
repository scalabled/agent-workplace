// Admin: people and roles, every setting in one place, and what the models cost (token usage).
//
// - Roles. An owner configures everything; a contributor works with the team (talks, starts and steers work, edits
//   the Handbook and memory, shares files); a reader reads along. Owners named in the deployment (OWNER_EMAILS) are
//   always owners; everyone else is invited on the People page.
// - Settings. Every option the worker reads from its environment is listed here, grouped, with its default. Most can
//   be changed from the admin page (stored in D1, applied within seconds everywhere); a few that guard sign-in and
//   the deployment itself are shown but only change with the deployment. Keys are write-only.
// - Usage. Every model call (chat, embeddings, speech, images) is metered by surface, coworker, provider and model:
//   tokens in, out and cached, calls, errors, time, and cost where the provider reports it or a price is set here.
import type { Role } from '../routes';

export type { Role };
export const ROLES: readonly Role[] = ['owner', 'contributor', 'reader'];
export const ROLE_RANK: Record<Role, number> = { reader: 1, contributor: 2, owner: 3 };
export const ROLE_WORDS: Record<Role, { label: string; can: string }> = {
  owner: { label: 'Owner', can: 'Everything, including settings, people, connectors and costs.' },
  contributor: { label: 'Contributor', can: 'Talks with the team, starts and steers work, edits the Handbook and memory, shares files.' },
  reader: { label: 'Reader', can: 'Reads everything: conversations, projects, documents and memory. Changes nothing.' },
};

export function atLeast(role: Role | null | undefined, needed: Role): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[needed];
}

export interface Member {
  email: string;
  name?: string;
  role: Role;
  /** `deployment`: an owner named in OWNER_EMAILS (changes with the deployment). */
  source: 'deployment' | 'invited';
  addedAt?: string;
  addedBy?: string;
  lastSeenAt?: string;
}

export interface MembersResponse {
  members: Member[];
  /** Sign-in is on (a deployed workspace); locally everyone on this machine is the owner. */
  signIn: boolean;
}

export interface MemberPut {
  role: Role;
  name?: string;
}

/** GET /api/auth/me. */
export interface Me {
  mode: 'google' | 'off';
  signedIn: boolean;
  email?: string;
  name?: string;
  /** The effective role (after "view as"). */
  role: Role;
  /** The role they really have, when they are previewing a lower one. */
  actualRole?: Role;
}

// ── settings ─────────────────────────────────────────────────────────────────────────

export type ConfigGroup = 'limits' | 'work' | 'voice' | 'models' | 'keys' | 'deployment';

export const CONFIG_GROUPS: readonly { id: ConfigGroup; title: string; about: string }[] = [
  { id: 'limits', title: 'Daily limits', about: 'How much can happen in a day before the team waits for tomorrow. They keep a runaway loop from spending without bound.' },
  { id: 'work', title: 'How work runs', about: 'How many things run at once, how much a project may spend, and which extras are on.' },
  { id: 'voice', title: 'Voice', about: 'Spoken replies, voice input and the realtime voice.' },
  { id: 'models', title: 'Models', about: 'Which AI providers answer, and local or self-hosted models.' },
  { id: 'keys', title: 'Provider keys', about: 'Keys for the AI providers. Stored encrypted; never shown again once saved.' },
  { id: 'deployment', title: 'Deployment', about: 'Sign-in and security. These change only with the deployment, so they are shown here for reference.' },
];

export type ConfigKind = 'number' | 'switch' | 'choice' | 'text' | 'url' | 'secret';

export interface ConfigOption {
  key: string;
  group: ConfigGroup;
  label: string;
  help: string;
  kind: ConfigKind;
  /** The default, as the worker reads it ('' = unset). */
  fallback: string;
  choices?: readonly { value: string; label: string }[];
  min?: number;
  max?: number;
  /** Values for a switch: [on, off]. */
  on?: string;
  off?: string;
  /** Only changes with the deployment (shown, not editable). */
  fixed?: boolean;
}

const limit = (key: string, label: string, fallback: number, help: string): ConfigOption => ({ key, group: 'limits', label, help, kind: 'number', fallback: String(fallback), min: 0, max: 1_000_000 });

export const CONFIG_OPTIONS: readonly ConfigOption[] = [
  limit('CHAT_DAILY_LIMIT', 'Replies', 1500, 'Replies from your Chief of Staff per day.'),
  limit('JOB_DAILY_LIMIT', 'New background jobs', 60, 'Research and write-ups started per day.'),
  limit('PROJECT_DAILY_LIMIT', 'New team projects', 10, 'Team projects proposed per day.'),
  limit('CANVAS_DAILY_LIMIT', 'Canvas builds', 40, 'Apps and documents built or changed per day.'),
  limit('MEMORY_DAILY_LIMIT', 'Memory updates', 400, 'Conversations distilled into memory and files summarised per day.'),
  limit('SEARCH_DAILY_LIMIT', 'Web searches', 300, 'Web searches per day.'),
  limit('FETCH_DAILY_LIMIT', 'Web pages read', 600, 'Web pages read per day.'),
  limit('CONNECTOR_DAILY_LIMIT', 'Connector calls', 500, 'Calls to connected services per day.'),
  limit('TTS_DAILY_LIMIT', 'Spoken replies', 3000, 'Sentences spoken aloud per day.'),
  limit('STT_DAILY_LIMIT', 'Voice input', 600, 'Recordings transcribed per day.'),
  limit('VOICE_FRONT_DAILY_LIMIT', 'Spoken acknowledgements', 600, 'Realtime spoken acknowledgements per day.'),
  limit('INTERRUPTION_BUDGET', 'Unprompted updates', 6, 'Updates your Chief of Staff says aloud without being asked, per day. Past it, they are quiet lines.'),
  limit('PORTRAIT_DAILY_LIMIT', 'Portraits and images', 200, 'Portraits and images generated per day.'),
  limit('EXPR_CLIP_DAILY_LIMIT', 'Voice clips', 600, 'Short pre-voiced lines rendered per day.'),
  { key: 'MAX_ACTIVE_JOBS', group: 'work', label: 'Background jobs at once', help: 'Jobs that run at the same time; more wait their turn.', kind: 'number', fallback: '3', min: 1, max: 20 },
  { key: 'MAX_ACTIVE_PROJECTS', group: 'work', label: 'Team projects at once', help: 'Team projects that run at the same time.', kind: 'number', fallback: '2', min: 1, max: 10 },
  { key: 'PROJECT_TOKEN_BUDGET', group: 'work', label: 'Tokens per project', help: 'A project pauses and asks you before it spends more than this many tokens.', kind: 'number', fallback: '1500000', min: 10_000, max: 100_000_000 },
  { key: 'WEB_TOOLS', group: 'work', label: 'Web search and reading', help: 'Let the team search the web and read pages.', kind: 'switch', fallback: '', on: '', off: 'off' },
  { key: 'KICKOFF', group: 'work', label: 'Kickoff meetings', help: 'The team talks a project over before it starts.', kind: 'switch', fallback: '', on: '', off: 'off' },
  { key: 'ENABLE_MEDIA_TOOLS', group: 'work', label: 'Image generation tool', help: 'Allow generating images outside this computer (marketing art).', kind: 'switch', fallback: '', on: 'true', off: '' },
  {
    key: 'VOICE_FRONT',
    group: 'voice',
    label: 'Realtime voice',
    help: 'A realtime voice answers the moment you finish speaking, while the full reply is prepared. On when an xAI key is set.',
    kind: 'choice',
    fallback: '',
    choices: [
      { value: '', label: 'On when available' },
      { value: 'off', label: 'Off' },
      { value: 'mock', label: 'Test double' },
    ],
  },
  { key: 'REALTIME_VOICE_MODEL', group: 'voice', label: 'Realtime voice model', help: 'The xAI realtime model for the quick spoken answers.', kind: 'text', fallback: 'grok-voice-think-fast-2.0' },
  { key: 'EXPR_RENDER_PER_MIN', group: 'voice', label: 'Voice renders per minute', help: 'Short lines voiced on the fly, per minute.', kind: 'number', fallback: '30', min: 1, max: 600 },
  { key: 'EXPR_PREVOICE_MAX_CLIPS', group: 'voice', label: 'Lines voiced ahead', help: 'Lines each voice records ahead of time, so reactions play instantly (at most 600).', kind: 'number', fallback: '300', min: 0, max: 600 },
  { key: 'MOCK_MEDIA', group: 'voice', label: 'Test voices', help: 'Answer speech requests with a test double when no voice provider is set up.', kind: 'switch', fallback: '', on: 'true', off: '' },
  {
    key: 'DEFAULT_CHAT',
    group: 'models',
    label: 'Preferred provider',
    help: 'Which provider answers first when several are set up. The others take over if it fails.',
    kind: 'choice',
    fallback: 'auto',
    choices: [
      { value: 'auto', label: 'Automatic' },
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'openai', label: 'OpenAI' },
      { value: 'xai', label: 'xAI' },
      { value: 'gemini', label: 'Google Gemini' },
      { value: 'ollama', label: 'Ollama (this computer)' },
      { value: 'openai-compatible', label: 'OpenAI-compatible server' },
      { value: 'mock', label: 'Test double (no AI)' },
    ],
  },
  { key: 'ENABLE_MOCK', group: 'models', label: 'Test double without keys', help: 'With no provider key set, answer with a scripted test double instead of an error.', kind: 'switch', fallback: '', on: 'true', off: '' },
  { key: 'OLLAMA_BASE_URL', group: 'models', label: 'Ollama address', help: 'Where Ollama runs, e.g. http://127.0.0.1:11434.', kind: 'url', fallback: '' },
  { key: 'OLLAMA_CHAT_MODEL', group: 'models', label: 'Ollama chat model', help: 'The model Ollama answers with.', kind: 'text', fallback: 'qwen3:32b' },
  { key: 'OLLAMA_EMBED_MODEL', group: 'models', label: 'Ollama embeddings model', help: 'The model Ollama searches memory with.', kind: 'text', fallback: 'nomic-embed-text' },
  { key: 'OPENAI_COMPATIBLE_BASE_URL', group: 'models', label: 'OpenAI-compatible server', help: 'The base URL of a self-hosted or third-party server that speaks the OpenAI API.', kind: 'url', fallback: '' },
  { key: 'OPENAI_COMPATIBLE_MODEL', group: 'models', label: 'Its chat model', help: 'The model that server answers with.', kind: 'text', fallback: '' },
  { key: 'OPENAI_COMPATIBLE_EMBED_MODEL', group: 'models', label: 'Its embeddings model', help: 'The model that server searches memory with.', kind: 'text', fallback: '' },
  { key: 'ANTHROPIC_API_KEY', group: 'keys', label: 'Anthropic', help: 'Claude models.', kind: 'secret', fallback: '' },
  { key: 'OPENAI_API_KEY', group: 'keys', label: 'OpenAI', help: 'GPT models, voices and transcription.', kind: 'secret', fallback: '' },
  { key: 'XAI_API_KEY', group: 'keys', label: 'xAI', help: 'Grok models and the realtime voice.', kind: 'secret', fallback: '' },
  { key: 'GEMINI_API_KEY', group: 'keys', label: 'Google Gemini', help: 'Gemini models.', kind: 'secret', fallback: '' },
  { key: 'OPENAI_COMPATIBLE_API_KEY', group: 'keys', label: 'OpenAI-compatible server', help: 'The key for the server above, if it needs one.', kind: 'secret', fallback: '' },
  { key: 'WORKSPACE_ID', group: 'deployment', label: 'Workspace id', help: 'Names this workspace’s storage.', kind: 'text', fallback: 'local', fixed: true },
  { key: 'AUTH_MODE', group: 'deployment', label: 'Sign-in', help: '"google" requires Google sign-in everywhere; unset, this computer is open and everywhere else requires sign-in.', kind: 'text', fallback: '', fixed: true },
  { key: 'OWNER_EMAILS', group: 'deployment', label: 'Owners', help: 'The Google accounts that are always owners.', kind: 'text', fallback: '', fixed: true },
  { key: 'APP_ORIGIN', group: 'deployment', label: 'App address', help: 'The address people open, for the sign-in round trip.', kind: 'url', fallback: '', fixed: true },
  { key: 'ALLOWED_ORIGINS', group: 'deployment', label: 'Allowed addresses', help: 'Other addresses allowed to call the app.', kind: 'text', fallback: '', fixed: true },
  { key: 'GOOGLE_CLIENT_ID', group: 'deployment', label: 'Google client id', help: 'The Google OAuth client.', kind: 'text', fallback: '', fixed: true },
  { key: 'GOOGLE_CLIENT_SECRET', group: 'deployment', label: 'Google client secret', help: 'The Google OAuth secret.', kind: 'secret', fallback: '', fixed: true },
  { key: 'CONNECTOR_SECRET', group: 'deployment', label: 'Encryption secret', help: 'Encrypts connector keys and the provider keys saved here.', kind: 'secret', fallback: '', fixed: true },
];

export const CONFIG_KEYS = new Set(CONFIG_OPTIONS.map((o) => o.key));
/** Keys the admin page may change (everything not fixed to the deployment). */
export const EDITABLE_KEYS = new Set(CONFIG_OPTIONS.filter((o) => !o.fixed).map((o) => o.key));

export interface ConfigValue {
  key: string;
  /** The value in effect ('' = unset). Secrets are never sent: see `set`. */
  value: string;
  /** Where it comes from: changed on the admin page, the deployment's environment, or the default. */
  source: 'admin' | 'deployment' | 'default';
  /** Secrets: whether one is set. */
  set?: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ConfigResponse {
  values: ConfigValue[];
  /** Keys can be saved here (an encryption secret is available). */
  canStoreKeys: boolean;
}

/** PUT /api/admin/config: a value, or null to go back to the deployment's value or the default. */
export interface ConfigPut {
  values: Record<string, string | null>;
}

// ── usage ────────────────────────────────────────────────────────────────────────────

export type UsageSurface = 'talk' | 'desk' | 'room' | 'project' | 'meeting' | 'job' | 'canvas' | 'memory' | 'automation' | 'search' | 'announce' | 'voice' | 'speech' | 'image';

export const SURFACE_WORDS: Record<UsageSurface, string> = {
  talk: 'Talk (Chief of Staff)',
  desk: 'Desk chats',
  room: 'Office rooms',
  project: 'Team projects',
  meeting: 'Meetings',
  job: 'Background jobs',
  canvas: 'Canvas',
  memory: 'Memory',
  automation: 'Automations',
  search: 'Web search',
  announce: 'Announcements',
  voice: 'Realtime voice',
  speech: 'Speech',
  image: 'Images',
};

export type UsageCapability = 'chat' | 'embeddings' | 'tts' | 'stt' | 'image' | 'realtime';

export interface UsageRow {
  key: string;
  label: string;
  calls: number;
  errors: number;
  input: number;
  output: number;
  cached: number;
  /** Cost in USD: reported by the provider or estimated from the prices set here; null when unknown. */
  usd: number | null;
  /** Share of the calls with a known cost (0..1). */
  priced: number;
  /** Average time per call, ms. */
  avgMs: number;
  /** Average time to the first token (chat), ms; 0 when unknown. */
  avgFirstMs: number;
}

export interface UsageDay {
  day: string;
  calls: number;
  input: number;
  output: number;
  usd: number | null;
}

export interface UsageCall {
  at: string;
  surface: UsageSurface;
  agentId?: string;
  agentName?: string;
  projectId?: string;
  provider: string;
  model: string;
  capability: UsageCapability;
  input: number;
  output: number;
  cached: number;
  usd: number | null;
  ms: number;
  firstMs?: number;
  ok: boolean;
  error?: string;
}

export interface LimitUse {
  key: string;
  label: string;
  used: number;
  limit: number;
}

export interface ModelPrice {
  provider: string;
  model: string;
  /** USD per million tokens. */
  input: number;
  output: number;
  cached?: number;
}

export interface UsageResponse {
  days: number;
  since: string;
  total: UsageRow;
  byDay: UsageDay[];
  bySurface: UsageRow[];
  byAgent: UsageRow[];
  byModel: UsageRow[];
  recent: UsageCall[];
  /** Today's use of each daily limit. */
  limits: LimitUse[];
  prices: ModelPrice[];
}

export interface PricesPut {
  prices: ModelPrice[];
}
