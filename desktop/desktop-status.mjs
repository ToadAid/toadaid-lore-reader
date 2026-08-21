// Desktop lore status reader (Stage 2A-DESK1 §27).
//
// The desktop shell derives its status display from the EXISTING generated
// Reader provenance — it does NOT invent provenance and does NOT treat desktop
// settings as provenance. This module reads `generated/LORE_SOURCE.json` with
// plain Node primitives only (no TypeScript import). The actual VALIDATION of
// that file is owned by the P2R2 sync engine (and the sealed archive-cover-state
// loader); the desktop only DISPLAYS the already-verified generation's fields.
//
// Plain JS only: this module is imported by the Electron main process, which
// runs on Electron's bundled Node (Node 22.x, no native TS type-stripping), so
// it must not import the TypeScript sync/loader sources directly.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Read the current generation's display provenance from a generated
 * directory. Best-effort: any missing/malformed file yields `{ available: false }`
 * rather than throwing — status display never blocks the Reader from loading.
 *
 * @param {string} generatedDirectory
 * @returns {{ available: boolean, commit?: string, recordCount?: number, sourceDigest?: string, generatedAt?: string }}
 */
export function readDesktopLoreStatus(generatedDirectory = resolve(process.cwd(), 'generated')) {
  const provenancePath = resolve(generatedDirectory, 'LORE_SOURCE.json');
  if (!existsSync(provenancePath)) return { available: false };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(provenancePath, 'utf8'));
  } catch {
    return { available: false };
  }
  if (!parsed || typeof parsed !== 'object') return { available: false };
  const commit = typeof parsed.commit === 'string' ? parsed.commit : undefined;
  const recordCount = Number.isInteger(parsed.recordCount) ? parsed.recordCount : undefined;
  const sourceDigest = typeof parsed.sourceDigest === 'string' ? parsed.sourceDigest : undefined;
  const generatedAt = typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined;
  // A usable status requires at least the generation commit; otherwise treat as
  // unavailable so we never show a fabricated generation.
  if (typeof commit !== 'string' || commit.length === 0) return { available: false };
  return { available: true, commit, recordCount, sourceDigest, generatedAt };
}

/** Short display form of a commit SHA (first 7), or `unavailable`. */
export function shortCommit(status) {
  if (!status || !status.available || !status.commit) return 'unavailable';
  return status.commit.slice(0, 7);
}