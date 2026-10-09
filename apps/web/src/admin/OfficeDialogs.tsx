// The office's own dialogs, opened from wherever you are (the office name at the top of the sidebar, ⌘K, Admin):
// rename this office, or start another. One field each, so the change is never lost among other settings.
import { signal } from '@preact/signals';
import { BRAND } from '@headcount/protocol';
import { ORG_NAME_MAX } from '@headcount/protocol/ext/orgs';
import { api, ApiError } from '../api/client';
import { createOrg, currentOrg, myOrgs } from '../auth/session';
import { TextDialog } from '../components/Dialog';
import { showToast } from '../links/links';

/** Which office dialog is open. */
export const officeDialog = signal<'rename' | 'new' | null>(null);

export function openOfficeDialog(which: 'rename' | 'new'): void {
  officeDialog.value = which;
}

/** Rename this office: null when done, else the sentence to show. */
export async function renameOffice(name: string): Promise<string | null> {
  try {
    const r = await api.renameOrg(name);
    currentOrg.value = r.org;
    myOrgs.value = myOrgs.value?.map((o) => (o.orgId === r.org.orgId ? { ...o, name: r.org.name } : o)) ?? null;
    showToast(`Renamed to “${r.org.name}”.`);
    return null;
  } catch (err) {
    return err instanceof ApiError ? err.message : 'Not renamed. Try again.';
  }
}

export function OfficeDialogs() {
  const which = officeDialog.value;
  if (!which) return null;
  const close = () => (officeDialog.value = null);
  if (which === 'rename')
    return (
      <TextDialog
        title="Rename this office"
        lede={`Shown at the top of the app in place of ${BRAND.name}, and the name your team uses.`}
        label="Office name"
        value={currentOrg.value?.name ?? ''}
        placeholder="Your business’s name"
        maxLength={ORG_NAME_MAX}
        min={2}
        action="Rename"
        autoComplete="organization"
        save={renameOffice}
        onClose={close}
      />
    );
  return (
    <TextDialog
      title="Start another office"
      lede="For another business: its own Chief of Staff, team, memory and files, kept apart from this one. You choose its Chief of Staff next."
      label="Its name"
      value=""
      placeholder="e.g. Amethyst & Co"
      maxLength={ORG_NAME_MAX}
      min={2}
      action="Start the office"
      autoComplete="organization"
      save={(name) => createOrg(name)}
      onClose={close}
    />
  );
}
