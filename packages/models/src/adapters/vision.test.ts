// Images the owner shows travel to every provider in its own shape; text-only messages are unchanged.
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types';
import { ToolNames } from '../lib/tools';
import { toAnthropicMessages } from './anthropic';
import { toGeminiContents } from './gemini';
import { toOllamaMessages } from './ollama';
import { toCompatMessages } from './openai-compatible';
import { toInputItems } from './responses';

const shown: ChatMessage[] = [{ role: 'user', content: 'What is on this receipt?', images: [{ mime: 'image/png', data: 'iVBORw0KGgo=' }] }];
const names = new ToolNames([]);

describe('images, per provider', () => {
  it('Anthropic: a base64 image block before the text', () => {
    expect(toAnthropicMessages(shown, names, false).messages[0]!.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
      { type: 'text', text: 'What is on this receipt?' },
    ]);
  });
  it('OpenAI and xAI (Responses): an input_image data URL', () => {
    expect(toInputItems(shown, names)).toEqual([{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,iVBORw0KGgo=' }, { type: 'input_text', text: 'What is on this receipt?' }] }]);
  });
  it('Gemini: inline data', () => {
    expect(toGeminiContents(shown, names)[0]!.parts).toEqual([{ inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } }, { text: 'What is on this receipt?' }]);
  });
  it('OpenAI-compatible: image_url parts; Ollama: the images field', () => {
    expect(toCompatMessages(undefined, shown, names)).toEqual([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }, { type: 'text', text: 'What is on this receipt?' }] }]);
    expect(toOllamaMessages(undefined, shown, names)).toEqual([{ role: 'user', content: 'What is on this receipt?', images: ['iVBORw0KGgo='] }]);
    expect(toCompatMessages(undefined, [{ role: 'user', content: 'hi' }], names)).toEqual([{ role: 'user', content: 'hi' }]);
  });
});
