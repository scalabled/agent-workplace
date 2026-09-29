#!/usr/bin/env node
// node scripts/voice-samples.mjs — pre-voices each lead's landing-page sample ("Hi, I'm Sunny. I'd be your chief
// of staff. …") through the running worker's TTS route (POST /api/speech/tts, response "json": the worker holds
// the keys, this script never sees them), then writes the audio and its lip-sync timing to
// apps/web/public/marketing/voices/: <leadId>-<n>.<ext> per sentence and manifest.json
// {<leadId>: {text, provider, voice, chunks: [{file, mime, text, alignment}]}}.
//
// The landing page plays these static files (D5's pre-voiced cache): "Hear …" works without a key, a public
// visitor never spends the TTS budget, and the face lip-syncs from the stored timing. Each run spends one TTS
// call per sentence (TTS_DAILY_LIMIT).
//
// Options: --worker <url> (default http://127.0.0.1:8787) · --only <leadId>[,<leadId>] · --force (re-voice leads
//          that already have a sample) · --dry-run (print the lines, call nothing)

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps/web/public/marketing/voices');
const manifestPath = join(outDir, 'manifest.json');

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const values = (name) =>
  args
    .flatMap((a, i) => (a === name && args[i + 1] && !args[i + 1].startsWith('--') ? [args[i + 1]] : a.startsWith(`${name}=`) ? [a.slice(name.length + 1)] : []))
    .flatMap((v) => v.split(','))
    .map((s) => s.trim())
    .filter(Boolean);

if (has('--help') || has('-h')) {
  console.log('Usage: node scripts/voice-samples.mjs [--only <leadId,leadId>] [--force] [--dry-run] [--worker <url>]');
  process.exit(0);
}

const worker = (values('--worker')[0] ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const only = values('--only');
const force = has('--force');
const dryRun = has('--dry-run');

const slim = (await import(pathToFileURL(join(root, 'packages/catalog/generated/slim.js')).href)).default;
const preview = slim.matchQuiz?.try_before_choosing?.voice_preview_line ?? null;

/** The same words as apps/web/src/landing/LeadCarousel.tsx sampleText(). */
function sampleText(first) {
  const intro = `Hi, I'm ${first}.`;
  if (!preview) return intro;
  return `${intro} ${preview.replace(/^Hi,\s*/i, '').replace(/^./, (c) => c.toUpperCase())}`;
}

/** Sentences (short ones joined up), so the first plays while the next downloads, without choppy gaps. */
function sentences(text) {
  const parts = text.match(/[^.!?]+[.!?]+(\s|$)/g)?.map((s) => s.trim()) ?? [text];
  const out = [];
  for (const p of parts) {
    if (out.length && out[out.length - 1].length < 40) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  return out;
}

const unknown = only.filter((id) => !slim.leads.some((l) => l.id === id));
if (unknown.length) {
  console.error(`Unknown lead ${unknown.join(', ')}.`);
  process.exit(1);
}

const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const leads = slim.leads.filter((l) => (!only.length || only.includes(l.id)) && (force || !manifest[l.id]));
if (!leads.length) {
  console.log('Every lead already has a voice sample (use --force to re-voice).');
  process.exit(0);
}

if (dryRun) {
  for (const l of leads) console.log(`${l.id.padEnd(28)} ${sentences(sampleText(l.name.split(' ')[0])).join(' | ')}`);
  process.exit(0);
}

try {
  const res = await fetch(`${worker}/api/capabilities`, { signal: AbortSignal.timeout(10_000) });
  const caps = await res.json();
  if (!caps.modalities?.tts?.available) {
    console.error(`Voice samples need a speech provider. Add ${(caps.modalities?.tts?.missingKeys ?? ['OPENAI_API_KEY', 'XAI_API_KEY']).join(' or ')} to apps/worker/.dev.vars, then restart pnpm dev.`);
    process.exit(1);
  }
} catch (err) {
  console.error(`The worker is not reachable at ${worker} (${err.message}). Start it with pnpm dev.`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const EXT = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mp4': 'm4a' };
let failed = 0;
for (const lead of leads) {
  const first = lead.name.split(' ')[0];
  const text = sampleText(first);
  const voiceRef = { openai: lead.voice.openai_tts, xai: lead.voice.xai_tts, speed: lead.voice.speed, ...(lead.voice.tts_instructions ? { instructions: lead.voice.tts_instructions } : {}) };
  try {
    const chunks = [];
    let provider = '';
    let voice = '';
    for (const [n, sentence] of sentences(text).entries()) {
      const res = await fetch(`${worker}/api/speech/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: sentence, voiceRef, speakerId: `landing:${lead.id}`, response: 'json' }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error?.message ?? `the worker answered ${res.status}`);
      const ext = EXT[body.mime] ?? 'bin';
      const file = `${lead.id}-${n}.${ext}`;
      writeFileSync(join(outDir, file), Buffer.from(body.audioBase64, 'base64'));
      chunks.push({ file: `/marketing/voices/${file}`, mime: body.mime, text: sentence, alignment: body.alignment ?? null });
      provider = body.provider;
      voice = body.voice;
    }
    // Drop files of an older, longer sample.
    for (const old of manifest[lead.id]?.chunks ?? []) if (!chunks.some((c) => c.file === old.file)) rmSync(join(root, 'apps/web/public', old.file), { force: true });
    manifest[lead.id] = { text, provider, voice, chunks };
    console.log(`${lead.id.padEnd(28)} ${chunks.length} sentence${chunks.length === 1 ? '' : 's'} · ${provider}/${voice}${chunks.every((c) => c.alignment) ? ' · timing' : ' · no timing (text-timed mouth)'}`);
  } catch (err) {
    failed++;
    console.log(`${lead.id.padEnd(28)} failed: ${err.message}`);
  }
}

const ordered = Object.fromEntries(slim.leads.filter((l) => manifest[l.id]).map((l) => [l.id, manifest[l.id]]));
writeFileSync(manifestPath, `${JSON.stringify(ordered, null, 2)}\n`);
console.log(`Manifest: ${Object.keys(ordered).length} of ${slim.leads.length} leads in ${manifestPath.slice(root.length + 1)}`);
process.exit(failed ? 1 : 0);
