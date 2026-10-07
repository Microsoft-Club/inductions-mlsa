import type { DisplayPanel } from '../lib/types.ts';

/** Grid columns for the projector: 1–3 panels side by side, 4 as 2×2, then rows of 3 (4 beyond 6). */
export function displayColumns(panelCount: number): number {
  if (panelCount <= 3) return Math.max(panelCount, 1);
  if (panelCount === 4) return 2;
  if (panelCount <= 6) return 3;
  return 4;
}

/** Rows of tiles; the screen's height is shared out evenly between them. */
export function displayRows(panelCount: number): number {
  return Math.max(1, Math.ceil(panelCount / displayColumns(panelCount)));
}

/** Panels whose current candidate changed since the previous snapshot. Nothing flashes on the first load. */
export function newlySentIn(previous: DisplayPanel[] | undefined, next: DisplayPanel[]): string[] {
  if (!previous) return [];
  return next
    .filter((panel) => {
      if (!panel.current) return false;
      const before = previous.find((p) => p.id === panel.id)?.current;
      return !before || before.number !== panel.current.number || before.started_at !== panel.current.started_at;
    })
    .map((panel) => panel.id);
}

/** `&panel=<id>` shows one panel; an unknown id (say, a deleted panel) falls back to all of them. */
export function selectPanels(panels: DisplayPanel[], panelId: string | null): DisplayPanel[] {
  const one = panelId ? panels.filter((p) => p.id === panelId) : [];
  return one.length > 0 ? one : panels;
}
