import { useEffect, useMemo, useState } from 'react';
import { buttonClasses } from '../components/ActionButton.tsx';
import { ConnectionBanner } from '../components/ConnectionBanner.tsx';
import { FullPageMessage } from '../components/FullPageMessage.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import type { PhotoQueueEntry } from '../lib/types.ts';
import { useLiveSnapshot } from '../lib/useLiveSnapshot.ts';
import { CandidatePhoto } from './CandidatePhoto.tsx';
import { CaptureView } from './CaptureView.tsx';
import { photoCounts, photoLists } from './photoQueueView.ts';

/** /photos: the photographer's one screen (admins can open it too). Built for a phone. */
export function PhotosPage() {
  const api = useApi();
  const subscribe = useMemo(() => api.subscribeBoard(), [api]);
  const { data: entries, error, status, reload } = useLiveSnapshot(api.photoQueue, subscribe);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<PhotoQueueEntry | null>(null);

  useEffect(() => {
    document.title = 'Photos · MLSA Induction';
  }, []);

  if (!entries) {
    return (
      <FullPageMessage title={error ? "Couldn't load the list" : 'Loading the list…'}>
        {error && (
          <>
            <p>{error}</p>
            <button type="button" className={`${buttonClasses('secondary', 'md')} mt-3`} onClick={reload}>
              Try again
            </button>
          </>
        )}
      </FullPageMessage>
    );
  }

  const counts = photoCounts(entries);
  const lists = photoLists(entries, query);
  const searching = query.trim() !== '';
  return (
    <>
      <ConnectionBanner status={status} />
      <main className="mx-auto max-w-xl space-y-4 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold">Photos</h1>
          <p className="text-sm font-medium text-slate-700">
            {counts.needs} need photo · {counts.done} done
          </p>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            Couldn't refresh the list: {error}
          </p>
        )}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Find a candidate"
          placeholder="Number or name"
          className="h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
        />
        <PhotoSection
          title="Needs photo"
          entries={lists.needs}
          empty={searching ? 'Nobody here matches.' : entries.length === 0 ? 'Nobody is waiting.' : 'Everyone waiting has a photo.'}
          onOpen={setOpen}
        />
        <PhotoSection title="Done" entries={lists.done} empty={searching ? 'Nobody here matches.' : 'No photos yet.'} onOpen={setOpen} withPhotos />
      </main>
      {open && (
        <CaptureView
          candidate={{ id: open.candidate_id, number: open.number, name: open.name }}
          currentVersion={open.photo_taken_at}
          onSaved={() => {
            setOpen(null);
            reload();
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

interface PhotoSectionProps {
  title: string;
  entries: PhotoQueueEntry[];
  empty: string;
  onOpen: (entry: PhotoQueueEntry) => void;
  withPhotos?: boolean;
}

function PhotoSection({ title, entries, empty, onOpen, withPhotos = false }: PhotoSectionProps) {
  const id = `photos-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 id={id} className="border-b border-slate-100 px-4 py-2 text-sm font-semibold tracking-wide text-slate-600 uppercase">
        {title}
      </h2>
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul aria-label={title} className="divide-y divide-slate-100">
          {entries.map((entry) => (
            <li key={entry.candidate_id}>
              <button
                type="button"
                onClick={() => onOpen(entry)}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 active:bg-slate-100"
              >
                {withPhotos && <CandidatePhoto candidateId={entry.candidate_id} version={entry.photo_taken_at} name={entry.name} size="sm" />}
                <span className="text-lg font-semibold tabular-nums">#{entry.number}</span> <bdi className="min-w-0 flex-1 truncate text-base">{entry.name}</bdi>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
