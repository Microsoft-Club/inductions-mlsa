import { useEffect, useRef, useState } from 'react';
import { buttonClasses } from '../components/ActionButton.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import { parseServerTime } from '../lib/clock.ts';
import type { LiveSnapshot } from '../lib/useLiveSnapshot.ts';
import type { InterviewLive } from './useInterviewLive.ts';

const MAX_LENGTH = 2000;

interface Pending {
  id: string;
  body: string;
  failed: boolean;
}

interface ChatPanelProps {
  interviewId: string;
  live: LiveSnapshot<InterviewLive>;
  meId: string;
  /** The phone's Chat tab is open. A hidden list can't scroll, so it scrolls to the newest message on opening. */
  tabOpen?: boolean;
}

/** The panel's discussion about this candidate. Your messages show at once and are matched to the saved copy. */
export function ChatPanel({ interviewId, live, meId, tabOpen = false }: ChatPanelProps) {
  const api = useApi();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const listRef = useRef<HTMLOListElement>(null);
  const saved = live.data?.messages ?? [];
  const savedIds = new Set(saved.map((m) => m.id));
  const unsaved = pending.filter((p) => !savedIds.has(p.id));

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [saved.length, unsaved.length, tabOpen]);

  async function deliver(id: string, body: string) {
    setPending((list) => list.map((p) => (p.id === id ? { ...p, failed: false } : p)));
    try {
      await api.postMessage(interviewId, body, id); // the same id on a retry, so it can't post twice
      live.reload();
    } catch {
      setPending((list) => list.map((p) => (p.id === id ? { ...p, failed: true } : p)));
    }
  }

  function send() {
    const body = draft.trim();
    if (!body || body.length > MAX_LENGTH) return;
    const id = crypto.randomUUID();
    setPending((list) => [...list, { id, body, failed: false }]);
    setDraft('');
    void deliver(id, body);
  }

  const tooLong = draft.trim().length > MAX_LENGTH;
  return (
    <section aria-label="Discussion" className="flex h-full min-h-[22rem] flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-baseline justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="font-semibold">Discussion</h2>
        {live.status === 'reconnecting' && <span className="text-xs font-medium text-amber-700">Reconnecting…</span>}
      </header>
      <ol ref={listRef} role="log" aria-label="Messages" className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {saved.length + unsaved.length === 0 && <li className="text-sm text-slate-500">No messages yet.</li>}
        {saved.map((m) => (
          <MessageItem key={m.id} author={m.author_id === meId ? 'You' : m.author_name} time={m.created_at} body={m.body} />
        ))}
        {unsaved.map((p) => (
          <MessageItem key={p.id} author="You" body={p.body} failed={p.failed} sending={!p.failed} onRetry={() => void deliver(p.id, p.body)} />
        ))}
      </ol>
      <form
        className="space-y-2 border-t border-slate-100 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          aria-label="Message"
          value={draft}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Write to the panel. Enter sends, Shift+Enter adds a line."
          className="block w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xs ${tooLong ? 'text-red-700' : 'text-slate-500'}`}>
            {draft.length > MAX_LENGTH - 200 ? `${draft.trim().length} / ${MAX_LENGTH}` : ''}
          </span>
          <button type="submit" className={buttonClasses('primary')} disabled={draft.trim() === '' || tooLong}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
}

interface MessageItemProps {
  author: string;
  body: string;
  time?: string;
  sending?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

function MessageItem({ author, body, time, sending, failed, onRetry }: MessageItemProps) {
  return (
    <li className={author === 'You' ? 'ml-6' : 'mr-6'}>
      <p className="flex items-baseline gap-2 text-xs text-slate-500">
        <span className="font-semibold text-slate-700">{author}</span>
        {time && <time dateTime={time}>{new Date(parseServerTime(time)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}
        {sending && <span>Sending…</span>}
        {failed && (
          <>
            <span className="font-medium text-red-700">Not sent</span>
            <button type="button" className="font-medium text-brand-700 underline" onClick={onRetry}>
              Retry
            </button>
          </>
        )}
      </p>
      <p dir="auto" className={`mt-0.5 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${author === 'You' ? 'bg-brand-50' : 'bg-slate-100'} ${failed ? 'opacity-60' : ''}`}>
        {body}
      </p>
    </li>
  );
}
