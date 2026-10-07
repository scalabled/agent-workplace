// Organizations (multi-tenant Headcount): everyone who signs in with Google can start an organization (their own
// office, with its own Chief of Staff, team, memory and files) or join one they were invited to. Each organization's
// data lives apart: its own Durable Objects (each with its own SQLite database), its own rows in D1, and its own
// R2 prefix (ws/<orgId>/…).
import type { Role } from './admin';

export const ORG_ID_RE = /^(org_[a-z0-9]{12}|[a-z0-9][a-z0-9_-]{0,39})$/;
export const ORG_NAME_MAX = 60;

/**
 * An office's name as it may appear anywhere, the agents' instructions included: letters (any script), digits, spaces
 * and the few marks a business name uses (& ' ’ . , -), at most ORG_NAME_MAX characters. Everything else (quotes,
 * brackets, colons, newlines, symbols) is dropped: a name can hold a few plain words, never markup, quoted text, line
 * breaks or a paragraph. '' when nothing name-like is left (at least two letters or digits).
 */
export function cleanOfficeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const name = raw
    .normalize('NFKC')
    .replace(/[^\p{L}\p{M}\p{N} &'’.,-]/gu, ' ')
    // A mark belongs to the letter before it; one left behind by a dropped symbol (an emoji's variation selector) goes.
    .replace(/(?<![\p{L}\p{N}\p{M}])\p{M}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ORG_NAME_MAX)
    .trim();
  return (name.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2 ? name : '';
}

/** How the agents name the office, the custom name defined in brackets: "Amethyst & Co (the owner's AI office)". */
export function officeLabel(name: string | null | undefined, fallback: string): string {
  return `${cleanOfficeName(name) || fallback} (the owner's AI office)`;
}

export interface OrgView {
  orgId: string;
  name: string;
  role: Role;
  /** The office this deployment started with (its owners are named in the deployment). */
  home?: boolean;
  createdAt?: string;
}

/** open: anyone with a verified Google account may start an organization · invite: only people already invited somewhere (or the deployment's owners) · closed: no new organizations. */
export type SignupMode = 'open' | 'invite' | 'closed';

export interface OrgsResponse {
  orgs: OrgView[];
  /** The organization this session works in (null: none yet). */
  current: string | null;
  /** May this person start another organization now? */
  canCreate: boolean;
  /** Why not, in words. */
  why?: string;
}

export interface CreateOrgRequest {
  name: string;
}

export interface CreateOrgResponse {
  org: OrgView;
}

export interface RenameOrgRequest {
  name: string;
}

/** Platform view for the deployment's owners: every organization and how busy it is. */
export interface PlatformOrg {
  orgId: string;
  name: string;
  createdAt: string;
  createdBy: string;
  members: number;
  lastSeenAt?: string;
}

export interface PlatformResponse {
  orgs: PlatformOrg[];
  signup: SignupMode;
  maxOrgs: number;
}
