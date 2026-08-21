// DesktopLoreSyncService (Stage 2A-DESK1 §15/§16/§30).
//
// The narrow testable orchestration seam between the desktop UI and the existing
// P2R2 sync engine + Reader build. Behavior is NOT buried inside Electron event
// callbacks: this module is pure JS with no Electron dependency and no
// TypeScript import, so it runs under system Node in the desktop tests with
// injectable fakes (§30):
//
//   DesktopLoreSyncService
//     ↓ sync (default: runCanonicalSync — spawns existing `npm run sync:canonical`)
//     ↓ success
//     build (default: runReaderBuild — spawns existing `npm run build`)
//     ↓ success
//     reload callback (main process reloads the Reader view)
//
// Laws enforced here (§15/§16/§20):
//  - exactly one sync/build operation in flight; a second click does not queue.
//  - requires a configured canonical repo path; otherwise refused WITHOUT sync.
//  - sync refusal stops; build is not invoked.
//  - build success emits exactly one reload; build failure does not claim
//    success and does not retry.
//  - the prior verified Reader remains usable on refusal/build-failure (the
//    P2R2 engine preserves generated/ on refusal; reload is only on full success).

import { readDesktopLoreStatus, shortCommit } from './desktop-status.mjs';
import { runCanonicalSync, runReaderBuild } from './native-sync.mjs';

/**
 * @param {object} opts
 * @param {string} opts.repoRoot Lore Reader repo root.
 * @param {object} settingsStore createSettingsStore() instance.
 * @param {string} [opts.generatedDir] Generated dir (default <repoRoot>/generated).
 * @param {Function} [opts.reload] Called once after a successful sync+build.
 * @param {Function} [opts.sync] Sync impl (default runCanonicalSync).
 * @param {Function} [opts.build] Build impl (default runReaderBuild).
 * @param {Function} [opts.now] Clock (default () => new Date().toISOString()).
 */
export function createDesktopLoreSyncService(opts) {
  const cfg = opts || {};
  const repoRoot = cfg.repoRoot;
  const settingsStore = cfg.settingsStore;
  const generatedDir = cfg.generatedDir ?? (repoRoot ? `${repoRoot}/generated` : 'generated');
  const reload = cfg.reload ?? (() => {});
  const sync = cfg.sync ?? runCanonicalSync;
  const build = cfg.build ?? runReaderBuild;
  const now = cfg.now ?? (() => new Date().toISOString());

  let inFlight = false;
  let lastSyncedAt = null;

  // Seed "last synced" from the existing verified generation (§41): desktop
  // startup shows the last verified Reader immediately. The generation's
  // `generatedAt` is the sync-engine timestamp; if absent, leave Never.
  try {
    const seeded = readDesktopLoreStatus(generatedDir);
    if (seeded.available && seeded.generatedAt) lastSyncedAt = seeded.generatedAt;
  } catch {
    // ignore — lastSyncedAt stays null ("Never")
  }

  /** Current status for the overlay (§11/§27). */
  function getStatus() {
    const gen = readDesktopLoreStatus(generatedDir);
    return {
      available: gen.available,
      commit: gen.commit,
      recordCount: gen.recordCount,
      sourceDigest: gen.sourceDigest,
      generation: shortCommit(gen),
      lastSyncedAt,
      inProgress: inFlight,
    };
  }

  /**
   * Run the explicit Sync Lore ceremony (§15). Returns a structured result the
   * caller surfaces to the user. Never throws: classified outcomes are values.
   */
  async function syncLore() {
    // §15.1: reject a second sync while one is active; do not queue (§16).
    if (inFlight) {
      return { kind: 'busy', ok: false, reason: 'a sync is already in progress' };
    }
    // §15.2: require a configured canonical repo path; refuse WITHOUT sync.
    const canonicalRepo = settingsStore ? settingsStore.getCanonicalRepoPath() : '';
    if (!canonicalRepo) {
      return { kind: 'no-config', ok: false, reason: 'no canonical repository configured' };
    }

    inFlight = true;
    try {
      // §15.3: invoke the existing canonical sync engine (spawned).
      const syncResult = await sync({ canonicalRepo, repoRoot, output: generatedDir });
      if (!syncResult || !syncResult.ok) {
        // §15.5: sync refused → stop. Do not build. Prior Reader preserved.
        return { kind: 'refused', ok: false, reason: (syncResult && syncResult.reason) || 'sync refused' };
      }

      // §15.6: sync succeeded → rebuild the Reader.
      const buildResult = await build({ repoRoot });
      if (!buildResult || !buildResult.ok) {
        // §19: sync ok but build failed. Do not claim Reader updated; no reload,
        // no retry. Keep the currently loaded Reader view intact.
        return {
          kind: 'build-failed',
          ok: false,
          reason: (buildResult && buildResult.reason) || 'build failed',
          commit: syncResult.commit,
          recordCount: syncResult.recordCount,
        };
      }

      // §15.7/§17: build succeeded → reload once; surface success with real
      // provenance (no hardcoded counts/SHA).
      lastSyncedAt = syncResult.generatedAt || now();
      reload();
      return {
        kind: 'success',
        ok: true,
        commit: syncResult.commit,
        recordCount: syncResult.recordCount,
        syncedAt: lastSyncedAt,
      };
    } finally {
      inFlight = false;
    }
  }

  return { getStatus, syncLore, setLastSyncedAt: (v) => { lastSyncedAt = v; } };
}