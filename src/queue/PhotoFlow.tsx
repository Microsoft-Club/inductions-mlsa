import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { buttonClasses } from '../components/ActionButton.tsx';
import { useRunAction } from '../components/ActionProvider.tsx';
import { useToast } from '../components/Toasts.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import type { LaneEntry } from '../lib/types.ts';
import { CaptureView } from '../photos/CaptureView.tsx';

interface PanelRef {
  id: string;
  name: string;
}

interface SendTarget {
  entry: LaneEntry;
  panel: PanelRef;
}

interface PhotoFlow {
  /** Sends the person in, or first asks what to do when they have no photo yet. */
  sendIn(entry: LaneEntry, panel: PanelRef): Promise<unknown>;
  takePhoto(entry: LaneEntry): void;
}

const PhotoFlowContext = createContext<PhotoFlow | null>(null);

export function usePhotoFlow(): PhotoFlow {
  const flow = useContext(PhotoFlowContext);
  if (!flow) throw new Error('usePhotoFlow() must be used inside <PhotoFlowProvider>');
  return flow;
}

/** The queue board's photo steps: the "no photo yet" question at Send in, and the capture view. Goes inside ActionProvider. */
export function PhotoFlowProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const run = useRunAction();
  const [asking, setAsking] = useState<SendTarget | null>(null);
  const [capturing, setCapturing] = useState<{ entry: LaneEntry; thenSend: SendTarget | null } | null>(null);
  const toast = useToast();

  // With nobody sitting in the panel, the server lines the person up for it instead of starting an interview.
  const sendNow = useCallback(
    async ({ entry, panel }: SendTarget) => {
      const interviewId = await api.sendIn(entry.candidate_id, panel.id);
      if (interviewId === null) {
        toast.show(`Nobody is sitting in ${panel.name} yet, so #${entry.number} is lined up for it. Send them in once a panelist has joined.`, 'info');
      }
      return interviewId;
    },
    [api, toast],
  );

  const flow = useMemo<PhotoFlow>(
    () => ({
      async sendIn(entry, panel) {
        if (entry.has_photo) return sendNow({ entry, panel });
        setAsking({ entry, panel });
      },
      takePhoto: (entry) => setCapturing({ entry, thenSend: null }),
    }),
    [sendNow],
  );

  const send = (target: SendTarget) => void run(() => sendNow(target));

  return (
    <PhotoFlowContext.Provider value={flow}>
      {children}
      {asking && (
        <NoPhotoDialog
          target={asking}
          onTakePhoto={() => {
            setCapturing({ entry: asking.entry, thenSend: asking });
            setAsking(null);
          }}
          onSendAnyway={() => {
            setAsking(null);
            send(asking);
          }}
          onCancel={() => setAsking(null)}
        />
      )}
      {capturing && (
        <CaptureView
          candidate={{ id: capturing.entry.candidate_id, number: capturing.entry.number, name: capturing.entry.name }}
          currentVersion={null}
          onSaved={() => {
            setCapturing(null);
            if (capturing.thenSend) send(capturing.thenSend);
          }}
          onClose={() => setCapturing(null)}
        />
      )}
    </PhotoFlowContext.Provider>
  );
}

interface NoPhotoDialogProps {
  target: SendTarget;
  onTakePhoto: () => void;
  onSendAnyway: () => void;
  onCancel: () => void;
}

function NoPhotoDialog({ target, onTakePhoto, onSendAnyway, onCancel }: NoPhotoDialogProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby="no-photo-title" aria-describedby="no-photo-text" className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-xl">
        <h2 id="no-photo-title" className="text-lg font-semibold">
          No photo yet
        </h2>
        <p id="no-photo-text" className="text-sm text-slate-700">
          <span className="tabular-nums">#{target.entry.number}</span> <bdi>{target.entry.name}</bdi> has no photo yet. Take one now, or send
          them in to {target.panel.name} without it?
        </p>
        <div className="flex flex-col gap-2">
          <button type="button" autoFocus className={buttonClasses('primary', 'md')} onClick={onTakePhoto}>
            Take photo
          </button>
          <button type="button" className={buttonClasses('secondary', 'md')} onClick={onSendAnyway}>
            Send without photo
          </button>
          <button type="button" className={buttonClasses('ghost', 'md')} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** The camera button next to a name in the pool or a panel's line, for people without a photo. */
export function NoPhotoButton({ entry }: { entry: LaneEntry }) {
  const { takePhoto } = usePhotoFlow();
  return (
    <button
      type="button"
      onClick={() => takePhoto(entry)}
      aria-label={`Take a photo of #${entry.number}`}
      title="No photo yet"
      className="shrink-0 rounded-md p-1 text-amber-700 hover:bg-amber-50"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
        <circle cx="12" cy="13" r="3" />
        <path d="M3 3l18 18" />
      </svg>
    </button>
  );
}
