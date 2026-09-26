// What a panelist hasn't got onto the server yet, per interview: the text they are typing and any
// message that failed or was still sending. Kept in sessionStorage, so it survives the workspace
// switching to the next candidate (and a reload), but not closing the browser tab.

export interface ChatDraft {
  text: string;
  unsent: Array<{ id: string; body: string }>;
}

const EMPTY: ChatDraft = { text: '', unsent: [] };

/** Per person and interview, so panelists sharing a laptop never see each other's drafts. */
export function chatDraftKey(userId: string, interviewId: string): string {
  return `induction:chat-draft:${userId}:${interviewId}`;
}

function isChatDraft(value: unknown): value is ChatDraft {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.text === 'string' &&
    Array.isArray(d.unsent) &&
    d.unsent.every((u) => typeof u === 'object' && u !== null && typeof u.id === 'string' && typeof u.body === 'string')
  );
}

/** The saved draft, or an empty one if there is none, it is damaged, or storage is unavailable. */
export function loadChatDraft(key: string): ChatDraft {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    return isChatDraft(parsed) ? parsed : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function saveChatDraft(key: string, draft: ChatDraft): void {
  try {
    if (!draft.text && draft.unsent.length === 0) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the chat still works, the draft just won't survive a switch.
  }
}

/** A message reached the server: don't bring it back, even if the chat was closed meanwhile. */
export function forgetUnsent(key: string, id: string): void {
  const draft = loadChatDraft(key);
  saveChatDraft(key, { ...draft, unsent: draft.unsent.filter((u) => u.id !== id) });
}
