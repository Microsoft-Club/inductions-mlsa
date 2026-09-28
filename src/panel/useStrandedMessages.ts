import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';
import { chatDraftKey, forgetUnsent, unsentMessages } from './chatDrafts.ts';

/**
 * Messages written about an earlier candidate that never reached the server: the connection dropped
 * and the next candidate was sent in before it came back. They go out again on every board reload
 * (each keeps its id, so none can post twice). Returns the interviews still holding one, for Recent.
 * The interview on screen is left to its own chat, which shows and retries its messages itself (if
 * it is opened while a send is under way, both may post the same message once; the id keeps one copy).
 */
export function useStrandedMessages(userId: string, shownId: string | null, boardVersion: string): Set<string> {
  const api = useApi();
  const sending = useRef(false);
  const [, setRound] = useState(0);

  useEffect(() => {
    const stranded = unsentMessages(userId).filter((m) => m.interviewId !== shownId);
    if (sending.current || stranded.length === 0) return;
    sending.current = true;
    void (async () => {
      for (const m of stranded) {
        try {
          await api.postMessage(m.interviewId, m.body, m.id);
          forgetUnsent(chatDraftKey(userId, m.interviewId), m.id);
        } catch (e) {
          // An undone send-in takes no messages, so this one can never go; anything else is retried.
          if (errorMessage(e) === 'Interview not found') forgetUnsent(chatDraftKey(userId, m.interviewId), m.id);
        }
      }
      sending.current = false;
      setRound((n) => n + 1);
    })();
  }, [api, userId, shownId, boardVersion]);

  return new Set(unsentMessages(userId).filter((m) => m.interviewId !== shownId).map((m) => m.interviewId));
}
