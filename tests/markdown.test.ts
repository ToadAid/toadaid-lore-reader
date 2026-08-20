import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown, escapeHtml, isSafeUrl } from '../src/lib/lore/markdown.ts';
import { buildSnapshot } from '../scripts/import-canonical-lore.mjs';
import { CANONICAL_REPOSITORY, CANONICAL_PATH } from '../src/lib/lore/provenance.ts';

// ---------------------------------------------------------------------------
// Stage 2A-CI1-R1 — clean-checkout-safe markdown tests.
//
// These presentation tests need real canonical-shaped records, but they must
// NOT depend on the gitignored `generated/` operator-import artifacts (which
// are absent on a clean checkout and made this test fail in CI). The fixture is
// authored entirely inline here and built in-memory via the same pure
// buildSnapshot(...) used by the importer.
//
// This is a small, truthful UNIT fixture. It is NOT the real 130-record
// canonical archive. The real 130-record canonical-generation proof remains a
// separate governed operator ceremony against exact canonical Git-object
// bytes; no assertion here implies the fixture proves that generation.
// ---------------------------------------------------------------------------

const FIXTURE_SOURCE = JSON.stringify([
  {
    id: 'TOBY_FIX_001_FirstRipple',
    date: '2024-03-17',
    title: 'First Ripple',
    comment: '## Commentary on ripples\n\nThe pond *remembers* every **ripple**, and `code` records it.\n\n> a quoted observation',
    original: '## Original account\n\nA bare https://example.test/link appears here.\n\n- one\n- two',
    url: '',
    img: '',
    tags: 't',
  },
  {
    id: 'TOBY_FIX_002_QuietNote',
    date: '2024-04-10',
    title: 'Quiet Note',
    comment: '## A heading comment\n\nOnly commentary here; no original account.',
    original: '',
    url: '',
    img: '',
    tags: '',
  },
  {
    id: 'TOBY_FIX_003_Endurance',
    date: '2024-05-22',
    title: 'Endurance',
    comment: 'A plain commentary paragraph with no heading, proving non-heading commentary still renders.',
    original: '> quoted line\n> second line\n\n*emphasis spanning  \na hard break* and a [link](https://example.test).',
    url: '',
    img: '',
    tags: 't',
  },
]);

const { snapshot: SNAPSHOT } = buildSnapshot(
  FIXTURE_SOURCE,
  { repository: CANONICAL_REPOSITORY, path: CANONICAL_PATH, commit: '0'.repeat(40) },
  '2026-08-20T00:00:00.000Z',
);

const FIXTURE_RECORD_COUNT = JSON.parse(FIXTURE_SOURCE).length;

test('fixture Original and Commentary strings are not rewritten or mutated by presentation', () => {
  for (const record of SNAPSHOT.records) {
    for (const field of ['original', 'comment'] as const) {
      const source = record.canonical[field];
      if (typeof source !== 'string' || source.length === 0) continue;
      const before = source;
      // rendering is a pure read of the canonical string; it must not mutate it
      const html = renderMarkdown(source);
      assert.equal(source, before, `canonical ${field} mutated for ${record.canonicalId}`);
      // presentation produces an HTML fragment, never the raw canonical string back
      assert.notEqual(html, source, `rendered ${field} equals raw source for ${record.canonicalId}`);
    }
  }
});

test('every fixture record renders without throwing and the authored fixture stays intact', () => {
  assert.equal(SNAPSHOT.records.length, FIXTURE_RECORD_COUNT);
  for (const record of SNAPSHOT.records) {
    assert.doesNotThrow(() => renderMarkdown(record.canonical.comment));
    if (typeof record.canonical.original === 'string') assert.doesNotThrow(() => renderMarkdown(record.canonical.original));
  }
});

test('representative markdown renders as semantic structure', () => {
  const md = [
    '## Section',
    '',
    'A paragraph with **bold** and *italic* and `code`.',
    '',
    '- one',
    '- two',
    '',
    '> a quote line',
    '> second line',
    '',
    '---',
    '',
    'A [link](https://example.test) and a bare https://example.test/url.',
  ].join('\n');
  const html = renderMarkdown(md);
  assert.match(html, /<h3>Section<\/h3>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<hr \/>/);
  assert.match(html, /<a href="https:\/\/example\.test"[^>]*>link<\/a>/);
  // bare URL is autolinked, not left as raw text
  assert.match(html, /<a href="https:\/\/example\.test\/url"[^>]*>https:\/\/example\.test\/url<\/a>/);
});

test('blockquote preserves source line structure as primary evidence', () => {
  const md = '> first line\n> second line\n>\n> second stanza';
  const html = renderMarkdown(md);
  assert.match(html, /<blockquote>/);
  assert.ok(html.includes('first line<br>second line'), 'consecutive quote lines keep their breaks');
  assert.ok(html.includes('second stanza'), 'stanza break preserved');
});

test('emphasis spanning a hard line break still renders', () => {
  const md = 'before  \n*italic across  \na break*';
  const html = renderMarkdown(md);
  assert.match(html, /<em>italic across<br>a break<\/em>/);
});

test('unsafe raw HTML in canonical content is escaped and never executed as trusted markup', () => {
  const malicious = [
    '## Heading',
    '',
    'text <script>alert(1)</script> more <img src=x onerror=alert(1)>',
    '',
    '[x](javascript:alert(1)) and [y](data:text/html,<script>)',
  ].join('\n');
  const html = renderMarkdown(malicious);
  assert.ok(!/<script/i.test(html), 'raw <script> must not survive as an element');
  assert.ok(!/<img/i.test(html), 'raw <img> must not survive as an element');
  assert.ok(!/<[^>]+onerror/i.test(html), 'no element may carry an inline event handler');
  assert.ok(!/href="javascript:/i.test(html), 'javascript: must not become a link href');
  assert.ok(!/href="data:/i.test(html), 'data: must not become a link href');
  // the angle brackets are rendered as visible escaped text, not markup
  assert.ok(html.includes('&lt;script&gt;'));
});

test('only http/https/mailto links are honoured; other schemes fall back to text', () => {
  assert.equal(isSafeUrl('https://x.test'), true);
  assert.equal(isSafeUrl('http://x.test'), true);
  assert.equal(isSafeUrl('mailto:a@b.test'), true);
  assert.equal(isSafeUrl('javascript:alert(1)'), false);
  assert.equal(isSafeUrl('data:text/html,xx'), false);
  const html = renderMarkdown('[a](javascript:alert(1))');
  assert.ok(!/href="javascript:/i.test(html));
  assert.ok(html.includes('javascript:alert(1)'), 'unsafe link is shown as escaped text, not a link');
});

test('records missing Original still render commentary-only and fail safe on empty input', () => {
  const missing = SNAPSHOT.records.find(
    (r) => typeof r.canonical.original !== 'string' || r.canonical.original.length === 0,
  );
  assert.ok(missing, 'fixture should contain a record without original');
  const html = renderMarkdown(missing.canonical.comment);
  assert.ok(html.length > 0);
  assert.ok(html.includes('<h3>'));
  // empty / absent original must not throw or emit stray markup
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(undefined as unknown as string), '');
});

test('escapeHtml neutralizes HTML metacharacters', () => {
  assert.equal(escapeHtml('<>&"'), '&lt;&gt;&amp;&quot;');
});