// Short videos from a description through xAI (grok-imagine-video): POST /v1/videos/generations answers a request id;
// GET /v1/videos/{id} says pending, then done with a temporary URL (or failed / expired). The key stays here.
export const XAI_VIDEO_MODEL = 'grok-imagine-video-1.5';
const BASE = 'https://api.x.ai/v1';

export interface VideoJob {
  provider: 'xai';
  requestId: string;
  model: string;
}

export type VideoState = { status: 'pending' } | { status: 'done'; url: string; seconds?: number } | { status: 'failed'; message: string };

export async function startVideo(o: { key: string; prompt: string; aspect: string; seconds: number; fetch?: typeof fetch }): Promise<VideoJob> {
  const res = await (o.fetch ?? fetch)(`${BASE}/videos/generations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${o.key}` },
    body: JSON.stringify({ model: XAI_VIDEO_MODEL, prompt: o.prompt, duration: o.seconds, aspect_ratio: o.aspect, resolution: '720p' }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'xAI refused the key. An owner checks XAI_API_KEY in Admin → Settings.' : res.status === 429 ? 'xAI is busy or the account is out of credit. Try again later.' : `xAI did not take the request (${res.status}). Try again.`);
  const body = (await res.json()) as { request_id?: unknown };
  if (typeof body.request_id !== 'string' || !body.request_id) throw new Error('xAI did not say how to find the video. Try again.');
  return { provider: 'xai', requestId: body.request_id, model: XAI_VIDEO_MODEL };
}

export async function videoStatus(o: { key: string; job: VideoJob; fetch?: typeof fetch }): Promise<VideoState> {
  const res = await (o.fetch ?? fetch)(`${BASE}/videos/${encodeURIComponent(o.job.requestId)}`, { headers: { authorization: `Bearer ${o.key}` }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return { status: 'failed', message: 'xAI no longer has that video. Try again.' };
  if (!res.ok) throw new Error(`xAI status check failed (${res.status}).`);
  const body = (await res.json()) as { status?: string; video?: { url?: string; duration?: number; respect_moderation?: boolean } };
  if (body.status === 'done') {
    if (body.video?.respect_moderation === false || !body.video?.url) return { status: 'failed', message: 'xAI would not make that video. Try a different description.' };
    return { status: 'done', url: body.video.url, ...(typeof body.video.duration === 'number' ? { seconds: Math.round(body.video.duration) } : {}) };
  }
  if (body.status === 'failed') return { status: 'failed', message: 'xAI could not make that video. Try a different description.' };
  if (body.status === 'expired') return { status: 'failed', message: 'The video expired before it could be kept. Try again.' };
  return { status: 'pending' };
}

/** A two-second placeholder clip (a square crossing a purple frame) for development and tests without a key. */
export const MOCK_MP4_BASE64 = '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';
