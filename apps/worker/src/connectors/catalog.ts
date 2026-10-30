// The connector catalog: biz-bot's eleven (public/connectors/catalog.json) and a keyless demo served inside the worker
// when mocks are on (ENABLE_MOCK), so the whole flow can be tried and tested without the network.
import { BRAND } from '@headcount/protocol';
import type { ConnectorCatalogEntry } from '@headcount/protocol/ext/connectors';
import type { Env } from '../env';

export const CONNECTOR_CATALOG: readonly ConnectorCatalogEntry[] = [
  { id: 'cloudflare-docs', name: 'Cloudflare docs', description: "Search Cloudflare's developer documentation.", url: 'https://docs.mcp.cloudflare.com/mcp', auth: 'none', docs: 'https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/' },
  { id: 'deepwiki', name: 'DeepWiki', description: 'Ask questions about any public GitHub repository.', url: 'https://mcp.deepwiki.com/mcp', auth: 'none', docs: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp' },
  { id: 'github', name: 'GitHub', description: 'Issues, pull requests and code on GitHub.', url: 'https://api.githubcopilot.com/mcp/', auth: 'token', authHint: 'A GitHub personal access token with access to the repositories you want to reach.', docs: 'https://github.com/github/github-mcp-server' },
  { id: 'notion', name: 'Notion', description: 'Pages and databases in your Notion workspace.', url: 'https://mcp.notion.com/mcp', auth: 'oauth', authHint: 'Notion signs you in with OAuth; paste an access token if you have one.', docs: 'https://developers.notion.com/docs/mcp' },
  { id: 'hubspot', name: 'HubSpot', description: 'Contacts, companies, deals and tickets in your HubSpot CRM.', url: 'https://mcp.hubspot.com/anthropic', auth: 'oauth', authHint: 'A HubSpot private-app access token works here.', docs: 'https://developers.hubspot.com/mcp', readOnly: true },
  { id: 'quickbooks', name: 'QuickBooks', description: 'Your books at a glance: profit and loss, cash flow, customers and invoices.', url: 'https://ai-inc.quickbooks.intuit.com/v1/mcp', auth: 'oauth', authHint: 'Intuit signs you in with OAuth; paste an access token if you have one.' },
  { id: 'xero', name: 'Xero', description: 'Financial position, profit and loss, receivables and payables from Xero.', url: 'https://mcp.xero.com/mcp', auth: 'oauth', authHint: 'Xero signs you in with OAuth; paste an access token if you have one.', docs: 'https://developer.xero.com/documentation/xero-mcp-server/' },
  { id: 'asana', name: 'Asana', description: 'Tasks, projects and goals your team tracks in Asana.', url: 'https://mcp.asana.com/v2/mcp', auth: 'oauth', authHint: 'Asana signs you in with OAuth; paste an access token if you have one.', docs: 'https://developers.asana.com/docs/using-asanas-model-control-protocol-mcp-server' },
  { id: 'monday', name: 'monday.com', description: 'Boards, projects, tasks and CRM items in monday.com.', url: 'https://mcp.monday.com/mcp', auth: 'oauth', authHint: 'An API token from your monday.com developer settings works here.', docs: 'https://developer.monday.com/apps/docs/mondaycom-mcp-integration' },
  { id: 'calendly', name: 'Calendly', description: 'Your event types, availability and bookings in Calendly.', url: 'https://mcp.calendly.com/', auth: 'oauth', authHint: 'A personal access token from Calendly → Integrations works here.' },
  { id: 'buffer', name: 'Buffer', description: 'Plan, schedule and publish posts to X, LinkedIn, Facebook, Instagram and more, and see how they did.', url: 'https://mcp.buffer.com/mcp', auth: 'token', authHint: 'A Buffer API key (Buffer → developer settings). It reaches every channel in that Buffer account.', docs: 'https://developers.buffer.com/guides/integrations/mcp.html' },
  { id: 'canva', name: 'Canva', description: 'Find, create and export designs in your Canva account.', url: 'https://mcp.canva.com/mcp', auth: 'oauth', authHint: 'Canva signs you in with OAuth; paste an access token if you have one.', docs: 'https://www.canva.dev/docs/connect/canva-mcp-server-setup/' },
];

export const DEMO_CONNECTOR: ConnectorCatalogEntry = {
  id: 'demo-notebook',
  name: 'Demo notebook',
  description: `A tiny notebook served inside ${BRAND.name} (mock mode only): list, read and add notes.`,
  url: 'https://demo-notebook.mcp.invalid/mcp',
  auth: 'none',
  demo: true,
};

export function mocksOn(env: Pick<Env, 'ENABLE_MOCK'>): boolean {
  return String(env.ENABLE_MOCK ?? '').toLowerCase() === 'true';
}

export function connectorCatalog(env: Pick<Env, 'ENABLE_MOCK'>): ConnectorCatalogEntry[] {
  return mocksOn(env) ? [DEMO_CONNECTOR, ...CONNECTOR_CATALOG] : [...CONNECTOR_CATALOG];
}

/** Problems in a catalog (biz-bot validateConnectorCatalog): ids, names, https URLs, auth kinds, hints for keyed entries. */
export function validateCatalog(entries: readonly ConnectorCatalogEntry[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const c of entries) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(c.id)) errors.push(`bad id ${JSON.stringify(c.id)}`);
    if (ids.has(c.id)) errors.push(`duplicate id ${c.id}`);
    ids.add(c.id);
    if (!c.name) errors.push(`${c.id}: no name`);
    if (!/^https:\/\//.test(c.url)) errors.push(`${c.id}: url must be https`);
    if (!['none', 'token', 'oauth'].includes(c.auth)) errors.push(`${c.id}: unknown auth ${c.auth}`);
    if (c.auth !== 'none' && !c.authHint) errors.push(`${c.id}: a keyed connector needs an authHint`);
    if (c.docs && !/^https:\/\//.test(c.docs)) errors.push(`${c.id}: docs must be https`);
  }
  return errors;
}

/** A tool-name prefix from a connector name: lowercase letters, digits and dashes-as-underscores, at most 24. */
export function slugOf(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
    .replace(/_+$/, '');
  return s || 'connector';
}
