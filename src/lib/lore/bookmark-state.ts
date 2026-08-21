// Stage 2A-P2U1 — Lore bookmark state.
//
// Browser-local, localStorage-only, personal Reader-runtime state. Stores ONLY an
// ordered array of canonicalId strings — never titles, content, original/comment
// text, source URLs, chronology, provenance, media interpretation, or any canonical
// record object/bytes. The current verified archive remains the only authority for
// current record metadata; this module never reads generated/**, the canonical
// repository, the network, or the filesystem.
//
// Pure + testable: a narrow storage interface (getItem/setItem) is used instead of
// requiring a real browser Storage object, so Node tests exercise this
// deterministically. No dependency addition.

export const BOOKMARK_STORAGE_KEY = 'toadaid:lore-reader:bookmarks:v1';

/** Minimal storage surface — enough for localStorage without requiring a DOM. */
export interface BookmarkStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The post-read state of the persisted bookmark collection. */
export type BookmarkReadState =
  | { status: 'ok'; ids: string[] }
  | { status: 'corrupt' }
  | { status: 'unavailable' };

/**
 * A valid bookmark payload is EXACTLY an array of non-empty, unique string IDs.
 * No wrapper object, no metadata, no timestamps, no titles, no copied flags.
 * Rejects objects, non-arrays, non-strings, empty strings, and duplicate IDs.
 */
export function isValidIdArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) return false;
    if (seen.has(entry)) return false;
    seen.add(entry);
  }
  return true;
}

/**
 * Parse a raw storage string into a validated ID array.
 * Returns [] for a missing key (valid empty collection), or null if the stored
 * value is malformed JSON or fails the exact ID-array format (corrupt).
 */
export function parseIds(raw: string | null): string[] | null {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isValidIdArray(parsed) ? (parsed as string[]) : null;
}

/**
 * Read bookmarks without throwing. Missing key => ok/empty. Bad data => corrupt.
 * Storage disabled / throwing => unavailable. Never crashes the Reader.
 */
export function readBookmarks(storage: BookmarkStorage): BookmarkReadState {
  let raw: string | null;
  try {
    raw = storage.getItem(BOOKMARK_STORAGE_KEY);
  } catch {
    return { status: 'unavailable' };
  }
  const ids = parseIds(raw);
  if (ids === null) return { status: 'corrupt' };
  return { status: 'ok', ids };
}

/** Serialize EXACTLY an ID-only array — no wrapper, no metadata, no timestamps. */
export function serializeIds(ids: string[]): string {
  return JSON.stringify(ids);
}

/** Write bookmarks without throwing. Returns true only if persisted. */
export function writeBookmarks(storage: BookmarkStorage, ids: string[]): boolean {
  try {
    storage.setItem(BOOKMARK_STORAGE_KEY, serializeIds(ids));
    return true;
  } catch {
    return false;
  }
}

/**
 * Append an ID if absent (insertion order = bookmark order). Returns a new array;
 * does not mutate the input. Re-adding an absent id always lands at the tail.
 */
export function addId(ids: string[], id: string): string[] {
  if (ids.includes(id)) return [...ids];
  return [...ids, id];
}

/** Remove an ID, preserving the relative order of all remaining IDs. New array. */
export function removeId(ids: string[], id: string): string[] {
  return ids.filter((entry) => entry !== id);
}

/** Whether a given ID is currently bookmarked. Never throws; false on corrupt/unavailable. */
export function isBookmarked(storage: BookmarkStorage, id: string): boolean {
  const state = readBookmarks(storage);
  return state.status === 'ok' && state.ids.includes(id);
}

/**
 * Toggle one canonical ID. Adds (appends at tail) if absent, removes if present.
 * Never throws. Does NOT overwrite corrupt/unavailable storage (degrades rather
 * than silently repair). On a write failure, returns the true unchanged persisted
 * state — never a false success. The returned state is the actual post-operation
 * persisted state, so callers (e.g. aria-pressed) reflect reality.
 */
export function toggleBookmark(storage: BookmarkStorage, id: string): BookmarkReadState {
  const state = readBookmarks(storage);
  if (state.status !== 'ok') return state;
  const next = state.ids.includes(id) ? removeId(state.ids, id) : addId(state.ids, id);
  if (!writeBookmarks(storage, next)) {
    // write failed: persisted state is unchanged; return the true state, not a
    // fabricated success.
    return state;
  }
  return { status: 'ok', ids: next };
}