// Images and short videos from a description (Phase 4), for the Chief of Staff in Talk and for coworkers in their work.
// Making one takes a moment (an image) or a minute or two (a video): in Talk it is made in the background and the Chief
// brings it to the thread when it is ready; in a project step the image is waited for and embedded in the work.
import type { AgentTool, ToolOutcome } from '@headcount/agent-loop';
import { FILE_PROMPT_MAX, IMAGE_ASPECTS, VIDEO_ASPECTS, VIDEO_SECONDS_MAX, type FileView } from '@headcount/protocol/ext/files';

export interface MediaToolHost {
  image(req: { prompt: string; aspect?: string }): Promise<{ ok: true; file: FileView } | { ok: false; message: string }>;
  video?(req: { prompt: string; aspect?: string; seconds?: number }): Promise<{ ok: true; file: FileView } | { ok: false; message: string }>;
}

const ok = (payload: Record<string, unknown>, summary: string): ToolOutcome => ({ ok: true, content: JSON.stringify(payload), summary });
const fail = (error: string, fix: string): ToolOutcome => ({ ok: false, error: JSON.stringify({ error, fix, say: error }) });
const sayOf = (out: string) => {
  try {
    return String((JSON.parse(out) as { say?: unknown }).say ?? 'Done.');
  } catch {
    return out;
  }
};
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export const MEDIA_TRIGGERS = {
  image: [String.raw`\b(make|create|draw|generate|design) (me )?(an? )?(image|picture|illustration|photo|logo|banner|graphic|poster|mock-?up)\b`],
  video: [String.raw`\b(make|create|generate) (me )?(an? )?(short )?(video|clip|animation|reel)\b`],
};
const describedIn = (text: string) => text.replace(/^.*?\b(of|showing|with|for)\s+/i, '').slice(0, 400) || text;

/** For the Chief in Talk: started now, brought to the thread when ready. */
export function mediaTools(host: MediaToolHost): AgentTool<any>[] {
  const image: AgentTool<{ prompt?: unknown; aspect?: unknown }> = {
    spec: {
      name: 'make_image',
      description:
        'Make an image from a description: a product shot, a social post graphic, a banner, a logo idea, an illustration. It takes a moment and is made in the background; you post it here when it is ready, and it is kept in Files. Returns the file id. Tell the owner in one sentence that you are making it. Fails when no image model is set up.',
      parameters: {
        type: 'object',
        properties: { prompt: { type: 'string', description: 'The full description: subject, style, colors, mood, and any text on the image.' }, aspect: { type: 'string', enum: [...IMAGE_ASPECTS], description: '1:1 square (default), 16:9 wide, 4:3, or 3:4 tall.' } },
        required: ['prompt'],
        additionalProperties: false,
      },
      mock: { triggers: MEDIA_TRIGGERS.image, args: (text: string) => ({ prompt: describedIn(text) }), reply: sayOf },
    },
    async execute(args) {
      const prompt = str(args.prompt);
      if (prompt.length < 3) return fail('Describe the image first.', 'Say what it shows, its style and colors.');
      const r = await host.image({ prompt: prompt.slice(0, FILE_PROMPT_MAX), ...(typeof args.aspect === 'string' ? { aspect: args.aspect } : {}) });
      if (!r.ok) return fail(r.message, 'Tell the owner what is needed, or describe the image in words instead.');
      return ok({ fileId: r.file.fileId, status: r.file.status, say: `I'm making it now: “${r.file.title}”. It'll be here in a moment, and in [Files](/app/files).` }, `Making an image: ${r.file.title}`);
    },
  };
  const tools: AgentTool<any>[] = [image];
  const video = host.video;
  if (video) {
    const make: AgentTool<{ prompt?: unknown; aspect?: unknown; seconds?: unknown }> = {
      spec: {
        name: 'make_video',
        description: `Make a short video, up to ${VIDEO_SECONDS_MAX} seconds, from a description: a product teaser, a social clip, an animated scene. It takes a minute or two and is made in the background; you post it here when it is ready, and it is kept in Files. Returns the file id. Tell the owner in one sentence that you are making it. Fails when no video model is set up.`,
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The scene, camera movement and mood.' },
            aspect: { type: 'string', enum: [...VIDEO_ASPECTS], description: '16:9 wide (default), 9:16 for reels and stories, 1:1, 4:3 or 3:4.' },
            seconds: { type: 'number', description: `1 to ${VIDEO_SECONDS_MAX} (default 6).` },
          },
          required: ['prompt'],
          additionalProperties: false,
        },
        mock: { triggers: MEDIA_TRIGGERS.video, args: (text: string) => ({ prompt: describedIn(text) }), reply: sayOf },
      },
      async execute(args) {
        const prompt = str(args.prompt);
        if (prompt.length < 3) return fail('Describe the video first.', 'Say what happens, the camera and the mood.');
        const r = await video({ prompt: prompt.slice(0, FILE_PROMPT_MAX), ...(typeof args.aspect === 'string' ? { aspect: args.aspect } : {}), ...(typeof args.seconds === 'number' ? { seconds: args.seconds } : {}) });
        if (!r.ok) return fail(r.message, 'Tell the owner what is needed, or describe the video as a storyboard instead.');
        return ok({ fileId: r.file.fileId, status: r.file.status, say: `I'm making the video now: “${r.file.title}”. It takes a minute or two; I'll post it here, and it's kept in [Files](/app/files).` }, `Making a video: ${r.file.title}`);
      },
    };
    tools.push(make);
  }
  return tools;
}

/** For a coworker's work (a project step): the image is waited for, and its Markdown goes into the work. */
export function stepImageTool(make: (req: { prompt: string; aspect?: string }) => Promise<{ ok: true; file: FileView } | { ok: false; message: string }>): AgentTool<{ prompt?: unknown; aspect?: unknown }> {
  return {
    spec: {
      name: 'make_image',
      description:
        'Make an image for this piece of work when the deliverable needs one: a product shot, a social graphic, a banner, an illustration. Waits until the image is ready and returns Markdown; put it in your work where the image belongs. Use it at most twice per step. Fails when the image cannot be made; then describe the image in words instead.',
      parameters: {
        type: 'object',
        properties: { prompt: { type: 'string', description: 'The full description: subject, style, colors, mood, and any text on the image.' }, aspect: { type: 'string', enum: [...IMAGE_ASPECTS], description: '1:1 square (default), 16:9 wide, 4:3, or 3:4 tall.' } },
        required: ['prompt'],
        additionalProperties: false,
      },
      mock: { triggers: [String.raw`\(with an image\)`], args: (text: string) => ({ prompt: `An illustration for: ${text.slice(0, 200)}` }), reply: () => 'Made the image.' },
    },
    async execute(args) {
      const prompt = str(args.prompt);
      if (prompt.length < 3) return fail('Describe the image first.', 'Say what it shows, its style and colors.');
      const r = await make({ prompt: prompt.slice(0, FILE_PROMPT_MAX), ...(typeof args.aspect === 'string' ? { aspect: args.aspect } : {}) });
      if (!r.ok) return fail(r.message, 'Describe the image in words in your work instead.');
      if (r.file.status !== 'ready' || !r.file.url) return fail(r.file.error ?? 'The image could not be made.', 'Describe the image in words in your work instead.');
      return ok({ markdown: `![${r.file.title.replace(/[[\]]/g, '')}](${r.file.url})`, note: 'Put this Markdown in your work where the image belongs.' }, `Made an image: ${r.file.title}`);
    },
  };
}
