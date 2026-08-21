// Desktop operator settings store (Stage 2A-DESK1 §13).
//
// Persists ONLY the operator setting needed for desktop operation: the local
// canonical repository path (`canonicalRepoPath`). Stored as a small JSON file
// beneath the per-user application data directory that Electron provides.
//
// It does NOT persist lore content, source JSON, canonical bytes, Git
// credentials, tokens, wallet data, bookmark copies, or generated provenance.
// The desktop setting is local operator configuration, not canonical Reader
// state (§13/§27).
//
// Plain JS only: imported by the Electron main process (Node 22.x, no TS strip).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SETTINGS_FILENAME = 'desktop-settings.json';

/**
 * Create a settings store rooted at `dataDirectory` (Electron's
 * `app.getPath('userData')` in production). The store is injectable for tests:
 * pass any directory.
 *
 * @param {string} dataDirectory
 */
export function createSettingsStore(dataDirectory) {
  const dir = resolve(dataDirectory);
  const filePath = resolve(dir, SETTINGS_FILENAME);

  function ensureDir() {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  function read() {
    try {
      const text = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // missing or corrupt: fall through to defaults
    }
    return {};
  }

  function write(data) {
    ensureDir();
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  }

  return {
    /** The configured local canonical repository path, or '' when unset. */
    getCanonicalRepoPath() {
      const data = read();
      const value = data.canonicalRepoPath;
      return typeof value === 'string' ? value : '';
    },
    /** Persist only `canonicalRepoPath`. Replaces the prior value. */
    setCanonicalRepoPath(path) {
      const data = read();
      data.canonicalRepoPath = typeof path === 'string' ? path : '';
      write(data);
      return data.canonicalRepoPath;
    },
    /** Path of the on-disk settings file (for tests/inspection). */
    get filePath() {
      return filePath;
    },
  };
}