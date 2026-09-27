import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { buttonClasses } from '../components/ActionButton.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';
import { CandidatePhoto } from './CandidatePhoto.tsx';
import { grabFrame, shrinkPhoto } from './shrinkPhoto.ts';

export interface CaptureCandidate {
  id: string;
  number: number;
  name: string;
}

interface CaptureViewProps {
  candidate: CaptureCandidate;
  /** photo_taken_at of the photo on file, shown until a new one is taken; null = none. */
  currentVersion: string | null;
  onSaved: (photoTakenAt: string) => void;
  onClose: () => void;
}

type Camera = 'starting' | 'on' | 'unavailable';

/** A touch screen: use the phone's own camera app. A mouse: a webcam preview, or a file. */
const isPhone = () => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/** Take (or retake) one candidate's photo: camera or file → shrunk preview → Save. */
export function CaptureView({ candidate, currentVersion, onSaved, onClose }: CaptureViewProps) {
  const api = useApi();
  const [phone] = useState(isPhone);
  const fileInput = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<Camera>('starting');
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState<'reading' | 'saving' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const who = `#${candidate.number} ${candidate.name}`;

  // A laptop's webcam runs only while no photo is on screen; phones use their own camera app instead.
  useEffect(() => {
    if (phone || photo) return;
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setCamera('unavailable');
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    setCamera('starting');
    media.getUserMedia({ video: { facingMode: 'user' }, audio: false }).then(
      (s) => {
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        if (video.current) video.current.srcObject = s;
        setCamera('on');
      },
      () => {
        if (!cancelled) setCamera('unavailable');
      },
    );
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [phone, photo]);

  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && busy !== 'saving') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  async function takeFrom(source: Promise<Blob>) {
    setBusy('reading');
    setError(null);
    setSaveFailed(false);
    try {
      const blob = await shrinkPhoto(await source);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // choosing the same file again still counts
    if (file) void takeFrom(Promise.resolve(file));
  }

  function retake() {
    setPhoto(null);
    setError(null);
    setSaveFailed(false);
    if (phone) fileInput.current?.click();
  }

  async function save() {
    if (!photo) return;
    setBusy('saving');
    setError(null);
    try {
      onSaved(await api.uploadPhoto(candidate.id, photo.blob));
    } catch (e) {
      setError(errorMessage(e));
      setSaveFailed(true);
      setBusy(null);
    }
  }

  const big = `${buttonClasses('primary', 'md')} h-14 text-lg`;
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/60 sm:items-center sm:p-6">
      <div role="dialog" aria-modal="true" aria-label={`Photo of ${who}`} className="flex w-full flex-col gap-4 overflow-y-auto bg-white p-4 sm:max-w-lg sm:rounded-xl sm:shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-2xl font-bold">
            <span className="tabular-nums">#{candidate.number}</span> <bdi>{candidate.name}</bdi>
          </h2>
          <button type="button" className={buttonClasses('ghost', 'md')} disabled={busy === 'saving'} onClick={onClose}>
            Close
          </button>
        </div>

        {photo ? (
          <img src={photo.url} alt={`New photo of ${candidate.name}`} className="max-h-[60vh] w-full rounded-lg object-contain" />
        ) : (
          <>
            {currentVersion && <CandidatePhoto candidateId={candidate.id} version={currentVersion} name={candidate.name} size="xl" />}
            {!phone && camera !== 'unavailable' && (
              <video ref={video} autoPlay playsInline muted aria-label="Camera preview" className="w-full rounded-lg bg-slate-900" />
            )}
            {!phone && camera === 'unavailable' && <p className="text-sm text-slate-600">No camera available here. Choose a photo file instead.</p>}
          </>
        )}

        {error && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {error}
          </p>
        )}

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          capture={phone ? 'environment' : undefined}
          aria-label="Photo file"
          tabIndex={-1}
          className="sr-only"
          onChange={onFile}
        />

        <div className="flex flex-col gap-2">
          {photo ? (
            <>
              <button type="button" className={big} disabled={busy !== null} onClick={() => void save()}>
                {busy === 'saving' ? 'Saving…' : saveFailed ? 'Try again' : 'Save'}
              </button>
              <button type="button" className={buttonClasses('secondary', 'md')} disabled={busy !== null} onClick={retake}>
                Retake
              </button>
            </>
          ) : phone ? (
            <button type="button" className={big} disabled={busy !== null} onClick={() => fileInput.current?.click()}>
              {busy === 'reading' ? 'Preparing…' : currentVersion ? 'Retake photo' : 'Take photo'}
            </button>
          ) : (
            <>
              {camera === 'on' && (
                <button type="button" className={big} disabled={busy !== null} onClick={() => video.current && void takeFrom(grabFrame(video.current))}>
                  {busy === 'reading' ? 'Preparing…' : 'Capture'}
                </button>
              )}
              <button type="button" className={buttonClasses('secondary', 'md')} disabled={busy !== null} onClick={() => fileInput.current?.click()}>
                {camera === 'unavailable' ? 'Choose a photo file' : 'Choose a file instead'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
