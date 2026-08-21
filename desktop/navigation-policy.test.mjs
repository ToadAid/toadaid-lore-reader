import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyNavigation } from './navigation-policy.mjs';

// Stage 2A-DESK1 §25 / §31 tests #20/#21/#22.

const ORIGIN = 'http://127.0.0.1:54321';

test('#22 trusted Reader routes remain inside the desktop shell', () => {
  assert.equal(classifyNavigation(ORIGIN, `${ORIGIN}/`), 'allow');
  assert.equal(classifyNavigation(ORIGIN, `${ORIGIN}/chronicle/`), 'allow');
  assert.equal(classifyNavigation(ORIGIN, `${ORIGIN}/bookmarks/`), 'allow');
  assert.equal(classifyNavigation(ORIGIN, `${ORIGIN}/record/TOBY_T001_FirstRipple/`), 'allow');
  // Relative URLs (same-origin Reader links) stay inside.
  assert.equal(classifyNavigation(ORIGIN, '/chronicle/'), 'allow');
  assert.equal(classifyNavigation(ORIGIN, '../bookmarks/'), 'allow');
});

test('#20 external HTTP/HTTPS links leave the trusted Reader window', () => {
  assert.equal(classifyNavigation(ORIGIN, 'https://example.com/some/page'), 'external');
  assert.equal(classifyNavigation(ORIGIN, 'http://example.com'), 'external');
  assert.equal(classifyNavigation(ORIGIN, 'https://www.youtube.com/embed/x'), 'external');
});

test('#21 unsafe schemes are refused (block)', () => {
  assert.equal(classifyNavigation(ORIGIN, 'javascript:alert(1)'), 'block');
  assert.equal(classifyNavigation(ORIGIN, 'file:///etc/passwd'), 'block');
  assert.equal(classifyNavigation(ORIGIN, 'data:text/html,<script>1</script>'), 'block');
  assert.equal(classifyNavigation(ORIGIN, 'shell:open'), 'block');
  assert.equal(classifyNavigation(ORIGIN, 'vbscript:msgbox'), 'block');
  assert.equal(classifyNavigation(ORIGIN, 'blob:https://example.com/abc'), 'block');
});

test('non-http/https schemes other than unsafe are also blocked', () => {
  assert.equal(classifyNavigation(ORIGIN, 'ftp://example.com'), 'block');
  assert.equal(classifyNavigation(ORIGIN, 'about:blank'), 'block');
  assert.equal(classifyNavigation(ORIGIN, ''), 'block');
});

test('a different loopback origin is treated as external (not same-origin)', () => {
  assert.equal(classifyNavigation(ORIGIN, 'http://127.0.0.1:9999/'), 'external');
});