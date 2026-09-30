// MCP connectors (biz-bot parity, Stage 5): the owner connects outside services (GitHub, Notion, docs servers…) that
// speak the Model Context Protocol over Streamable HTTP; coworkers and the Chief of Staff call their tools. Keys are
// encrypted at rest in the workspace and never come back to the browser; calls that change things wait for the
// owner's OK (a raised hand: once, for this project, or always).

export type ConnectorAuth = 'none' | 'token' | 'oauth';

/** One entry of the connector catalog (biz-bot public/connectors/catalog.json, plus ours). */
export interface ConnectorCatalogEntry {
  id: string;
  name: string;
  description: string;
  url: string;
  auth: ConnectorAuth;
  /** What key to paste and where to get it (keyed entries). */
  authHint?: string;
  docs?: string;
  /** Served inside the worker for keyless demos and tests (never on the network). */
  demo?: boolean;
  /** Only its read-only tools are offered (Inc 6: HubSpot reads the CRM; nothing writes to it). */
  readOnly?: boolean;
}

/**
 * When a call waits for the owner: every call ('ask', biz-bot's requireApproval), only tools not marked read-only by
 * the server ('writes'), or never.
 */
export type ConnectorApproval = 'ask' | 'writes' | 'never';
export const CONNECTOR_APPROVALS: readonly ConnectorApproval[] = ['ask', 'writes', 'never'];

export interface ConnectorToolView {
  name: string;
  title?: string;
  description: string;
  inputSchema: unknown;
  /** The server's hints (MCP tool annotations). */
  readOnly?: boolean;
  destructive?: boolean;
  /** Under the connector's approval policy, a call waits for the owner (unless a grant covers it). */
  needsApproval: boolean;
}

export type ConnectorStatus = 'ready' | 'needs_key' | 'error' | 'untested';

/** A standing permission the owner gave from a raised hand. */
export interface ConnectorGrantView {
  grantId: string;
  tool: string;
  scope: 'project' | 'always';
  projectId?: string;
  createdAt: string;
  uses: number;
}

export interface ConnectorView {
  connectorId: string;
  catalogId?: string;
  name: string;
  /** Tool-name prefix: `<slug>__<tool>`. */
  slug: string;
  url: string;
  auth: ConnectorAuth;
  /** A key is stored (the key itself never leaves the worker). */
  hasKey: boolean;
  approval: ConnectorApproval;
  /** Every coworker may use it (else only coworkers granted it on their page). */
  everyone: boolean;
  /** The Chief of Staff may use it in Talk. */
  chief: boolean;
  /** Coworkers granted it one by one (persona ids), when not everyone. */
  grantedTo: string[];
  status: ConnectorStatus;
  lastError?: string;
  tools: ConnectorToolView[];
  toolsAt?: string;
  server?: { name?: string; version?: string; protocolVersion?: string };
  grants: ConnectorGrantView[];
  calls: number;
  lastCallAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorsResponse {
  connectors: ConnectorView[];
  catalog: ConnectorCatalogEntry[];
  /** False when keys cannot be stored (CONNECTOR_SECRET unset on a deployed worker). */
  canStoreKeys: boolean;
}

export const CONNECTOR_TOKEN_MAX = 4096;
export const CONNECTOR_NAME_MAX = 60;

/** POST /api/connectors: from the catalog (catalogId) or a custom server (name + url). */
export interface ConnectorCreate {
  catalogId?: string;
  name?: string;
  url?: string;
  /** A key or token (sent once; stored encrypted). */
  token?: string;
  approval?: ConnectorApproval;
  everyone?: boolean;
  chief?: boolean;
}

/** PUT /api/connectors/:id. `token: null` removes the stored key. */
export interface ConnectorPatch {
  name?: string;
  token?: string | null;
  approval?: ConnectorApproval;
  everyone?: boolean;
  chief?: boolean;
}

export interface ConnectorResponse {
  connector: ConnectorView;
}

/** A connector call waiting for the owner (the Decision's `connector` field). */
export interface ConnectorAsk {
  connectorId: string;
  name: string;
  tool: string;
  /** The arguments, as pretty JSON (clipped). */
  args: string;
  /** Who wants to call it: a persona id or 'chief'. */
  subject: string;
}
