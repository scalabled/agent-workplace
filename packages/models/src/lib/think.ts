/**
 * Local reasoning models (qwen3, deepseek-r1) sometimes inline their thinking as `<think>…</think>` in the
 * content stream. This splits a delta stream into visible text and reasoning, including tags that arrive
 * split across chunks.
 */
export class ThinkSplitter {
  private inThink = false;
  private pending = '';

  push(delta: string): { text: string; reasoning: string } {
    let s = this.pending + delta;
    this.pending = '';
    let text = '';
    let reasoning = '';
    while (s) {
      const tag = this.inThink ? '</think>' : '<think>';
      const at = s.indexOf(tag);
      if (at !== -1) {
        if (this.inThink) reasoning += s.slice(0, at);
        else text += s.slice(0, at);
        s = s.slice(at + tag.length);
        this.inThink = !this.inThink;
        continue;
      }
      // Keep a possible partial tag at the end for the next chunk.
      const keep = partialSuffix(s, tag);
      const body = s.slice(0, s.length - keep);
      if (this.inThink) reasoning += body;
      else text += body;
      this.pending = s.slice(s.length - keep);
      s = '';
    }
    return { text, reasoning };
  }

  flush(): { text: string; reasoning: string } {
    const rest = this.pending;
    this.pending = '';
    return this.inThink ? { text: '', reasoning: rest } : { text: rest, reasoning: '' };
  }
}

function partialSuffix(s: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) if (tag.startsWith(s.slice(s.length - n))) return n;
  return 0;
}
