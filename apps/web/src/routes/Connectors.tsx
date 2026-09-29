// Connectors (biz-bot parity: Settings → Connectors): outside services that speak the Model Context Protocol. The
// owner connects one from the catalog or by URL, pastes its key once (it stays on the server), tests it (its tools and
// what each takes), decides when a call waits for their OK and who may use it, and withdraws standing OKs.
import type { ConnectorApproval, ConnectorCatalogEntry, ConnectorsResponse, ConnectorView } from '@headcount/protocol/ext/connectors';
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { chiefName } from '../chief';
import { teamProjects } from '../store';
import './pages.css';

const STATUS_WORDS: Record<ConnectorView['status'], string> = { ready: 'Ready', needs_key: 'Needs a key', error: 'Cannot connect', untested: 'Not tested' };
const APPROVAL_WORDS: Record<ConnectorApproval, string> = { ask: 'Every call', writes: 'Calls that change things', never: 'Never ask' };

const errorOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function ago(at: string | undefined): string {
  if (!at) return '';
  const s = Math.max(0, (Date.now() - Date.parse(at)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export function Connectors() {
  const [data, setData] = useState<ConnectorsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .listConnectors()
      .then(setData)
      .catch((err) => setError(errorOf(err, 'Could not load the connectors.')));
  }, []);
  const put = (c: ConnectorView) => setData((d) => (d ? { ...d, connectors: d.connectors.some((x) => x.connectorId === c.connectorId) ? d.connectors.map((x) => (x.connectorId === c.connectorId ? c : x)) : [...d.connectors, c] } : d));
  const drop = (id: string) => setData((d) => (d ? { ...d, connectors: d.connectors.filter((x) => x.connectorId !== id) } : d));
  const connected = new Set((data?.connectors ?? []).map((c) => c.catalogId).filter(Boolean));
  return (
    <section class="page connectors-page" aria-labelledby="connectors-title">
      <header class="page-head">
        <h1 id="connectors-title">Connectors</h1>
        <p class="page-lede">
          Outside services your coworkers and {chiefName.value} can use, through the Model Context Protocol. Keys stay on the server and never come back to this page. Calls that change things wait for your OK.
        </p>
      </header>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p class="page-fine">Loading…</p>}
      {data && !data.canStoreKeys && <p class="panel connector-warning">Keys cannot be stored until the CONNECTOR_SECRET secret is set on the server. Connectors without a key still work.</p>}
      {data && data.connectors.length > 0 && (
        <section aria-labelledby="connected-title">
          <h2 id="connected-title" class="section-title">
            Connected
          </h2>
          <div class="connector-list">
            {data.connectors.map((c) => (
              <ConnectorCard key={c.connectorId} connector={c} onChange={put} onRemoved={drop} />
            ))}
          </div>
        </section>
      )}
      {data && (
        <section aria-labelledby="catalog-title">
          <h2 id="catalog-title" class="section-title">
            Add a connector
          </h2>
          <ul class="connector-catalog">
            {data.catalog.map((e) => (
              <CatalogEntry key={e.id} entry={e} connected={connected.has(e.id)} canStoreKeys={data.canStoreKeys} onAdded={put} />
            ))}
          </ul>
          <CustomServer canStoreKeys={data.canStoreKeys} onAdded={put} />
        </section>
      )}
    </section>
  );
}

function CatalogEntry({ entry, connected, canStoreKeys, onAdded }: { entry: ConnectorCatalogEntry; connected: boolean; canStoreKeys: boolean; onAdded: (c: ConnectorView) => void }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyed = entry.auth !== 'none';
  const connect = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.addConnector({ catalogId: entry.id, ...(token.trim() ? { token: token.trim() } : {}) });
      setToken('');
      setOpen(false);
      onAdded(r.connector);
    } catch (err) {
      setError(errorOf(err, 'That did not connect. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li class="panel connector-entry" data-open={open || undefined}>
      <div class="connector-entry-head">
        <div>
          <p class="connector-name">
            {entry.name}
            {keyed && <span class="connector-tag">{entry.auth === 'oauth' ? 'Sign-in or token' : 'Key'}</span>}
            {entry.demo && <span class="connector-tag">Demo</span>}
          </p>
          <p class="connector-desc">{entry.description}</p>
        </div>
        {connected ? (
          <span class="connector-status" data-status="ready">
            Connected
          </span>
        ) : (
          !open && (
            <button type="button" class="button-quiet button-small" aria-label={`Connect ${entry.name}`} onClick={() => (keyed ? setOpen(true) : void connect(new Event('submit')))} disabled={busy}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          )
        )}
      </div>
      {open && !connected && (
        <form class="connector-key-form" onSubmit={connect}>
          <p class="connector-hint">
            {entry.authHint}
            {entry.docs && (
              <>
                {' '}
                <a href={entry.docs} target="_blank" rel="noreferrer">
                  Docs
                </a>
              </>
            )}
          </p>
          <label class="visually-hidden" for={`key-${entry.id}`}>
            Key for {entry.name}
          </label>
          <input id={`key-${entry.id}`} class="field-input" type="password" autocomplete="off" placeholder={canStoreKeys ? 'Paste the key or token' : 'Keys cannot be stored on this server'} disabled={!canStoreKeys} value={token} onInput={(e) => setToken((e.target as HTMLInputElement).value)} />
          <div class="settings-actions">
            <button type="submit" class="button-primary" disabled={busy}>
              {busy ? 'Connecting…' : token.trim() ? 'Connect' : 'Add without a key'}
            </button>
            <button type="button" class="button-quiet" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function CustomServer({ canStoreKeys, onAdded }: { canStoreKeys: boolean; onAdded: (c: ConnectorView) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <button type="button" class="button-quiet connector-custom-open" onClick={() => setOpen(true)}>
        Add a server by URL
      </button>
    );
  const add = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.addConnector({ name: name.trim(), url: url.trim(), ...(token.trim() ? { token: token.trim() } : {}) });
      setName('');
      setUrl('');
      setToken('');
      setOpen(false);
      onAdded(r.connector);
    } catch (err) {
      setError(errorOf(err, 'That did not connect. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="panel connector-custom" onSubmit={add}>
      <h3 class="panel-title">A server by URL</h3>
      <p class="page-fine">Any MCP server reachable over https (Streamable HTTP). Private and local addresses are refused.</p>
      <label class="field">
        <span class="field-label">Name</span>
        <input class="field-input" maxLength={60} value={name} placeholder="Our wiki" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      <label class="field">
        <span class="field-label">Server URL</span>
        <input class="field-input" type="url" value={url} placeholder="https://example.com/mcp" onInput={(e) => setUrl((e.target as HTMLInputElement).value)} />
      </label>
      <label class="field">
        <span class="field-label">Key (optional)</span>
        <input class="field-input" type="password" autocomplete="off" disabled={!canStoreKeys} value={token} onInput={(e) => setToken((e.target as HTMLInputElement).value)} />
      </label>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <div class="settings-actions">
        <button type="submit" class="button-primary" disabled={busy || !name.trim() || !url.trim()}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        <button type="button" class="button-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ConnectorCard({ connector: c, onChange, onRemoved }: { connector: ConnectorView; onChange: (c: ConnectorView) => void; onRemoved: (id: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyOpen, setKeyOpen] = useState(c.status === 'needs_key' && !c.hasKey);
  const [token, setToken] = useState('');
  const [confirm, setConfirm] = useState(false);
  const run = async (what: string, fn: () => Promise<{ connector: ConnectorView }>) => {
    setBusy(what);
    setError(null);
    try {
      onChange((await fn()).connector);
      return true;
    } catch (err) {
      setError(errorOf(err, 'That did not go through. Try again.'));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const patch = (what: string, p: Parameters<typeof api.patchConnector>[1]) => run(what, () => api.patchConnector(c.connectorId, p));
  const remove = async () => {
    setBusy('remove');
    setError(null);
    try {
      await api.removeConnector(c.connectorId);
      onRemoved(c.connectorId);
    } catch (err) {
      setError(errorOf(err, 'That did not go through. Try again.'));
      setBusy(null);
    }
  };
  const projectTitle = (id?: string) => (id ? (teamProjects.value[id]?.title ?? 'a project') : '');
  const keyed = c.auth !== 'none' || c.hasKey;
  return (
    <article class="panel connector-card" data-status={c.status} aria-labelledby={`cn-${c.connectorId}`}>
      <header class="connector-card-head">
        <div>
          <h3 id={`cn-${c.connectorId}`} class="connector-name">
            {c.name}
          </h3>
          <p class="connector-url">{c.url}</p>
        </div>
        <span class="connector-status" data-status={c.status}>
          {STATUS_WORDS[c.status]}
        </span>
      </header>
      {c.lastError && c.status !== 'ready' && <p class="connector-error">{c.lastError}</p>}
      <p class="connector-meta tabular">
        {c.tools.length} {c.tools.length === 1 ? 'tool' : 'tools'}
        {c.server?.name ? ` · ${c.server.name}${c.server.version ? ` ${c.server.version}` : ''}` : ''}
        {c.calls ? ` · ${c.calls} ${c.calls === 1 ? 'call' : 'calls'}, last ${ago(c.lastCallAt)}` : ''}
      </p>

      <div class="connector-controls">
        <label class="field field-inline">
          <span class="field-label">Ask me before</span>
          <select class="field-input" value={c.approval} disabled={!!busy} onChange={(e) => void patch('approval', { approval: (e.target as HTMLSelectElement).value as ConnectorApproval })}>
            {(Object.keys(APPROVAL_WORDS) as ConnectorApproval[]).map((a) => (
              <option key={a} value={a}>
                {APPROVAL_WORDS[a]}
              </option>
            ))}
          </select>
        </label>
        <label class="grant-label">
          <input type="checkbox" checked={c.everyone} disabled={!!busy} onChange={(e) => void patch('everyone', { everyone: (e.target as HTMLInputElement).checked })} />
          <span>
            <span class="grant-name">Every coworker may use it</span>
            <span class="grant-desc">{c.everyone ? 'In project work.' : c.grantedTo.length ? `Only ${c.grantedTo.length} coworker${c.grantedTo.length === 1 ? '' : 's'} you switched it on for.` : 'Nobody yet: switch it on from a coworker’s page.'}</span>
          </span>
        </label>
        <label class="grant-label">
          <input type="checkbox" checked={c.chief} disabled={!!busy} onChange={(e) => void patch('chief', { chief: (e.target as HTMLInputElement).checked })} />
          <span>
            <span class="grant-name">{chiefName.value} may use it in Talk</span>
            <span class="grant-desc">Quick lookups and actions while you talk.</span>
          </span>
        </label>
      </div>

      {keyed && (
        <div class="connector-key">
          <p class="connector-meta">{c.hasKey ? 'A key is stored (it never leaves the server).' : 'No key stored.'}</p>
          {keyOpen ? (
            <form
              class="connector-key-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (token.trim())
                  void patch('key', { token: token.trim() }).then((ok) => {
                    if (ok) {
                      setToken('');
                      setKeyOpen(false);
                    }
                  });
              }}
            >
              <label class="visually-hidden" for={`newkey-${c.connectorId}`}>
                New key for {c.name}
              </label>
              <input id={`newkey-${c.connectorId}`} class="field-input" type="password" autocomplete="off" placeholder="Paste the key or token" value={token} onInput={(e) => setToken((e.target as HTMLInputElement).value)} />
              <button type="submit" class="button-primary button-small" disabled={!!busy || !token.trim()}>
                Save key
              </button>
              <button type="button" class="button-quiet button-small" onClick={() => setKeyOpen(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <div class="settings-actions">
              <button type="button" class="button-quiet button-small" onClick={() => setKeyOpen(true)}>
                {c.hasKey ? 'Replace the key' : 'Add a key'}
              </button>
              {c.hasKey && (
                <button type="button" class="button-quiet button-small" disabled={!!busy} onClick={() => void patch('key', { token: null })}>
                  Remove the key
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {c.tools.length > 0 && (
        <details class="connector-tools">
          <summary>What it can do ({c.tools.length})</summary>
          <ul>
            {c.tools.map((t) => (
              <li key={t.name} class="connector-tool">
                <p class="connector-tool-head">
                  <code>{t.name}</code>
                  <span class="connector-tag" data-asks={t.needsApproval || undefined}>
                    {t.needsApproval ? 'Asks you first' : 'Runs without asking'}
                  </span>
                  {t.readOnly && <span class="connector-tag">Reads only</span>}
                  {t.destructive && <span class="connector-tag">Can delete</span>}
                </p>
                {t.description && <p class="connector-tool-desc">{t.description}</p>}
                <details>
                  <summary>What it takes</summary>
                  <pre class="connector-schema">{JSON.stringify(t.inputSchema, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ul>
        </details>
      )}

      {c.grants.length > 0 && (
        <div class="connector-grants">
          <p class="field-label">Standing OKs</p>
          <ul>
            {c.grants.map((g) => (
              <li key={g.grantId}>
                <code>{g.tool}</code> {g.scope === 'always' ? 'always' : `for “${projectTitle(g.projectId)}”`}
                {g.uses ? ` · used ${g.uses}×` : ''}
                <button type="button" class="link-button" disabled={!!busy} onClick={() => void run('grant', () => api.revokeConnectorGrant(c.connectorId, g.grantId))}>
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <div class="settings-actions connector-actions">
        <button type="button" class="button-quiet button-small" disabled={!!busy} onClick={() => void run('test', () => api.testConnector(c.connectorId))}>
          {busy === 'test' ? 'Testing…' : 'Test'}
        </button>
        {confirm ? (
          <>
            <button type="button" class="button-danger button-small" disabled={!!busy} onClick={() => void remove()}>
              Disconnect {c.name}
            </button>
            <button type="button" class="button-quiet button-small" onClick={() => setConfirm(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" class="button-quiet button-small" onClick={() => setConfirm(true)}>
            Disconnect
          </button>
        )}
      </div>
    </article>
  );
}
