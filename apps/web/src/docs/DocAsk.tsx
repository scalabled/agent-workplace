// Working inside documents: select any passage of a document (a deliverable, a job's write-up, a Handbook section, a
// canvas document) to ask the agent who wrote it about that exact spot, or to copy a link to it. The side chat lives in
// the document's panel (DocThreads), pinned to the passage; every thread has its own link too.
import type { ComponentChildren } from 'preact';
import type { DocRef, DocThread } from '@headcount/protocol/ext/threads';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api/client';
import { mayContribute } from '../auth/session';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { Markdown } from '../components/Markdown';
import { CopyLink } from '../links/CopyLink';
import { copyLink } from '../links/links';
import { linkTo, navigate, paths, queryParam, setQuery } from '../router';
import { asking, docThreads, errorOf, loadThreads, openThread, putThread } from './threads';
import './docs.css';

export interface Selected {
  anchor: string;
  quote: string;
  /** Where to show the bar, relative to the host. */
  x: number;
  y: number;
}

/** The little bar over a selected passage: ask about it, or link to that spot. */
export function SelectionBar({ sel, doc, page, agent, onDone }: { sel: Selected; doc: DocRef; page: string; agent: string; onDone: () => void }) {
  return (
    <div class="doc-select-bar" role="toolbar" aria-label="The selected passage" style={{ left: `${sel.x}px`, top: `${sel.y}px` }} onMouseDown={(e) => e.preventDefault()}>
      {mayContribute.value && (
        <button
          type="button"
          class="doc-select-ask"
          onClick={() => {
            asking.value = { doc, anchor: sel.anchor, quote: sel.quote };
            openThread.value = null;
            onDone();
          }}
        >
          <Icon name="ask" size={15} /> Ask {agent}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          void copyLink(linkTo(page, sel.anchor || undefined), 'Link to this spot');
          onDone();
        }}
      >
        <Icon name="link" size={15} /> Copy link to here
      </button>
    </div>
  );
}

/** A document rendered in the app, with the selection bar over whatever is selected in it. */
export function DocAsk({ doc, page, agent, children }: { doc: DocRef; page: string; agent: string; children: ComponentChildren }) {
  const box = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<Selected | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const s = typeof getSelection === 'function' ? getSelection() : null;
        const host = box.current;
        const quote = s ? String(s).replace(/\s+/g, ' ').trim() : '';
        if (!s || !host || !quote || !s.anchorNode || !host.contains(s.anchorNode) || !s.rangeCount) return setSel(null);
        let el: Element | null = s.anchorNode.nodeType === 1 ? (s.anchorNode as Element) : s.anchorNode.parentElement;
        while (el && el !== host && !el.id) el = el.parentElement;
        const r = s.getRangeAt(0).getBoundingClientRect();
        const b = host.getBoundingClientRect();
        setSel({ anchor: el && el !== host ? el.id : '', quote: quote.slice(0, 600), x: Math.max(8, r.left - b.left + r.width / 2), y: Math.max(0, r.top - b.top) });
      }, 10);
    };
    document.addEventListener('mouseup', check);
    document.addEventListener('keyup', check);
    document.addEventListener('touchend', check);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mouseup', check);
      document.removeEventListener('keyup', check);
      document.removeEventListener('touchend', check);
    };
  }, []);
  return (
    <div class="doc-ask" ref={box}>
      {children}
      {sel && (
        <SelectionBar
          sel={sel}
          doc={doc}
          page={page}
          agent={agent}
          onDone={() => {
            setSel(null);
            getSelection()?.removeAllRanges();
          }}
        />
      )}
    </div>
  );
}

const when = (at: string) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * A document's side chats: the question box for a passage just selected, the threads (each pinned to its passage, each
 * with its own link), and the open one. `onShow` takes the reader to a passage (the default: this page's link to it).
 */
export function DocThreads({ doc, page, agent, onShow }: { doc: DocRef; page: string; agent: string; onShow?: (anchor: string) => void }) {
  const threads = docThreads.value[doc] ?? [];
  const ask = asking.value?.doc === doc ? asking.value : null;
  const wanted = queryParam('thread');
  const panel = useRef<HTMLElement>(null);
  useEffect(() => void loadThreads(doc), [doc]);
  // A link to a thread (`?thread=`) opens it.
  useEffect(() => {
    if (wanted && threads.some((t) => t.threadId === wanted)) {
      openThread.value = wanted;
      requestAnimationFrame(() => panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  }, [wanted, threads.length]);
  useEffect(() => {
    if (ask) requestAnimationFrame(() => panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }, [ask?.quote]);
  const open = threads.find((t) => t.threadId === openThread.value) ?? null;
  const show = (anchor: string, threadId?: string) => (onShow ? onShow(anchor) : navigate(linkTo(page, anchor || undefined, threadId ? { thread: threadId } : {})));
  const pick = (id: string | null) => {
    openThread.value = id;
    setQuery({ thread: id });
  };
  return (
    <section class="panel doc-threads" ref={panel} aria-label="Questions and changes">
      <header class="doc-threads-head">
        <h2 class="admin-card-title">Questions and changes{threads.length ? ` (${threads.length})` : ''}</h2>
        {open && (
          <button type="button" class="link-button" onClick={() => pick(null)}>
            All
          </button>
        )}
      </header>
      {ask && <NewThread doc={doc} agent={agent} anchor={ask.anchor} quote={ask.quote} onOpen={(t) => pick(t.threadId)} />}
      {open ? (
        <ThreadView thread={open} page={page} onShow={() => show(open.anchor, open.threadId)} />
      ) : (
        <>
          {!threads.length && !ask && <p class="page-fine">Select any passage above to ask {agent} about it (or to copy a link to that spot). The conversation stays here, pinned to the passage.</p>}
          {threads.length > 0 && (
            <ul class="doc-thread-list">
              {threads.map((t) => (
                <li key={t.threadId} id={t.threadId} data-status={t.status}>
                  <button type="button" class="doc-thread-row" onClick={() => pick(t.threadId)}>
                    <span class="doc-thread-quote">«{t.quote.length > 90 ? `${t.quote.slice(0, 88)}…` : t.quote}»</span>
                    <span class="connector-meta">
                      {t.messages.length} {t.messages.length === 1 ? 'message' : 'messages'} · {when(t.updatedAt)}
                      {t.status === 'resolved' ? ' · resolved' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function NewThread({ doc, agent, anchor, quote, onOpen }: { doc: DocRef; agent: string; anchor: string; quote: string; onOpen: (t: DocThread) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => input.current?.focus(), [quote]);
  const send = async (e: Event) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.startThread({ doc, anchor, quote, text: text.trim() });
      putThread(r.thread);
      asking.value = null;
      onOpen(r.thread);
    } catch (err) {
      setError(errorOf(err, 'That did not go through. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="doc-thread-new needs-contributor" onSubmit={send} aria-label={`Ask ${agent} about the passage`}>
      <blockquote class="doc-thread-passage">{quote}</blockquote>
      <label class="visually-hidden" for={`ask-${doc}`}>
        What would you like to know or change?
      </label>
      <textarea
        id={`ask-${doc}`}
        ref={input}
        class="field-input"
        rows={2}
        value={text}
        placeholder={`Ask ${agent} about this, or say what to change…`}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) void send(e);
        }}
      />
      <span class="memory-add-actions">
        <button type="button" class="link-button" onClick={() => (asking.value = null)}>
          Cancel
        </button>
        <button type="submit" class="button-primary" disabled={busy || !text.trim()}>
          {busy ? `Asking ${agent}…` : `Ask ${agent}`}
        </button>
      </span>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function ThreadView({ thread: t, page, onShow }: { thread: DocThread; page: string; onShow: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ thread: DocThread }>) => {
    setBusy(true);
    setError(null);
    try {
      putThread((await fn()).thread);
      return true;
    } catch (err) {
      setError(errorOf(err, 'That did not go through. Try again.'));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="doc-thread" data-status={t.status}>
      <div class="doc-thread-top">
        <blockquote class="doc-thread-passage">{t.quote}</blockquote>
        <span class="doc-thread-tools">
          <button type="button" class="link-button" onClick={onShow}>
            Show in the document
          </button>
          <CopyLink page={linkTo(page, t.anchor || undefined, { thread: t.threadId })} label="Copy link to this conversation" what="Link to this conversation" />
        </span>
      </div>
      <ol class="doc-thread-messages">
        {t.messages.map((m, i) => (
          <li key={i} data-from={m.from === 'owner' ? 'owner' : 'agent'}>
            <span class="side-who">{m.name}</span>
            {m.from === 'owner' ? <p class="doc-thread-text">{m.text}</p> : <Markdown text={m.text} class="doc-thread-text" />}
            {m.action?.kind === 'revised' && m.action.canvasId && (
              <Link class="msg-project" href={paths.canvasItem(m.action.canvasId)}>
                Open the new version <Icon name="chevronRight" size={14} />
              </Link>
            )}
            {m.action?.kind === 'handbook' && <span class="connector-tag">Handbook updated</span>}
          </li>
        ))}
        {busy && (
          <li data-from="agent" class="doc-thread-typing">
            <span class="side-who">{t.agentName}</span> is answering…
          </li>
        )}
      </ol>
      <form
        class="doc-thread-reply needs-contributor"
        onSubmit={async (e) => {
          e.preventDefault();
          if (text.trim() && (await run(() => api.replyThread(t.threadId, text.trim())))) setText('');
        }}
      >
        <label class="visually-hidden" for={`reply-${t.threadId}`}>
          Reply to {t.agentName}
        </label>
        <textarea id={`reply-${t.threadId}`} class="field-input" rows={2} value={text} placeholder={`Reply to ${t.agentName}…`} onInput={(e) => setText(e.currentTarget.value)} />
        <span class="memory-add-actions">
          <button type="button" class="link-button" disabled={busy} onClick={() => void run(() => api.resolveThread(t.threadId, t.status === 'open' ? 'resolved' : 'open'))}>
            {t.status === 'open' ? 'Mark resolved' : 'Reopen'}
          </button>
          <button type="submit" class="button-primary" disabled={busy || !text.trim()}>
            Send
          </button>
        </span>
      </form>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
