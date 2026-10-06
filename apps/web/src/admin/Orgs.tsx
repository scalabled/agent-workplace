// Organizations on the Admin page: this office's name (owners rename it), the other offices you belong to (switch to
// one), starting another; and for the deployment's owners, every organization on the platform.
import type { OrgsResponse, PlatformResponse } from '@headcount/protocol/ext/orgs';
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { auth, canCreateOrg, createOrg, currentOrg, isOwner, switchOrg } from '../auth/session';
import { CopyLink } from '../links/CopyLink';
import { paths } from '../router';

const ROLE: Record<string, string> = { owner: 'Owner', contributor: 'Contributor', reader: 'Reader' };
const when = (at?: string) => (at ? new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export function OrgCard() {
  const [data, setData] = useState<OrgsResponse | null>(null);
  const [name, setName] = useState(currentOrg.value?.name ?? '');
  const [fresh, setFresh] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api
      .listOrgs()
      .then(setData)
      .catch(() => undefined);
  }, []);
  const signedIn = auth.value.status === 'signed-in';
  if (!signedIn) return null; // this computer: one office
  const rename = async (e: Event) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.renameOrg(name.trim());
      currentOrg.value = r.org;
      setNote('Renamed.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Not renamed. Try again.');
    }
  };
  const start = async (e: Event) => {
    e.preventDefault();
    setError(await createOrg(fresh.trim()));
  };
  const others = (data?.orgs ?? []).filter((o) => o.orgId !== currentOrg.value?.orgId);
  return (
    <section class="panel admin-card" aria-labelledby="adm-org" id="organization">
      <div class="page-title-row">
        <h2 id="adm-org" class="admin-card-title">
          Organization
        </h2>
        <CopyLink page={paths.admin()} at="organization" label="Copy link to the organization" what="Link to it" />
      </div>
      <p class="page-fine">This office’s team, memory and files belong to it alone. Invite people on the People page.</p>
      {isOwner.value ? (
        <form class="admin-row" onSubmit={rename}>
          <label class="visually-hidden" for="org-rename">
            Organization name
          </label>
          <input id="org-rename" class="field-input" maxLength={80} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <button type="submit" class="button-quiet" disabled={name.trim().length < 2 || name.trim() === currentOrg.value?.name}>
            Rename
          </button>
          {note && (
            <span class="page-fine" role="status">
              {note}
            </span>
          )}
        </form>
      ) : (
        <p class="trust-class-name">{currentOrg.value?.name}</p>
      )}
      {others.length > 0 && (
        <>
          <h3 class="trust-class-name">Your other offices</h3>
          <ul class="trust-grants">
            {others.map((o) => (
              <li key={o.orgId} class="trust-grant">
                <span>
                  {o.name} <span class="page-fine">· {ROLE[o.role]}</span>
                </span>
                <button type="button" class="button-quiet" onClick={() => void switchOrg(o.orgId).then(setError)}>
                  Switch to it
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {canCreateOrg.value && (
        <form class="admin-row" onSubmit={start}>
          <label class="visually-hidden" for="org-new">
            Start another office
          </label>
          <input id="org-new" class="field-input" maxLength={80} placeholder="Start another office: its name" value={fresh} onInput={(e) => setFresh((e.target as HTMLInputElement).value)} />
          <button type="submit" class="button-quiet" disabled={fresh.trim().length < 2}>
            Start it
          </button>
        </form>
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
