import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  BOOKMARK_STORAGE_KEY,
  isValidIdArray,
  parseIds,
  readBookmarks,
  serializeIds,
  writeBookmarks,
  addId,
  removeId,
  isBookmarked,
  toggleBookmark,
  type BookmarkStorage,
} from '../src/lib/lore/bookmark-state.ts';

// ---------------------------------------------------------------------------
// Stage 2A-P2U1 — Lore Bookmark and Share Affordances tests.
//
// Two layers are proven:
//   (1) The pure bookmark-state.ts module — a narrow, Node-testable boundary over
//       a small storage interface (no real browser Storage, no generated/**,
//       no network, no filesystem). Proofs 1-14.
//   (2) The browser runtime embedded in the record + bookmarks pages — extracted
//       from the authored <script is:inline> body and executed for real inside a
//       bounded hand-rolled fake-DOM sandbox using only node:vm. No jsdom, no
//       dependency. Proofs 15-27.
//
// These tests must NOT depend on the gitignored operator `generated/` artifacts
// (absent on a clean checkout / CI). The runtime proofs read the page SOURCE and
// run the verbatim inline script against a fake DOM.
// ---------------------------------------------------------------------------

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const RECORD_PAGE_SRC = readFileSync(join(TEST_DIR, '..', 'src', 'pages', 'record', '[canonicalId].astro'), 'utf8');
const BOOKMARKS_PAGE_SRC = readFileSync(join(TEST_DIR, '..', 'src', 'pages', 'bookmarks', 'index.astro'), 'utf8');

// ===========================================================================
// Layer 1 — pure bookmark-state.ts module (proofs 1-14)
// ===========================================================================

/** Minimal fake storage: a plain map with optional get/set throwing. */
function makeStorage(initial: Record<string, string> = {}, opts: { throwGet?: boolean; throwSet?: boolean } = {}): BookmarkStorage & { _store: Record<string, string> } {
  const store: Record<string, string> = { ...initial };
  return {
    _store: store,
    getItem(k: string) { if (opts.throwGet) throw new Error('storage disabled'); return store[k] ?? null; },
    setItem(k: string, v: string) { if (opts.throwSet) throw new Error('storage disabled'); store[k] = v; },
  };
}

test('1: missing storage key yields a valid empty bookmark collection', () => {
  const state = readBookmarks(makeStorage());
  assert.deepEqual(state, { status: 'ok', ids: [] });
  assert.equal(isBookmarked(makeStorage(), 'A'), false);
});

test('2: a valid ID-only array round-trips exactly through serialize/parse', () => {
  const ids = ['M_YT', 'M_AUD'];
  const raw = serializeIds(ids);
  assert.equal(raw, '["M_YT","M_AUD"]', 'serialize is exactly an ID-only JSON array');
  assert.deepEqual(parseIds(raw), ['M_YT', 'M_AUD']);
  assert.deepEqual(readBookmarks(makeStorage({ [BOOKMARK_STORAGE_KEY]: raw })), { status: 'ok', ids: ['M_YT', 'M_AUD'] });
});

test('3: insertion order is preserved across adds', () => {
  let ids: string[] = [];
  ids = addId(ids, 'A');
  ids = addId(ids, 'B');
  ids = addId(ids, 'C');
  assert.deepEqual(ids, ['A', 'B', 'C']);
});

test('4: adding an already-present id does not duplicate or reorder', () => {
  let ids = ['A', 'B', 'C'];
  ids = addId(ids, 'B');
  assert.deepEqual(ids, ['A', 'B', 'C'], 'no duplicate, no reordering');
});

test('5: removing an id preserves the relative order of the remaining ids', () => {
  assert.deepEqual(removeId(['A', 'B', 'C'], 'B'), ['A', 'C']);
  assert.deepEqual(removeId(['A', 'B', 'C'], 'A'), ['B', 'C']);
  assert.deepEqual(removeId(['A', 'B', 'C'], 'C'), ['A', 'B']);
});

test('6: re-adding a removed id appends at the tail (not its former position)', () => {
  let ids = ['A', 'B', 'C'];
  ids = removeId(ids, 'B');
  ids = addId(ids, 'B');
  assert.deepEqual(ids, ['A', 'C', 'B'], 'B re-enters at the tail');
});

test('7: malformed JSON degrades safely to corrupt (no throw)', () => {
  assert.equal(parseIds('{not json'), null);
  assert.deepEqual(readBookmarks(makeStorage({ [BOOKMARK_STORAGE_KEY]: '{not json' })), { status: 'corrupt' });
});

test('8: an object payload (rather than an array) is rejected as corrupt', () => {
  assert.equal(isValidIdArray({ canonicalId: 'A' }), false);
  assert.deepEqual(readBookmarks(makeStorage({ [BOOKMARK_STORAGE_KEY]: '{"canonicalId":"A"}' })), { status: 'corrupt' });
});

test('9: a payload containing title/content/provenance objects is rejected (IDs only, no metadata)', () => {
  const wrapped = JSON.stringify([{ canonicalId: 'A', title: 'x', url: 'https://x', provenance: {} }]);
  assert.equal(parseIds(wrapped), null, 'array of objects is not a valid ID-only array');
  assert.deepEqual(readBookmarks(makeStorage({ [BOOKMARK_STORAGE_KEY]: wrapped })), { status: 'corrupt' });
});

test('10: duplicate IDs are rejected and never accepted as valid persisted state', () => {
  assert.equal(isValidIdArray(['A', 'A']), false);
  assert.equal(parseIds('["A","A"]'), null);
  assert.deepEqual(readBookmarks(makeStorage({ [BOOKMARK_STORAGE_KEY]: '["A","A"]' })), { status: 'corrupt' });
});

test('11: storage getItem throwing does not escape (unavailable, no crash)', () => {
  const state = readBookmarks(makeStorage({}, { throwGet: true }));
  assert.equal(state.status, 'unavailable');
  assert.equal(isBookmarked(makeStorage({}, { throwGet: true }), 'A'), false);
});

test('12: storage setItem throwing does not escape or report false success', () => {
  const storage = makeStorage({ [BOOKMARK_STORAGE_KEY]: '["A"]' }, { throwSet: true });
  // toggle A (remove) — write throws; the returned state is the true unchanged state.
  const result = toggleBookmark(storage, 'A');
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') assert.deepEqual(result.ids, ['A'], 'write failed so persisted state is unchanged (no false success)');
  // The store was not mutated.
  assert.equal(storage._store[BOOKMARK_STORAGE_KEY], '["A"]');
  // Adding a new id when write throws also reports the unchanged state, not success.
  const result2 = toggleBookmark(makeStorage({ [BOOKMARK_STORAGE_KEY]: '[]' }, { throwSet: true }), 'B');
  assert.deepEqual(result2, { status: 'ok', ids: [] }, 'write failed: true empty state, not a fabricated add');
});

test('13: only canonicalId strings are serialized — no wrapper, no metadata, no timestamps', () => {
  assert.equal(serializeIds(['A', 'B']), '["A","B"]');
  assert.ok(!serializeIds(['A']).includes('canonicalId'));
  assert.ok(!serializeIds(['A']).includes('title'));
  assert.ok(!serializeIds(['A']).includes('timestamp'));
});

test('14: no canonical record metadata (title/url/provenance) enters the persisted JSON', () => {
  const raw = serializeIds(['M_YT']);
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed));
  for (const entry of parsed) {
    assert.equal(typeof entry, 'string');
    assert.ok(!(['title', 'url', 'original', 'comment', 'provenance', 'sourceDigest', 'commit'] as const).some((k) => typeof entry === 'object' && k in (entry as any)));
  }
  // The full set of forbidden keys is simply absent: the value is a flat string array.
  assert.deepEqual(parsed, ['M_YT']);
});

test('toggleBookmark adds then removes, persisting the exact ordered ID array', () => {
  const storage = makeStorage();
  assert.deepEqual(toggleBookmark(storage, 'A'), { status: 'ok', ids: ['A'] });
  assert.equal(storage._store[BOOKMARK_STORAGE_KEY], '["A"]');
  assert.deepEqual(toggleBookmark(storage, 'B'), { status: 'ok', ids: ['A', 'B'] });
  assert.deepEqual(toggleBookmark(storage, 'A'), { status: 'ok', ids: ['B'] }, 'remove preserves the other id');
  assert.equal(storage._store[BOOKMARK_STORAGE_KEY], '["B"]');
});

test('toggleBookmark refuses to overwrite corrupt or unavailable storage', () => {
  const corrupt = makeStorage({ [BOOKMARK_STORAGE_KEY]: '["A","A"]' });
  assert.equal(toggleBookmark(corrupt, 'Z').status, 'corrupt', 'corrupt storage is not silently repaired');
  assert.equal(corrupt._store[BOOKMARK_STORAGE_KEY], '["A","A"]', 'corrupt payload left untouched');
  const unavailable = makeStorage({}, { throwGet: true });
  assert.equal(toggleBookmark(unavailable, 'Z').status, 'unavailable', 'unavailable storage is not written');
});

// ===========================================================================
// Layer 2 — browser runtime (proofs 15-27)
// ===========================================================================

/** Hand-rolled fake element. No jsdom. Supports dataset, classList, textContent,
 * setAttribute/getAttribute/removeAttribute, addEventListener, appendChild. */
function makeEl(props: Record<string, any> = {}): any {
  const el: any = {
    dataset: {} as Record<string, string>,
    hidden: false,
    className: '',
    href: '',
    textContent: '',
    tagName: '',
    _attrs: {} as Record<string, string>,
    _listeners: {} as Record<string, (ev?: any) => void>,
    _children: [] as any[],
    _cls: new Set<string>(),
    setAttribute(k: string, v: string) { this._attrs[k] = v; },
    getAttribute(k: string) { return this._attrs[k] ?? null; },
    removeAttribute(k: string) { delete this._attrs[k]; },
    addEventListener(type: string, fn: (ev?: any) => void) { this._listeners[type] = fn; },
    appendChild(node: any) { this._children.push(node); return node; },
    classList: {
      add: (c: string) => { el._cls.add(c); },
      remove: (c: string) => { el._cls.delete(c); },
      contains: (c: string) => el._cls.has(c),
    },
  };
  Object.assign(el, props);
  // Ensure dataset is a real object even if props supplied one.
  if (props.dataset) el.dataset = { ...props.dataset };
  return el;
}

/** Extract the single <script is:inline> body from a page source. */
function inlineScriptBody(src: string, label: string): string {
  const match = src.match(/<script is:inline>([\s\S]*?)<\/script>/);
  assert.ok(match, `${label} must contain an inline <script is:inline> runtime`);
  return match[1];
}

function recordRuntimeBody(): string {
  return inlineScriptBody(RECORD_PAGE_SRC, 'record page');
}
function bookmarksRuntimeBody(): string {
  return inlineScriptBody(BOOKMARKS_PAGE_SRC, 'bookmarks page');
}

/** Fake localStorage with optional get/set throwing and an inspectable store. */
function fakeStorage(initial: Record<string, string> = {}, opts: { throwGet?: boolean; throwSet?: boolean } = {}): any {
  const store: Record<string, string> = { ...initial };
  return {
    _store: store,
    getItem(k: string) { if (opts.throwGet) throw new Error('storage disabled'); return store[k] ?? null; },
    setItem(k: string, v: string) { if (opts.throwSet) throw new Error('storage disabled'); store[k] = v; },
  };
}

/** Run the record-page runtime body in a fake DOM. Returns the controls + storage. */
function runRecordRuntime(setup: {
  bookmarkBtn?: any;
  shareBtn?: any;
  statusEl?: any;
  storage?: any;
  navigator?: any;
  location?: any;
}) {
  const bookmarkBtn = setup.bookmarkBtn ?? makeEl({ dataset: { bookmarkId: 'M_YT' } });
  const shareBtn = setup.shareBtn ?? makeEl({ dataset: { shareUrl: '/record/M_YT/' } });
  const statusEl = setup.statusEl ?? makeEl({});
  const storage = setup.storage ?? fakeStorage();
  const queryMap: Record<string, any> = {
    '[data-bookmark-id]': bookmarkBtn,
    '[data-share-url]': shareBtn,
    '[data-share-status]': statusEl,
  };
  const document: any = {
    querySelector(sel: string) { return queryMap[sel] ?? null; },
    querySelectorAll(_sel: string) { return []; }, // mode/yt/img selectors: no-op
    createElement(tag: string) { return makeEl({ tagName: tag }); },
    getElementById(_id: string) { return null; },
  };
  const ctx: Record<string, any> = { document, localStorage: storage, String, Number, Array, Object, Math, JSON, Promise };
  if (setup.navigator !== undefined) ctx.navigator = setup.navigator;
  if (setup.location !== undefined) ctx.location = setup.location;
  vm.runInNewContext(recordRuntimeBody(), ctx);
  return { bookmarkBtn, shareBtn, statusEl, storage, document };
}

/** Run the bookmarks-page runtime body in a fake DOM. */
function runBookmarksRuntime(setup: {
  archiveJson?: string;
  storage?: any;
}) {
  const listEl = makeEl({ tagName: 'UL' });
  const statusEl = makeEl({ tagName: 'P' });
  const archiveEl = makeEl({ dataset: { bookmarkArchive: setup.archiveJson ?? '[]' } });
  const storage = setup.storage ?? fakeStorage();
  const created: any[] = [];
  const queryMap: Record<string, any> = {
    '[data-bookmark-archive]': archiveEl,
    '[data-bookmark-list]': listEl,
    '[data-bookmark-status]': statusEl,
  };
  const document: any = {
    querySelector(sel: string) { return queryMap[sel] ?? null; },
    createElement(tag: string) { const e = makeEl({ tagName: tag }); created.push(e); return e; },
  };
  vm.runInNewContext(bookmarksRuntimeBody(), { document, localStorage: storage, String, Number, Array, Object, Math, JSON });
  return { listEl, statusEl, archiveEl, storage, created };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// --- Record page: template + bookmark runtime --------------------------------

test('15: the record page contains a bookmark control bound to canonicalId and a share control bound to the recordRoute path', () => {
  assert.match(RECORD_PAGE_SRC, /data-bookmark-id=\{record\.canonicalId\}/, 'bookmark control bound to canonicalId');
  assert.match(RECORD_PAGE_SRC, /data-share-url=\{recordRoute\(record\.canonicalId, publicBase\)\}/, 'share control bound to the base-aware recordRoute path');
  assert.match(RECORD_PAGE_SRC, /aria-pressed="false"/, 'bookmark control carries an initial aria-pressed');
  assert.match(RECORD_PAGE_SRC, /href=\{publicPath\('\/bookmarks\/', publicBase\)\}/, 'record page links to the base-aware /bookmarks/ view');
});

test('16: the record-page bookmark runtime toggles aria-pressed and persists only an ordered ID array', () => {
  const storage = fakeStorage();
  const { bookmarkBtn } = runRecordRuntime({ storage });
  assert.equal(bookmarkBtn._attrs['aria-pressed'], 'false', 'empty storage => not pressed');
  // click -> add
  bookmarkBtn._listeners.click();
  assert.equal(bookmarkBtn._attrs['aria-pressed'], 'true', 'after bookmarking: pressed');
  assert.equal(storage._store[BOOKMARK_STORAGE_KEY], '["M_YT"]', 'persisted an ID-only array');
  // click -> remove
  bookmarkBtn._listeners.click();
  assert.equal(bookmarkBtn._attrs['aria-pressed'], 'false', 'after removing: not pressed');
  assert.equal(storage._store[BOOKMARK_STORAGE_KEY], '[]');
});

test('17: the record-page bookmark runtime degrades without throwing when storage is unavailable/corrupt', () => {
  // No localStorage global at all.
  assert.doesNotThrow(() => {
    const bookmarkBtn = makeEl({ dataset: { bookmarkId: 'M_YT' } });
    const queryMap: Record<string, any> = { '[data-bookmark-id]': bookmarkBtn, '[data-share-url]': makeEl({}), '[data-share-status]': makeEl({}) };
    const document: any = { querySelector: (s: string) => queryMap[s] ?? null, querySelectorAll: () => [], createElement: (t: string) => makeEl({ tagName: t }), getElementById: () => null };
    vm.runInNewContext(recordRuntimeBody(), { document, String, Number, Array, Object, Math, JSON, Promise });
    assert.equal(bookmarkBtn._attrs['aria-pressed'], 'false', 'degraded => not pressed');
    assert.ok(bookmarkBtn._cls.has('is-degraded'), 'degraded control is marked');
    // A click must not throw and must not write.
    assert.doesNotThrow(() => bookmarkBtn._listeners.click());
  });
  // getItem throws.
  assert.doesNotThrow(() => {
    const { bookmarkBtn, storage } = runRecordRuntime({ storage: fakeStorage({}, { throwGet: true }) });
    assert.equal(bookmarkBtn._attrs['aria-pressed'], 'false');
    assert.doesNotThrow(() => bookmarkBtn._listeners.click());
    assert.deepEqual(storage._store, {}, 'no write attempted on unavailable storage');
  });
});

// --- Bookmarks page: resolution + safety -------------------------------------

const ARCHIVE_PROJECTION = JSON.stringify([
  { canonicalId: 'A', title: 'Alpha Record', route: '/record/A/' },
  { canonicalId: 'B', title: 'Beta Record', route: '/record/B/' },
]);

test('18: the bookmarks view resolves known saved IDs from the current archive projection in stored order', () => {
  const storage = fakeStorage({ [BOOKMARK_STORAGE_KEY]: '["B","A"]' });
  const { listEl, statusEl } = runBookmarksRuntime({ archiveJson: ARCHIVE_PROJECTION, storage });
  assert.equal(statusEl.textContent, '2 bookmarks saved.');
  assert.equal(listEl._children.length, 2, 'one list item per saved id');
  const first = listEl._children[0];
  const second = listEl._children[1];
  // Stored order [B, A] governs displayed order.
  assert.equal(first._children[0].textContent, 'Beta Record');
  assert.equal(first._children[0].href, '/record/B/');
  assert.equal(first._children[1].textContent, 'B');
  assert.equal(second._children[0].textContent, 'Alpha Record');
  assert.equal(second._children[0].href, '/record/A/');
  assert.equal(second._children[1].textContent, 'A');
});

test('19: an unknown saved ID produces no active record link and no stale title (missing state + id only)', () => {
  const storage = fakeStorage({ [BOOKMARK_STORAGE_KEY]: '["GHOST"]' });
  const { listEl } = runBookmarksRuntime({ archiveJson: ARCHIVE_PROJECTION, storage });
  assert.equal(listEl._children.length, 1);
  const li = listEl._children[0];
  // No <a> link is rendered for the missing id.
  assert.equal(li._children.filter((c: any) => String(c.tagName).toLowerCase() === 'a').length, 0, 'no active link for a missing id');
  // A missing-state notice + the raw id (as safe text) are rendered.
  assert.ok(li._children.some((c: any) => c.textContent.includes('unavailable in this archive')), 'neutral unavailable notice');
  assert.ok(li._children.some((c: any) => c.textContent === 'GHOST' && String(c.tagName).toLowerCase() === 'code'), 'id shown as safe code text, no stale title');
});

test('20: unsafe / locally-stored text is emitted through safe text handling, never innerHTML', () => {
  // Source-level: the bookmarks runtime must never assign innerHTML from storage.
  assert.ok(!/\.innerHTML\s*=/.test(bookmarksRuntimeBody()), 'bookmarks runtime never assigns innerHTML');
  assert.ok(!/document\.write/.test(bookmarksRuntimeBody()), 'bookmarks runtime never uses document.write');
  // Behavioral: an id that looks like HTML markup is rendered as literal text, not parsed.
  const evil = '<img src=x onerror=alert(1)>';
  const storage = fakeStorage({ [BOOKMARK_STORAGE_KEY]: JSON.stringify([evil]) });
  const { listEl } = runBookmarksRuntime({ archiveJson: '[]', storage });
  assert.equal(listEl._children.length, 1);
  const codeEl = listEl._children[0]._children.find((c: any) => String(c.tagName).toLowerCase() === 'code');
  assert.ok(codeEl, 'missing id rendered as code text');
  assert.equal(codeEl.textContent, evil, 'markup carried as literal text, not parsed as HTML');
});

test('21: the bookmarks view degrades to a status message and renders no list items on corrupt storage', () => {
  const storage = fakeStorage({ [BOOKMARK_STORAGE_KEY]: '["A","A"]' }); // duplicate => corrupt
  const { listEl, statusEl } = runBookmarksRuntime({ archiveJson: ARCHIVE_PROJECTION, storage });
  assert.equal(listEl._children.length, 0, 'no list items rendered while storage is corrupt');
  assert.ok(statusEl.textContent.length > 0, 'a corrupt-status message is shown');
  assert.ok(!/Alpha|Beta/.test(statusEl.textContent), 'no record title leaked into the corrupt state');
});

test('22: the bookmarks view degrades cleanly when storage is disabled (unavailable)', () => {
  const storage = fakeStorage({}, { throwGet: true });
  const { listEl, statusEl } = runBookmarksRuntime({ archiveJson: ARCHIVE_PROJECTION, storage });
  assert.equal(listEl._children.length, 0);
  assert.ok(statusEl.textContent.length > 0, 'an unavailable-status message is shown');
});

test('23: a valid empty bookmark collection shows an honest empty state, not a crash or a fake list', () => {
  const { listEl, statusEl } = runBookmarksRuntime({ archiveJson: ARCHIVE_PROJECTION, storage: fakeStorage() });
  assert.equal(listEl._children.length, 0, 'no items for an empty collection');
  assert.ok(/No bookmarks saved/i.test(statusEl.textContent), 'honest empty-state copy');
});

test('24: the bookmarks page always builds — no getStaticPaths gate, and an unavailable archive renders an honest state', () => {
  assert.ok(!/export function getStaticPaths/.test(BOOKMARKS_PAGE_SRC), 'the bookmarks route has no getStaticPaths gate (always builds)');
  assert.match(BOOKMARKS_PAGE_SRC, /loadGeneratedArchive\(\)/, 'server-side authority is the generated archive');
  assert.match(BOOKMARKS_PAGE_SRC, /bookmarks-archive-unavailable/, 'an archive-unavailable state is rendered server-side');
  // The runtime does not fail when the archive projection is empty (clean checkout).
  assert.doesNotThrow(() => runBookmarksRuntime({ archiveJson: '[]', storage: fakeStorage() }));
});

// --- Record page: share runtime ----------------------------------------------

test('25: native Web Share is preferred when present and the payload is the record URL only (no lore text/title body)', async () => {
  let shared: any = null;
  const navigator: any = { share: (payload: any) => { shared = payload; return Promise.resolve(); }, clipboard: { writeText: () => Promise.resolve() } };
  const { shareBtn } = runRecordRuntime({ navigator, location: { origin: 'https://reader.test' } });
  shareBtn._listeners.click();
  await flush();
  assert.ok(shared, 'navigator.share was called');
  assert.equal(shared.url, 'https://reader.test/record/M_YT/', 'payload is the absolute record URL');
  assert.ok(!('text' in shared) && !('title' in shared), 'no lore title/text body in the share payload');
});

test('25a: Pages-base Share produces the actual public project-site record URL', async () => {
  let shared: any = null;
  const navigator: any = { share: (payload: any) => { shared = payload; return Promise.resolve(); } };
  const shareBtn = makeEl({ dataset: { shareUrl: '/toadaid-lore-reader/record/M_YT/' } });
  const runtime = runRecordRuntime({ shareBtn, navigator, location: { origin: 'https://toadaid.github.io' } });
  runtime.shareBtn._listeners.click();
  await flush();
  assert.equal(shared.url, 'https://toadaid.github.io/toadaid-lore-reader/record/M_YT/');
});

test('26: AbortError (user dismissal) never triggers a surprise clipboard copy', async () => {
  let copied = false;
  const navigator: any = { share: () => Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), clipboard: { writeText: () => { copied = true; return Promise.resolve(); } } };
  const { shareBtn, statusEl } = runRecordRuntime({ navigator, location: { origin: 'https://reader.test' } });
  shareBtn._listeners.click();
  await flush();
  assert.equal(copied, false, 'AbortError must not fall back to a surprise clipboard copy');
  assert.notEqual(statusEl.textContent, 'Link copied', 'no false "copied" success after a cancellation');
});

test('27: no Web Share falls back to Copy Link with the exact deep link; non-Abort share failure also falls back; copy failure degrades quietly', async () => {
  // (a) No navigator.share => exact deep link copied.
  let copied: string | null = null;
  let navigator: any = { clipboard: { writeText: (t: string) => { copied = t; return Promise.resolve(); } } };
  let { shareBtn, statusEl } = runRecordRuntime({ navigator, location: { origin: 'https://reader.test' } });
  shareBtn._listeners.click();
  await flush();
  assert.equal(copied, 'https://reader.test/record/M_YT/', 'exact absolute deep link copied');
  assert.equal(statusEl.textContent, 'Link copied');

  // (b) A non-Abort share rejection falls back to copy.
  copied = null;
  navigator = { share: () => Promise.reject(new Error('share failed')), clipboard: { writeText: (t: string) => { copied = t; return Promise.resolve(); } } };
  ({ shareBtn, statusEl } = runRecordRuntime({ navigator, location: { origin: 'https://reader.test' } }));
  shareBtn._listeners.click();
  await flush();
  assert.equal(copied, 'https://reader.test/record/M_YT/', 'non-Abort failure falls back to copy');

  // (c) Copy failure degrades quietly without throwing and reports no false success.
  navigator = { clipboard: { writeText: () => Promise.reject(new Error('clipboard denied')) } };
  ({ shareBtn, statusEl } = runRecordRuntime({ navigator, location: { origin: 'https://reader.test' } }));
  assert.doesNotThrow(() => shareBtn._listeners.click());
  await flush();
  assert.equal(statusEl.textContent, 'Copy unavailable', 'copy failure reported honestly, no false success');
});
