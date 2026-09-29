// The office's own requests (OFFICE-PHASE2 §4.1, §4.3), light so the Floor can start the roster while the office chunk
// loads. Every failure of the roster is a null: the office then runs on neutral personalities.
import type { ExprClipRef } from '@headcount/protocol/ext/expressions';
import type { ExprHuddleRenderRequest, OfficePeopleResponse } from '@headcount/protocol/ext/rooms';
import { api } from '../api/client';

let people: { key: string; p: Promise<OfficePeopleResponse | null> } | null = null;

/**
 * GET /api/office/people, once per Chief of Staff (the browser's cache revalidates the ETag on the next visit).
 * `key` changes with the lead and the Chief's name: a new key fetches again.
 */
export function officePeople(key: string): Promise<OfficePeopleResponse | null> {
  if (people?.key === key) return people.p;
  const p = api
    .officePeople()
    .then((body) => (body && Array.isArray(body.people) ? body : null))
    .catch(() => null);
  people = { key, p };
  // A failure is not remembered: the next visit asks again (the worker may have been starting).
  void p.then((r) => {
    if (!r && people?.p === p) people = null;
  });
  return p;
}

/** POST /api/expr/huddle/render: one small-talk turn in the speaker's voice. Throws on failure. */
export function huddleRender(req: ExprHuddleRenderRequest, signal?: AbortSignal): Promise<ExprClipRef> {
  return api.exprHuddleRender(req, signal);
}

/** Tests: forget the cached roster. */
export function resetOfficeFetch(): void {
  people = null;
}
