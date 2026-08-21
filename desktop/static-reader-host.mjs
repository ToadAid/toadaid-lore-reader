// Loopback static Reader host (Stage 2A-DESK1 §23).
//
// The desktop shell serves the EXISTING built Reader (dist/) over a loopback-
// only HTTP host owned by the Electron main process, so the Reader's absolute
// routes (/, /chronicle/, /bookmarks/, /record/<canonicalId>/) resolve
// correctly. Raw file:// absolute-route behavior is not relied upon (§23).
//
// Hard network boundary (§23):
//   - binds 127.0.0.1 ONLY (never 0.0.0.0, never a LAN listener)
//   - ephemeral port (port 0 → OS-assigned)
//   - no external serving
//
// Plain JS, node:http only. Injectable for tests.

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Start a loopback-only static host rooted at `distRoot`.
 *
 * @param {object} opts
 * @param {string} opts.distRoot Absolute path to the built Reader (dist/).
 * @param {string} [opts.host] Bind host (default '127.0.0.1').
 * @param {number} [opts.port] Bind port (default 0 = ephemeral).
 * @returns {Promise<{server: import('node:http').Server, origin: string}>}
 */
export function startReaderHost({ distRoot, host = '127.0.0.1', port = 0 }) {
  const root = resolve(distRoot);
  return new Promise((startResolve, startReject) => {
    const server = createServer((req, res) => handle(req, res, root));

    server.on('error', startReject);

    server.listen(port, host, () => {
      const addr = server.address();
      const boundHost = typeof addr === 'object' && addr ? addr.address : host;
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      startResolve({ server, origin: `http://${boundHost}:${boundPort}` });
    });
  });
}

function handle(req, res, root) {
  // Only accept GET/HEAD.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('405 Method Not Allowed');
    return;
  }

  // Parse the URL path safely and prevent path traversal outside dist.
  const parsed = safeRequestPath(req.url);
  if (!parsed) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }

  const filePath = resolveFile(root, parsed);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>Not found</title><h1>404 — page not found</h1><p>This Reader route has no built page.</p>');
    return;
  }

  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const body = readFileSync(filePath);
  res.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    // Restrictive CSP: the trusted Reader is static; block remote script/frames.
    // Historical media rendering follows existing Reader rules (§24) and uses
    // a governed allowlist already authored in the pages, not relaxed here.
    'content-security-policy': "default-src 'self'; img-src 'self' https: data:; media-src 'self' https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src https:; connect-src 'self'; base-uri 'self'",
  });
  if (req.method === 'HEAD') {
    res.writeHead(204, { 'content-type': type });
    res.end();
    return;
  }
  res.end(body);
}

function safeRequestPath(url) {
  if (!url || typeof url !== 'string') return null;
  let path = url.split('?')[0].split('#')[0];
  if (!path.startsWith('/')) path = `/${path}`;
  // Decode then normalize, rejecting traversal.
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { return null; }
  if (decoded.includes('\0')) return null;
  // Reject any '..' path segment (decoded, before normalize) — a traversal
  // attempt. normalize() would collapse leading '..' against root into a path
  // that no longer contains '..', so the check must happen on the decoded input.
  if (/(^|\/)\.\.(\/|$)/.test(decoded)) return null;
  const normalized = normalize(decoded);
  return normalized;
}

function resolveFile(root, requestPath) {
  // /chronicle/  -> dist/chronicle/index.html
  // /chronicle   -> dist/chronicle/index.html (or dist/chronicle.html)
  // /index.html  -> dist/index.html
  const candidate = join(root, requestPath);
  try {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      const indexFile = join(candidate, 'index.html');
      if (existsSync(indexFile) && statSync(indexFile).isFile()) return indexFile;
    }
    const withHtml = `${candidate}.html`;
    if (existsSync(withHtml) && statSync(withHtml).isFile()) return withHtml;
    if (requestPath !== '/' && !requestPath.endsWith('/')) {
      const withIndex = join(candidate, 'index.html');
      if (existsSync(withIndex) && statSync(withIndex).isFile()) return withIndex;
    }
  } catch {
    return null;
  }
  return null;
}