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
}

/** A candidate's photo, or their initials on grey (never a broken image). */
export function CandidatePhoto({ candidateId, version, name, size = 'md' }: CandidatePhotoProps) {
  const url = usePhoto(candidateId, version);
  const box = `${SIZES[size]} shrink-0 rounded-lg`;
  if (url) return <img src={url} alt={`Photo of ${name}`} className={`${box} bg-slate-100 object-cover`} />;
  const label = url === undefined ? `Loading photo of ${name}` : `No photo of ${name}`;
  return (
    <div role="img" aria-label={label} className={`${box} flex items-center justify-center bg-slate-200 font-semibold text-slate-500`}>
      <bdi aria-hidden="true">{initials(name)}</bdi>
    </div>
  );
}
