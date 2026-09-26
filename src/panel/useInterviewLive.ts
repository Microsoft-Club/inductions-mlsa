import { useCallback, useMemo } from 'react';
import { useApi } from '../lib/ApiProvider.tsx';
import type { ChatMessage } from '../lib/types.ts';
import { useLiveSnapshot, type LiveSnapshot } from '../lib/useLiveSnapshot.ts';

export interface InterviewLive {
  messages: ChatMessage[];
  evaluationCount: number;
}

/**
 * The chat and the number of submitted evaluations for one interview, kept live by the private
 * interview:<id> topic. One subscription per interview: the chat and the evaluation form share it.
 * Components using it are keyed by the interview id, so `load` never changes under a mounted hook.
 */
export function useInterviewLive(interviewId: string): LiveSnapshot<InterviewLive> {
  const api = useApi();
  const load = useCallback(async () => {
    const [messages, evaluationCount] = await Promise.all([api.interviewMessages(interviewId), api.evaluationCount(interviewId)]);
    return { messages, evaluationCount };
  }, [api, interviewId]);
  const subscribe = useMemo(() => api.subscribeInterview(interviewId), [api, interviewId]);
  return useLiveSnapshot(load, subscribe);
}
