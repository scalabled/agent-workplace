// Screen readers hear each finished Chief of Staff message once (not every streamed word), on every screen:
// a job that finishes while the owner is on the Floor is announced there too.
import { useEffect, useState } from 'preact/hooks';
import { CHIEF_ID } from '@headcount/protocol';
import { chiefName } from '../chief';
import { route } from '../router';
import { onFrame } from '../store';

const MAX = 400;

export function Announcer() {
  const [text, setText] = useState('');
  useEffect(
    () =>
      onFrame((f, { live }) => {
        if (!live || f.type !== 'talk.message' || f.data.agentId !== CHIEF_ID) return;
        const body = f.data.text.length > MAX ? `${f.data.text.slice(0, MAX)}…` : f.data.text;
        // Off Talk, say who is speaking: the thread is not on screen.
        setText(route.value.name === 'talk' ? body : `${chiefName.value}: ${body}`);
      }),
    [],
  );
  return (
    <div class="visually-hidden" aria-live="polite" data-announcer>
      {text}
    </div>
  );
}
