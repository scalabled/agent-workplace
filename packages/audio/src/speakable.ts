/**
 * Markdown → words worth saying aloud. Chief of Staff replies are Markdown; TTS and the browser voice
 * would otherwise read "asterisk asterisk" and URLs. Works per chunk (unbalanced markers are simply
 * dropped); fenced code is tracked across chunks by SpeakableFilter.
 */
export function speakable(text: string): string {
  let t = text;
  t = t.replace(/```[\s\S]*?```/g, ' '); // whole fences inside one chunk
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // images → alt text
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // links → their text
  t = t.replace(/<(https?:\/\/[^>]+)>/g, ' ');
  t = t.replace(/\bhttps?:\/\/\S+/g, ' ');
  t = t.replace(/`([^`]*)`/g, '$1');
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, ''); // headings
  t = t.replace(/^[ \t]{0,3}>[ \t]?/gm, ''); // quotes
  t = t.replace(/^[ \t]*(?:[-*+•]|\d+[.)])[ \t]+/gm, ''); // list markers
  t = t.replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*$/gm, ''); // table rules
  t = t.replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, row: string) => `${row.split('|').map((c) => c.trim()).filter(Boolean).join(', ')}.`); // table rows
  t = t.replace(/\s*\|\s*/g, ', '); // stray pipes
  t = t.replace(/(\*\*|__|~~)/g, '');
  t = t.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?;:]|$)/g, '$1$2');
  t = t.replace(/[*_`#]/g, '');
  t = t.replace(/^[,\s]+|[,\s]+$/g, '');
  return t.replace(/\s+/g, ' ').trim();
}

/** Stateful wrapper that also drops fenced code blocks spanning several chunks. */
export class SpeakableFilter {
  private inFence = false;

  push(chunk: string): string {
    let out = '';
    let rest = chunk;
    for (;;) {
      const i = rest.indexOf('```');
      if (i === -1) {
        if (!this.inFence) out += rest;
        break;
      }
      if (!this.inFence) out += rest.slice(0, i);
      this.inFence = !this.inFence;
      rest = rest.slice(i + 3);
    }
    return speakable(out);
  }

  reset(): void {
    this.inFence = false;
  }
}
