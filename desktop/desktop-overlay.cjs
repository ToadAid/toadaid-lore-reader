'use strict';
// Desktop Sync Lore overlay (Stage 2A-DESK1 §10/§11).
//
// Pure CommonJS module (no Electron dependency) so it can be required by the
// preload script AND imported by the desktop tests without launching Electron.
// It builds the trusted desktop shell chrome — the small Sync Lore control —
// as an HTML string that the preload injects into the loaded Reader page, and
// it declares the NARROW set of bridge methods the preload is allowed to expose.
//
// The public/static Reader is never authored with this control; it is injected
// at runtime only by the trusted Electron preload layer (§11, test #1/#2).
//
// The exposed bridge surface is fixed and minimal (§9/§10, tests #18/#19). The
// Reader must NOT gain a generic process/fs/child-process/IPC API; only these
// narrowly typed operations may cross the context-isolation boundary.

// Exactly the methods the preload exposes on window.toadaidDesktop. Tests
// assert this list is the complete surface and contains no forbidden names.
const DESKTOP_METHODS = Object.freeze([
  'isDesktop',
  'getStatus',
  'chooseCanonicalRepo',
  'syncLore',
  'onStatusUpdate',
]);

// Names that must NEVER appear on the exposed bridge (§9/§10). Tests assert
// none of these are present in DESKTOP_METHODS or the overlay's data surface.
const FORBIDDEN_EXPOSED = Object.freeze([
  'require', 'process', 'fs', 'child_process', 'childProcess',
  'ipcRenderer', 'shell', 'exec', 'spawn', 'runCommand',
  'readFile', 'writeFile', 'git', 'eval',
]);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render the small, visually restrained desktop shell chrome as an HTML
 * string. The preload inserts it into the Reader page. It is collapsed by
 * default and expands in place without affecting Reader layout.
 *
 *   Lore Sync
 *   Source: <bounded repository basename or Not configured>
 *   Last synced: <local date/time or Never>
 *   Generation: <short SHA or unavailable>
 *   [ Choose/Change Lore Folder ]
 *   [ Sync Lore ]
 *
 * @param {object} status Result of readDesktopLoreStatus plus an optional
 *   `lastSyncedAt` ISO string and an `inProgress` flag.
 */
function buildDesktopOverlayHTML(status, options = {}) {
  const s = status || {};
  const expanded = options.expanded === true;
  const available = s.available === true;
  const generation = available && s.commit
    ? escapeHtml(String(s.commit).slice(0, 7))
    : 'unavailable';
  const lastSynced = s.lastSyncedAt
    ? escapeHtml(formatLocal(s.lastSyncedAt))
    : 'Never';
  const recordLine = available && Number.isInteger(s.recordCount)
    ? `<p class="toadaid-desk-line">Records: <span>${escapeHtml(String(s.recordCount))}</span></p>`
    : '';
  const inProgress = s.inProgress === true || options.syncing === true;
  const buttonState = inProgress ? 'aria-busy="true" disabled' : '';
  const buttonText = inProgress ? 'Syncing…' : 'Sync Lore';
  const sourceConfigured = s.sourceConfigured === true;
  const sourceName = sourceConfigured && s.sourceName
    ? escapeHtml(String(s.sourceName))
    : 'Not configured';
  const chooseText = sourceConfigured ? 'Change Lore Folder' : 'Choose Lore Folder';
  const message = options.message ? escapeHtml(String(options.message)) : '';

  return `<aside class="toadaid-desk-panel" aria-label="ToadAid desktop lore sync" data-toadaid-desktop="1" data-expanded="${expanded ? 'true' : 'false'}">
  <button type="button" class="toadaid-desk-collapsed" data-toadaid-action="expand" aria-expanded="${expanded ? 'true' : 'false'}" ${expanded ? 'hidden' : ''}>${inProgress ? '↻ Syncing…' : '↻ Lore Sync'}</button>
  <section class="toadaid-desk-details" data-toadaid-details ${expanded ? '' : 'hidden'}>
    <header class="toadaid-desk-header"><strong>Lore Sync</strong><button type="button" data-toadaid-action="collapse" aria-label="Collapse Lore Sync panel">▴</button></header>
    <p class="toadaid-desk-line">Source: <span>${sourceName}</span></p>
    <button type="button" class="toadaid-desk-choose" data-toadaid-action="choose-repo">${chooseText}</button>
    <p class="toadaid-desk-line">Last synced: <span>${lastSynced}</span></p>
    ${recordLine}
    <p class="toadaid-desk-line">Generation: <code>${generation}</code></p>
    <button type="button" class="toadaid-desk-sync" data-toadaid-action="sync-lore" ${buttonState}>${buttonText}</button>
    <p class="toadaid-desk-message" data-toadaid-message role="status" aria-live="polite">${message}</p>
  </section>
</aside>`;
}

/**
 * Trusted preload orchestration over the already-local bridge. This controller
 * deliberately has no `window` dependency: contextBridge exposure is for the
 * page-facing API, while preload-owned UI calls these local methods directly.
 */
function createDesktopOverlayController(bridge, updateStatus) {
  if (!bridge || typeof updateStatus !== 'function') throw new TypeError('bridge and updateStatus are required');
  async function refreshStatus() {
    const status = await bridge.getStatus();
    updateStatus(status);
    return status;
  }
  return {
    syncLore: () => bridge.syncLore(),
    refreshStatus,
    async chooseCanonicalRepo() {
      const selected = await bridge.chooseCanonicalRepo();
      if (selected) await refreshStatus();
      return selected;
    },
    subscribe: () => bridge.onStatusUpdate((status) => updateStatus(status)),
  };
}

function formatLocal(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

/** Render a concise status/result message for the overlay (success/refusal/build-failure). */
function renderStatusMessage(result) {
  if (!result) return '';
  if (result.kind === 'success') {
    const records = Number.isInteger(result.recordCount) ? String(result.recordCount) : 'unknown';
    const gen = result.commit ? String(result.commit).slice(0, 7) : 'unknown';
    const when = result.syncedAt ? formatLocal(result.syncedAt) : '';
    return `Lore synced — Records: ${records}, Generation: ${gen}${when ? `, Synced: ${when}` : ''}`;
  }
  if (result.kind === 'refused') {
    return `Lore sync refused${result.reason ? ': ' + result.reason : ''}. Previous verified lore preserved.`;
  }
  if (result.kind === 'build-failed') {
    const gen = result.commit ? String(result.commit).slice(0, 7) : 'unknown';
    return `Lore synchronized, but desktop Reader rebuild failed (Generation: ${gen}).`;
  }
  if (result.kind === 'no-config') {
    return 'No canonical repository configured. Choose one to sync.';
  }
  if (result.kind === 'busy') {
    return 'A sync is already in progress.';
  }
  return '';
}

module.exports = {
  DESKTOP_METHODS,
  FORBIDDEN_EXPOSED,
  buildDesktopOverlayHTML,
  createDesktopOverlayController,
  renderStatusMessage,
};
