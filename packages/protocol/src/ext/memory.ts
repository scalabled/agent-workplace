// Inc 4 · Context and memory. What the workspace knows about the business, three ways:
// - the Handbook: the owner's own description of the business (written by the Chief of Staff from an interview, and
//   editable), always in the Chief's and the team's prompts;
// - memories: short durable facts, preferences, decisions and rules distilled from conversations and meetings (or
//   told to remember), recalled when relevant (keyword + meaning search, fused) and shown as chips;
// - context cards: files the owner drops (PDF, DOCX, XLSX, CSV, text), read to text, summarised and searchable, scoped by
//   where they were dropped (the workspace, a project, a coworker).

export type MemoryKind = 'fact' | 'preference' | 'decision' | 'person' | 'client' | 'rule' | 'excerpt';
export const MEMORY_KINDS: readonly MemoryKind[] = ['fact', 'preference', 'decision', 'person', 'client', 'rule', 'excerpt'];
export type MemorySource = 'talk' | 'desk' | 'meeting' | 'card' | 'owner';

/** 'workspace', 'project:<projectId>' or 'coworker:<personaId>'. */
export type MemoryScope = string;

export interface MemoryItem {
  memoryId: string;
  text: string;
  kind: MemoryKind;
  scope: MemoryScope;
  source: MemorySource;
  /** Where it came from, in words ("Talk, 29 Sep", "menu.pdf", "Kickoff: Spring menu launch"). */
  sourceLabel?: string;
  /** A card's id (excerpts), a project's id (meetings). */
  sourceRef?: string;
  pinned: boolean;
  uses: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A memory as a reply shows it (a recall chip). */
export interface Recalled {
  memoryId: string;
  text: string;
  kind: MemoryKind;
  sourceLabel?: string;
}

export interface MemoryListResponse {
  memories: MemoryItem[];
}

export interface MemorySearchResponse {
  results: (MemoryItem & { score: number })[];
}

export const MEMORY_TEXT_MAX = 600;

export interface MemoryCreate {
  text: string;
  kind?: MemoryKind;
  scope?: MemoryScope;
}

export interface MemoryPatch {
  text?: string;
  kind?: MemoryKind;
  pinned?: boolean;
}

// ── the Handbook ───────────────────────────────────────────────────────────────────

export const HANDBOOK_SECTIONS = [
  { id: 'business', title: 'The business', ask: 'what the business is, where, how long, and what makes it different' },
  { id: 'customers', title: 'Customers', ask: 'who the customers are and what they value' },
  { id: 'offer', title: 'Products and services', ask: 'what it sells, with prices where they matter' },
  { id: 'clients', title: 'Key clients and partners', ask: 'the clients, suppliers and partners who matter, by name' },
  { id: 'team', title: 'People and roles', ask: 'who works there and who decides what' },
  { id: 'rules', title: 'Standing rules', ask: 'how things are always (or never) done: approvals, hours, money, tone' },
  { id: 'voice', title: 'Voice and brand', ask: 'how the business sounds and looks' },
  { id: 'goals', title: 'Goals', ask: 'what the owner wants this year, and what worries them' },
] as const;

export type HandbookSectionId = (typeof HANDBOOK_SECTIONS)[number]['id'];
export const HANDBOOK_SECTION_MAX = 4000;

export interface HandbookSection {
  id: HandbookSectionId;
  title: string;
  content: string;
  updatedAt?: string;
  updatedBy?: 'owner' | 'chief';
}

export interface HandbookResponse {
  sections: HandbookSection[];
  /** The Chief of Staff is interviewing the owner to fill it. */
  interviewing: boolean;
  /** The whole Handbook as one Markdown file (company.md). */
  markdown: string;
}

export interface HandbookPatch {
  content: string;
}

// ── context cards ──────────────────────────────────────────────────────────────────

export type CardKind = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'text';
export const CARD_UPLOAD_MAX = 10 * 1024 * 1024;

export interface ContextCard {
  cardId: string;
  name: string;
  kind: CardKind;
  bytes: number;
  /** Characters of text read from it. */
  chars: number;
  scope: MemoryScope;
  /** Two or three sentences on what it is. */
  summary?: string;
  /** Searchable pieces. */
  chunks: number;
  createdAt: string;
}

export interface CardsResponse {
  cards: ContextCard[];
}

export interface CardResponse {
  card: ContextCard;
  /** The start of its text (a preview). */
  text?: string;
}
