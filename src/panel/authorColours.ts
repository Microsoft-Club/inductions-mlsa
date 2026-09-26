// Each author in a discussion gets a colour of their own, in the order they first wrote, so everyone
// looking at the same discussion sees the same colours. All dark enough to read on white.
const PALETTE = [
  'text-sky-700',
  'text-emerald-700',
  'text-violet-700',
  'text-rose-700',
  'text-amber-700',
  'text-teal-700',
  'text-indigo-700',
  'text-fuchsia-700',
];

/** A colour class per author id, in order of appearance; after eight authors the colours repeat. */
export function authorColours(authorIds: Iterable<string>): Map<string, string> {
  const colours = new Map<string, string>();
  for (const id of authorIds) {
    if (!colours.has(id)) colours.set(id, PALETTE[colours.size % PALETTE.length]);
  }
  return colours;
}
