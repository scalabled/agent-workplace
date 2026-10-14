// Sharing files (Inc 4 context cards): where a file is dropped sets its scope (Talk and the Memory page: the whole
// workspace; a project page: that project; a coworker's profile: them). Each file is read to text on the server.
import { CARD_UPLOAD_MAX, type ContextCard } from '@headcount/protocol/ext/memory';
import { api, ApiError } from '../api/client';
import { catalog } from '../catalog';
import { shrinkImage } from '../lib/capture';
import { teamProjects } from '../store';

/** What the file picker offers (the server reads these; pictures are described by a vision model). */
export const FILE_ACCEPT = '.pdf,.docx,.xlsx,.csv,.tsv,.txt,.md,.markdown,.json,.yaml,.yml,.xml,.html,.htm,.rtf,.log,.png,.jpg,.jpeg,.webp,.gif,image/*';

export async function uploadFiles(files: Iterable<File>, scope?: string): Promise<{ added: ContextCard[]; errors: string[] }> {
  const added: ContextCard[] = [];
  const errors: string[] = [];
  for (const picked of files) {
    // A phone photo is made small enough to share (pictures are kept up to 5 MB).
    const file = picked.type.startsWith('image/') ? await shrinkImage(picked) : picked;
    if (file.size > CARD_UPLOAD_MAX) {
      errors.push(`${file.name}: files must be under 10 MB.`);
      continue;
    }
    if (!file.size) {
      errors.push(`${file.name}: the file is empty.`);
      continue;
    }
    try {
      added.push((await api.addCard(file, scope)).card);
    } catch (err) {
      errors.push(`${file.name}: ${err instanceof ApiError ? err.message : 'it could not be shared. Try another file.'}`);
    }
  }
  return { added, errors };
}

/** A scope in words: the workspace, a project's title, a coworker's name. */
export function scopeLabel(scope: string): string {
  if (scope === 'workspace') return 'Everyone';
  if (scope.startsWith('project:')) return teamProjects.value[scope.slice(8)]?.title ?? 'A project';
  if (scope.startsWith('coworker:')) return catalog.value?.persona(scope.slice(9))?.name ?? 'A coworker';
  return scope;
}

export function sizeOf(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
