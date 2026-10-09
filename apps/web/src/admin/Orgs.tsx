// Organizations on the Admin page: this office's name (owners rename it in a dialog), the offices you belong to (switch
// to one), starting another (a dialog); and for the deployment's owners, every organization on the platform.
import type { OrgsResponse, PlatformResponse } from '@headcount/protocol/ext/orgs';
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { BRAND } from '@headcount/protocol';
import { auth, canCreateOrg, currentOrg, isOwner, myOrgs, switchOrg } from '../auth/session';
import { Icon } from '../components/Icon';
import { CopyLink } from '../links/CopyLink';
import { paths } from '../router';
import { openOfficeDialog } from './OfficeDialogs';

const ROLE: Record<string, string> = { owner: 'Owner', contributor: 'Contributor', reader: 'Reader' };
const when = (at?: string) => (at ? new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export function OrgCard() {
  const [data, setData] = useState<OrgsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (auth.value.status !== 'signed-in') return;
    void api
      .listOrgs()
      .then((r) => {
        setData(r);
        myOrgs.value = r.orgs;
      })
      .catch(() => undefined);
  }, []);
  const signedIn = auth.value.status === 'signed-in';
  // This computer (sign-in off): one office, which its owner can still name.
  if (!signedIn && auth.value.status !== 'open') return null;
  const here = currentOrg.value;
  const orgs = data?.orgs ?? myOrgs.value ?? (here ? [{ orgId: here.orgId, name: here.name, role: 'owner' as const }] : []);
  return (
    <section class="panel admin-card" aria-labelledby="adm-org" id="organization">
      <div class="page-title-row">
        <h2 id="adm-org" class="admin-card-title">
          Organization
        </h2>
        <CopyLink page={paths.admin()} at="organization" label="Copy link to the organization" what="Link to it" />
      </div>
      <p class="page-fine">This office’s team, memory and files belong to it alone. Invite people on the People page.</p>
      <ul class="setting-rows">
        <li class="setting-row">
          <div class="setting-text">
            <span class="setting-label">Office name</span>
            <span class="setting-value">{here?.name ?? BRAND.name}</span>
            <span class="setting-hint">Shown at the top of the app in place of {BRAND.name}, and the name your team uses.</span>
          </div>
          {isOwner.value && (
            <button type="button" class="button-quiet" onClick={() => openOfficeDialog('rename')}>
              Rename
            </button>
          )}
        </li>
      </ul>
      {signedIn && orgs.length > 0 && (
        <>
          <h3 class="setting-group">Your offices</h3>
          <ul class="setting-rows">
            {orgs.map((o) => {
              const current = o.orgId === here?.orgId;
              return (
                <li key={o.orgId} class="setting-row" data-current={current || undefined}>
                  <div class="setting-text">
                    <span class="setting-value">{o.name}</span>
                    <span class="setting-hint">{ROLE[o.role]}</span>
                  </div>
                  {current ? (
                    <span class="setting-here">
                      <Icon name="check" size={14} /> You’re here
                    </span>
                  ) : (
                    <button type="button" class="button-quiet" onClick={() => void switchOrg(o.orgId).then(setError)}>
                      Switch to it
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {canCreateOrg.value && (
        <div class="admin-row">
          <button type="button" class="button-quiet" onClick={() => openOfficeDialog('new')}>
            <Icon name="plus" size={16} /> Start another office
          </button>
        </div>
      )}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function PlatformSection() {
  const [data, setData] = useState<PlatformResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api
      .platformOrgs()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the organizations.'));
  }, []);
  return (
    <section class="panel admin-card" aria-labelledby="adm-platform">
      <h2 id="adm-platform" class="admin-card-title">
        Every organization
      </h2>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <p class="page-fine">
            Sign-up is <strong>{data.signup === 'open' ? 'open to anyone with Google' : data.signup === 'invite' ? 'invite-only' : 'closed'}</strong> (SIGNUP_MODE), at most {data.maxOrgs} organizations (MAX_ORGS). {data.orgs.length} so far.
          </p>
          <table class="admin-table">
            <thead>
              <tr>
                <th scope="col">Organization</th>
                <th scope="col">Started by</th>
                <th scope="col">People</th>
                <th scope="col">Started</th>
                <th scope="col">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {data.orgs.map((o) => (
                <tr key={o.orgId}>
                  <th scope="row">{o.name}</th>
                  <td>{o.createdBy}</td>
                  <td>{o.members}</td>
                  <td>{when(o.createdAt)}</td>
                  <td>{when(o.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
