// The top of the sidebar: this office's own name (owners rename it, so the app reads as theirs), and, for people who
// sign in with Google, a switcher between the offices they belong to and a way to start another. Rename and Start
// open their own small dialog (admin/OfficeDialogs.tsx) right here. On phones and tablets the sidebar's name is
// hidden; ⌘K (More) has the same switches.
import { BRAND } from '@headcount/protocol';
import { useEffect, useRef, useState } from 'preact/hooks';
import { auth, canCreateOrg, currentOrg, isOwner, loadOrgs, myOrgs, switchOrg } from '../auth/session';
import { openOfficeDialog } from '../admin/OfficeDialogs';
import { Icon } from './Icon';

const ROLE: Record<string, string> = { owner: 'Owner', contributor: 'Contributor', reader: 'Reader' };

export function OfficeSwitcher() {
  const name = currentOrg.value?.name ?? BRAND.name;
  const signedIn = auth.value.status === 'signed-in';
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    if (myOrgs.value === null) void loadOrgs();
    const away = (e: Event) => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  // On this computer (sign-in off) there is one office: its name, nothing to switch.
  if (!signedIn)
    return (
      <div class="nav-brand" title={name}>
        <span class="nav-brand-name">{name}</span>
      </div>
    );
  const dialog = (which: 'rename' | 'new') => {
    setOpen(false);
    openOfficeDialog(which);
  };
  const orgs = myOrgs.value ?? (currentOrg.value ? [{ orgId: currentOrg.value.orgId, name: currentOrg.value.name, role: 'owner' as const }] : []);
  return (
    <div class="nav-office" ref={host}>
      <button type="button" class="nav-brand nav-brand-button" aria-haspopup="menu" aria-expanded={open} aria-label={`${name}: switch office`} onClick={() => setOpen(!open)}>
        <span class="nav-brand-name">{name}</span>
        <Icon name="chevronDown" size={14} class="nav-brand-chevron" />
      </button>
      {open && (
        <div class="office-menu" role="menu" aria-label="Your offices">
          <p class="office-menu-head">Your offices</p>
          {orgs.map((o) => {
            const here = o.orgId === currentOrg.value?.orgId;
            return (
              <button
                key={o.orgId}
                type="button"
                role="menuitemradio"
                aria-checked={here}
                class="office-menu-item"
                disabled={here}
                onClick={() => void switchOrg(o.orgId).then(setError)}
              >
                <span class="office-menu-name">{o.name}</span>
                <span class="office-menu-role">{here ? <Icon name="check" size={14} /> : ROLE[o.role]}</span>
              </button>
            );
          })}
          <div class="office-menu-sep" role="separator" />
          {isOwner.value && (
            <button type="button" role="menuitem" class="office-menu-item" onClick={() => dialog('rename')}>
              <span class="office-menu-name">Rename this office</span>
            </button>
          )}
          {canCreateOrg.value && (
            <button type="button" role="menuitem" class="office-menu-item" onClick={() => dialog('new')}>
              <span class="office-menu-name">
                <Icon name="plus" size={14} /> Start another office
              </span>
            </button>
          )}
          {error && (
            <p class="form-error" role="alert">
              {error}
            </p>
          )}
          <p class="office-menu-foot">{BRAND.name}</p>
        </div>
      )}
    </div>
  );
}
