// What a panelist hasn't got onto the server yet, per interview: the text they are typing and any
// message that failed or was still sending. Kept in localStorage, like evaluation drafts, so it
// survives the workspace switching to the next candidate, a reload, and the tab being closed.

export interface ChatDraft {
  text: string;
  unsent: Array<{ id: string; body: string }>;
}

const EMPTY: ChatDraft = { text: '', unsent: [] };

const KEY_PREFIX = 'induction:chat-draft:';

/** Per person and interview, so panelists sharing a laptop never see each other's drafts. */
export function chatDraftKey(userId: string, interviewId: string): string {
  return `${KEY_PREFIX}${userId}:${interviewId}`;
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
    const raw = localStorage.getItem(key);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    return isChatDraft(parsed) ? parsed : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function saveChatDraft(key: string, draft: ChatDraft): void {
  try {
    if (!draft.text && draft.unsent.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the chat still works, the draft just won't survive a switch.
  }
}

/** Every message this person wrote that hasn't reached the server yet, in any interview. */
export function unsentMessages(userId: string): Array<{ interviewId: string; id: string; body: string }> {
  const prefix = `${KEY_PREFIX}${userId}:`;
  const found: Array<{ interviewId: string; id: string; body: string }> = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      for (const u of loadChatDraft(key).unsent) found.push({ interviewId: key.slice(prefix.length), ...u });
    }
  } catch {
    // Storage unavailable: nothing was kept, so there is nothing to send.
  }
  return found;
}

/** A message reached the server: don't bring it back, even if the chat was closed meanwhile. */
export function forgetUnsent(key: string, id: string): void {
  const draft = loadChatDraft(key);
  saveChatDraft(key, { ...draft, unsent: draft.unsent.filter((u) => u.id !== id) });
}
