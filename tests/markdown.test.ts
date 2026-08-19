import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { renderMarkdown, escapeHtml, isSafeUrl } from '../src/lib/lore/markdown.ts';

const SNAPSHOT = JSON.parse(readFileSync('generated/reader-snapshot.json', 'utf8'));

test('canonical Original and Commentary strings are not rewritten or mutated by presentation', () => {
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

test('every record renders without throwing and the 130-record archive stays intact', () => {
  assert.equal(SNAPSHOT.records.length, 130);
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