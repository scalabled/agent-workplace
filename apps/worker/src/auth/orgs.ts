// Organizations (ext/orgs.ts): the ones you belong to, starting one (you become its owner), switching the session to
// another, renaming the current one, and the platform page for the deployment's owners.
import { cleanOfficeName, type CreateOrgRequest, type CreateOrgResponse, type OrgsResponse, type PlatformResponse, type RenameOrgRequest } from '@headcount/protocol/ext/orgs';
import { forgetOfficeName } from '../lib/office';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { homeWorkspace } from '../lib/tenant';
import { clearRoleCache, maxOrgs, mayCreateOrg, orgsFor, setSessionOrg, signupMode } from './auth';

const rand = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
export const newOrgId = () => `org_${rand(12)}`;

/** Only name characters, at most ORG_NAME_MAX (the name reaches the agents' instructions). */
const cleanName = (raw: unknown): string => cleanOfficeName(raw);

/** GET /api/orgs: yours, the current one, and whether you may start another. */
export const handleListOrgs: RouteHandler = async (_req, rc) => {
  const email = rc.account?.email ?? rc.identity?.email ?? '';
  if (!email) {
    // Local mode: the one office on this computer.
    const home = homeWorkspace(rc.env);
    return json<OrgsResponse>({ orgs: [{ orgId: home, name: 'This computer', role: 'owner', home: true }], current: home, canCreate: false, why: 'On this computer there is one office. Deployed, everyone signs in with Google and starts their own.' });
  }
  const [orgs, may] = await Promise.all([orgsFor(rc.env, email), mayCreateOrg(rc.env, email)]);
  return json<OrgsResponse>({ orgs, current: rc.identity?.orgId ?? null, canCreate: may.ok, ...(may.ok ? {} : { why: may.why }) });
};

/** POST /api/orgs {name}: start an organization; you are its owner, and this session moves to it. */
export const handleCreateOrg: RouteHandler = async (req, rc) => {
  const acct = rc.account;
  if (!acct) throw new HttpError('bad_request', 'On this computer there is one office; sign-in (deployed) is where organizations begin.');
  const b = await readJson<Partial<CreateOrgRequest>>(req);
  const name = cleanName(b?.name);
  if (name.length < 2) throw new HttpError('bad_request', 'Name your organization (your business, team or project).');
  const may = await mayCreateOrg(rc.env, acct.email);
  if (!may.ok) throw new HttpError('forbidden', may.why);
  const orgId = newOrgId();
  const at = new Date().toISOString();
  await rc.env.DB.batch([
    rc.env.DB.prepare('INSERT INTO orgs (org_id, name, created_at, created_by) VALUES (?, ?, ?, ?)').bind(orgId, name, at, acct.email),
    rc.env.DB.prepare('INSERT INTO members (ws_id, email, name, role, added_at, added_by) VALUES (?, ?, ?, ?, ?, ?)').bind(orgId, acct.email, acct.name, 'owner', at, acct.email),
  ]);
  await setSessionOrg(rc.env, acct.tokenHash, orgId);
  clearRoleCache();
  return json<CreateOrgResponse>({ org: { orgId, name, role: 'owner', createdAt: at } }, { status: 201 });
};

/** POST /api/orgs/:id/switch: work in another organization you belong to. */
export const handleSwitchOrg: RouteHandler = async (_req, rc) => {
  const acct = rc.account;
  if (!acct) throw new HttpError('bad_request', 'On this computer there is one office.');
  const target = rc.params.id ?? '';
  const org = (await orgsFor(rc.env, acct.email)).find((o) => o.orgId === target);
  if (!org) throw new HttpError('not_found', 'You are not a member of that organization.');
  await setSessionOrg(rc.env, acct.tokenHash, target);
  return json({ org });
};

/** PUT /api/org {name}: rename the current organization (owners). The home one too: its name shows in the app. */
export const handleRenameOrg: RouteHandler = async (req, rc) => {
  const name = cleanName((await readJson<Partial<RenameOrgRequest>>(req))?.name);
  if (name.length < 2) throw new HttpError('bad_request', 'Give it a name of at least two letters, using letters, numbers, spaces and & \' . , -');
  const orgId = rc.identity?.orgId ?? homeWorkspace(rc.env);
  forgetOfficeName(orgId);
  await rc.env.DB.prepare('INSERT INTO orgs (org_id, name, created_at, created_by) VALUES (?, ?, ?, ?) ON CONFLICT (org_id) DO UPDATE SET name = excluded.name')
    .bind(orgId, name, new Date().toISOString(), rc.identity?.email ?? '')
    .run();
  return json({ org: { orgId, name } });
};

/** GET /api/platform/orgs: every organization on the deployment (its owners only). */
export const handlePlatformOrgs: RouteHandler = async (_req, rc) => {
  const rows =
    (
      await rc.env.DB.prepare(
        `SELECT o.org_id, o.name, o.created_at, o.created_by, COUNT(m.email) AS members, MAX(m.last_seen_at) AS last_seen
         FROM orgs o LEFT JOIN members m ON m.ws_id = o.org_id GROUP BY o.org_id ORDER BY o.created_at DESC LIMIT 500`,
      ).all<{ org_id: string; name: string; created_at: string; created_by: string; members: number; last_seen: string | null }>()
    ).results ?? [];
  return json<PlatformResponse>({
    orgs: rows.map((r) => ({ orgId: r.org_id, name: r.name, createdAt: r.created_at, createdBy: r.created_by, members: Number(r.members), ...(r.last_seen ? { lastSeenAt: r.last_seen } : {}) })),
    signup: signupMode(rc.env),
    maxOrgs: maxOrgs(rc.env),
  });
};
