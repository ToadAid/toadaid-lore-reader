import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { establishSingleInstance } from './single-instance.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

test('a second process quits before registering desktop lifecycle authority', () => {
  let quitCalls = 0;
  let onCalls = 0;
  const app = {
    requestSingleInstanceLock: () => false,
    quit: () => { quitCalls += 1; },
    on: () => { onCalls += 1; },
  };
  assert.equal(establishSingleInstance({ app, getWindow: () => null }), false);
  assert.equal(quitCalls, 1);
  assert.equal(onCalls, 0);
});

test('the first process restores, shows, and focuses its window for a second-instance event', () => {
  let listener;
  const calls = [];
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };
  const app = {
    requestSingleInstanceLock: () => true,
    quit: () => assert.fail('first process must not quit'),
    on: (event, callback) => { assert.equal(event, 'second-instance'); listener = callback; },
  };
  assert.equal(establishSingleInstance({ app, getWindow: () => window }), true);
  listener();
  assert.deepEqual(calls, ['restore', 'show', 'focus']);
});

test('main acquires the native lock before creating a host, service, or window', async () => {
  const main = await readFile(new URL('./main.mjs', import.meta.url), 'utf8');
  const lockAt = main.indexOf('establishSingleInstance({ app');
  const lifecycleAt = main.indexOf('if (ownsDesktopAuthority)');
  const readyAt = main.indexOf('app.whenReady()', lifecycleAt);
  assert.ok(lockAt >= 0 && lifecycleAt > lockAt && readyAt > lifecycleAt);
  assert.match(main.slice(lifecycleAt), /app\.whenReady\(\)\.then\(bootstrap\)/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
});
