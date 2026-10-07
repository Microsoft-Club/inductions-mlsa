import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buttonClasses } from '../components/ActionButton.tsx';
import { usePhoto } from './usePhoto.ts';

const SIZES = {
  sm: 'h-10 w-10 text-sm',
  md: 'h-20 w-20 text-2xl',
  xl: 'mx-auto aspect-square w-full max-w-xs text-5xl',
} as const;

/** "AK" for "Ali Khan": what the placeholder shows. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .toUpperCase();
}

interface CandidatePhotoProps {
  candidateId: string;
  /** photo_taken_at; null = no photo. */
  version: string | null;
  name: string;
  size?: keyof typeof SIZES;
  /** Click or tap the photo to see it full size. Not for a photo inside another button. */
  expandable?: boolean;
}

/** A candidate's photo, or their initials on grey (never a broken image). */
export function CandidatePhoto({ candidateId, version, name, size = 'md', expandable = false }: CandidatePhotoProps) {
  const url = usePhoto(candidateId, version);
  const [broken, setBroken] = useState(false);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // A stored file that passed the magic-byte check but can't be decoded (e.g. it's truncated): reset
  // once we might be looking at a different photo, so a good photo at a new version gets a fresh try.
  // A different photo also closes the full-size view, so it only ever shows the photo that was clicked.
  useEffect(() => {
    setBroken(false);
    setOpen(false);
  }, [candidateId, version]);
  const box = `${SIZES[size]} shrink-0 rounded-lg`;
  if (url && !broken) {
    if (!expandable) {
      return <img src={url} alt={`Photo of ${name}`} className={`${box} bg-slate-100 object-cover`} onError={() => setBroken(true)} />;
    }
    return (
      <>
        <button
          type="button"
          aria-label={`Enlarge photo of ${name}`}
          title="Enlarge photo"
          onClick={() => setOpen(true)}
          className={`${box} relative block cursor-zoom-in overflow-hidden bg-slate-100 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none`}
        >
          <img src={url} alt={`Photo of ${name}`} className="h-full w-full object-cover" onError={() => setBroken(true)} />
          <span aria-hidden="true" className="absolute right-1 bottom-1 rounded bg-slate-900/60 p-0.5 text-white">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </span>
        </button>
        {open && <PhotoViewer url={url} name={name} onClose={close} />}
      </>
    );
  }
  const label = url === undefined ? `Loading photo of ${name}` : `No photo of ${name}`;
  return (
    <div role="img" aria-label={label} className={`${box} flex items-center justify-center bg-slate-200 font-semibold text-slate-500`}>
      <bdi aria-hidden="true">{initials(name)}</bdi>
    </div>
  );
}

/**
 * The photo as large as the screen allows (photos are stored at 800 px on the long side, so a laptop
 * shows it at full detail). Escape, Close or a click anywhere closes it, and focus goes back to the
 * thumbnail. Drawn over everything, including the application or photo dialog it was opened from.
 */
function PhotoViewer({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    // Listening on window in the capture phase, ahead of the dialogs' own listeners on document, so
    // the Escape that closes the photo doesn't also close the dialog underneath, and Tab stays here.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        closeButton.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      opener?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo of ${name}`}
      className="fixed inset-0 z-[60] flex cursor-zoom-out flex-col items-center justify-center gap-3 bg-slate-950/90 p-4"
      onClick={onClose}
    >
      <button ref={closeButton} type="button" className={`${buttonClasses('secondary', 'md')} absolute top-3 right-3`} onClick={onClose}>
        Close
      </button>
      <img src={url} alt={`Photo of ${name}`} className="max-h-[calc(100dvh-7rem)] max-w-full rounded-lg object-contain shadow-2xl" />
      <p className="max-w-full truncate text-lg font-semibold text-white">
        <bdi>{name}</bdi>
      </p>
    </div>,
    document.body,
  );
}
