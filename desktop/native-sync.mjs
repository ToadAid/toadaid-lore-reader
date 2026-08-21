// Native sync/build operations (Stage 2A-DESK1 §8/§15).
//
// The desktop shell does NOT reimplement canonical sync, parsing, validation,
// digest computation, provenance, transactional publication, media
// interpretation, or snapshot construction (§8). There is ONE canonical sync
// implementation: scripts/sync-canonical-lore.mjs (the P2R2 engine). The desktop
// REUSES it by spawning the existing governed `sync:canonical` npm script with
// the operator-selected local canonical repository path.
//
// Why spawn instead of a direct import: the P2R2 engine and the archive loader
// are TypeScript sources imported via Node's native TS type-stripping. Electron
// bundles Node 22.x, which does NOT strip TypeScript, so the Electron main
// process cannot import those .ts sources directly. Spawning the existing npm
// script runs it under the system Node (which strips TS), reusing the exact
// governed production code path. This is the §8-authorized fallback ("spawn
// existing npm sync:canonical command only if direct reuse is mechanically
// unsuitable") — direct reuse is mechanically unsuitable here.
//
// Plain JS, node:child_process only. Injectable in the service for tests.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Spawn the existing `npm run sync:canonical` command against the operator's
 * local canonical repository. The desktop supplies ONLY `--canonical-repo` and
 * `--output`; it never supplies --commit, --digest, --source bytes, --source-path,
 * or --repository (§15 tests #14/#15/#16). Generation resolution (resolve main →
 * freeze SHA → import git-object bytes → validate → provenance) stays owned by
 * the sync engine.
 *
 * Resolves to:
 *   { ok: true,  commit, recordCount, sourceDigest }
 *   { ok: false, reason }
 * The sync engine sets exit code 0 on success and 1 on refusal/error; the
 * structured provenance is read back from the output directory's LORE_SOURCE.json
 * (the authoritative artifact the engine wrote), not parsed from CLI text.
 *
 * @param {object} opts
 * @param {string} opts.canonicalRepo Local canonical repository path.
 * @param {string} opts.repoRoot Lore Reader repo root (cwd for npm).
 * @param {string} [opts.output] Output dir (default <repoRoot>/generated).
 * @param {(child: import('node:child_process').ChildProcess) => void} [onSpawn]
 */
export function runCanonicalSync({ canonicalRepo, repoRoot, output, onSpawn }) {
  return new Promise((resolvePromise) => {
    const cwd = resolve(repoRoot);
    const outDir = resolve(output ?? resolve(cwd, 'generated'));
    // The desktop never pins a generation: only --canonical-repo and --output.
    const args = ['run', 'sync:canonical', '--', '--canonical-repo', canonicalRepo, '--output', outDir];
    let stdout = '';
    let stderr = '';
    const child = spawn('npm', args, { cwd, env: process.env });
    if (typeof onSpawn === 'function') onSpawn(child);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      resolvePromise({ ok: false, reason: `failed to launch sync: ${err.message}` });
    });
    child.on('close', (code) => {
      if (code === 0) {
        // Read the authoritative provenance the engine just wrote.
        try {
          // Lazy import of the plain-JS status reader (no TS) to avoid a static
          // dependency cycle; the reader is plain JS and safe under Electron.
          import('./desktop-status.mjs').then(({ readDesktopLoreStatus }) => {
            const status = readDesktopLoreStatus(outDir);
            if (!status.available) {
              resolvePromise({ ok: false, reason: 'sync reported success but no generation provenance was found' });
              return;
            }
            resolvePromise({
              ok: true,
              commit: status.commit,
              recordCount: status.recordCount,
              sourceDigest: status.sourceDigest,
              generatedAt: status.generatedAt,
            });
          }).catch((err) => resolvePromise({ ok: false, reason: `failed to read post-sync provenance: ${err.message}` }));
        } catch (err) {
          resolvePromise({ ok: false, reason: `failed to read post-sync provenance: ${err.message}` });
        }
        return;
      }
      // Refusal or error: extract the governed reason line if present.
      const reason = extractReason(stdout) || extractReason(stderr) || `sync exited with code ${code}`;
      resolvePromise({ ok: false, reason });
    });
  });
}

function extractReason(text) {
  if (!text) return '';
  for (const line of text.split(/\r?\n/)) {
    const m = /^reason:\s*(.*)$/.exec(line.trim());
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

/**
 * Spawn the existing `npm run build` command (Astro build) from the Reader
 * repo root. The desktop does not alter the build or its semantics (§34/§38).
 * Resolves to { ok: true } on exit code 0, else { ok: false, reason }.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot Lore Reader repo root (cwd for npm).
 * @param {(child: import('node:child_process').ChildProcess) => void} [onSpawn]
 */
export function runReaderBuild({ repoRoot, onSpawn }) {
  return new Promise((resolvePromise) => {
    const cwd = resolve(repoRoot);
    let stderr = '';
    const child = spawn('npm', ['run', 'build'], { cwd, env: process.env });
    if (typeof onSpawn === 'function') onSpawn(child);
    child.stdout.on('data', () => {});
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => resolvePromise({ ok: false, reason: `failed to launch build: ${err.message}` }));
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ ok: true });
      resolvePromise({ ok: false, reason: `build exited with code ${code}${stderr ? `: ${stderr.trim().slice(-400)}` : ''}` });
    });
  });
}