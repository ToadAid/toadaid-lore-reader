import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startReaderHost } from './static-reader-host.mjs';
import { get } from 'node:http';

// Stage 2A-DESK1 §23. The desktop host is loopback-only (127.0.0.1, ephemeral
// port) and serves the existing built Reader routes correctly.

function getBody(url) {
  return new Promise((resolveGet, rejectGet) => {
    get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolveGet({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', rejectGet);
  });
}

async function withDist() {
  const dir = await mkdtemp(join(tmpdir(), 'desk-host-'));
  await mkdir(join(dir, 'chronicle'), { recursive: true });
  await mkdir(join(dir, 'bookmarks'), { recursive: true });
  await mkdir(join(dir, 'record', 'TOBY_X'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<!doctype html><html><body>COVER</body></html>');
  await writeFile(join(dir, 'chronicle', 'index.html'), '<!doctype html><html><body>CHRONICLE</body></html>');
  await writeFile(join(dir, 'bookmarks', 'index.html'), '<!doctype html><html><body>BOOKMARKS</body></html>');
  await writeFile(join(dir, 'record', 'TOBY_X', 'index.html'), '<!doctype html><html><body>RECORD</body></html>');
  return dir;
}

test('host binds 127.0.0.1 only, never 0.0.0.0', async () => {
  const dir = await withDist();
  try {
    const { server, origin } = await startReaderHost({ distRoot: dir });
    try {
      const addr = server.address();
      assert.equal(addr.address, '127.0.0.1', 'loopback only — never 0.0.0.0/LAN');
      assert.ok(origin.startsWith('http://127.0.0.1:'), origin);
    } finally { server.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cover route / serves dist/index.html', async () => {
  const dir = await withDist();
  const { server, origin } = await startReaderHost({ distRoot: dir });
  try {
    const res = await getBody(`${origin}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.body, /COVER/);
  } finally { server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Reader routes resolve (chronicle, bookmarks, record/<id>)', async () => {
  const dir = await withDist();
  const { server, origin } = await startReaderHost({ distRoot: dir });
  try {
    assert.match((await getBody(`${origin}/chronicle/`)).body, /CHRONICLE/);
    assert.match((await getBody(`${origin}/bookmarks/`)).body, /BOOKMARKS/);
    assert.match((await getBody(`${origin}/record/TOBY_X/`)).body, /RECORD/);
  } finally { server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('unknown route returns 404, not a traversal', async () => {
  const dir = await withDist();
  const { server, origin } = await startReaderHost({ distRoot: dir });
  const port = Number(origin.split(':').pop());
  try {
    const res = await getBody(`${origin}/no-such-page/`);
    assert.equal(res.status, 404);
    // Path traversal outside dist is rejected (400). Send a RAW request path so
    // the WHATWG URL parser does not normalize the '..' away client-side first.
    const http = await import('node:http');
    const traversal = await new Promise((resolveT) => {
      const r = http.request({ host: '127.0.0.1', port, path: '/../../../../etc/passwd', method: 'GET' }, (resp) => {
        let body = ''; resp.on('data', (c) => { body += c; });
        resp.on('end', () => resolveT({ status: resp.statusCode, body }));
      });
      r.on('error', resolveT);
      r.end();
    });
    assert.equal(traversal.status, 400);
    assert.doesNotMatch(traversal.body || '', /root:/);
  } finally { server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('only GET/HEAD are accepted', async () => {
  const dir = await withDist();
  const { server, origin } = await startReaderHost({ distRoot: dir });
  try {
    const { request } = await import('node:http');
    const res = await new Promise((resolveReq) => {
      const r = request(`${origin}/`, { method: 'POST' }, (resp) => {
        let body = ''; resp.on('data', (c) => { body += c; });
        resp.on('end', () => resolveReq({ status: resp.statusCode, body }));
      });
      r.on('error', resolveReq);
      r.end();
    });
    assert.equal(res.status, 405);
  } finally { server.close(); await rm(dir, { recursive: true, force: true }); }
});