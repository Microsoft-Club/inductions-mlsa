import { useCallback, useEffect, useState } from 'react';
import { ActionButton } from '../components/ActionButton.tsx';
import { ActionProvider } from '../components/ActionProvider.tsx';
import { useToast } from '../components/Toasts.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';

const photos = (n: number) => `${n} ${n === 1 ? 'photo' : 'photos'}`;

/** How many candidate photos are stored, and deleting them all (they are kept until an admin does). */
export function PhotosSection() {
  const api = useApi();
  const toast = useToast();
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCount(await api.photoCount());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ActionProvider onSettled={() => void load()}>
      <section aria-labelledby="photos-title" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="photos-title" className="font-semibold">Photos</h2>
        <p className="text-sm text-slate-600">
          {count === null ? (error ? `Couldn't count the photos: ${error}` : 'Counting photos…') : `${photos(count)} stored.`} Photos are
          kept until you delete them.
        </p>
        <ActionButton
          variant="danger"
          disabled={count === null}
          confirm={
            count
              ? `Delete all ${photos(count)}? This can't be undone.`
              : "Remove any leftover photo files? This can't be undone."
          }
          action={async () => {
            const deleted = await api.deleteAllPhotos();
            toast.show(`Deleted ${photos(deleted)}.`, 'success');
          }}
        >
          Delete all photos
        </ActionButton>
      </section>
    </ActionProvider>
  );
}
