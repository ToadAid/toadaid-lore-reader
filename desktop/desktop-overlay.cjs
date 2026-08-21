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
 * string. The preload inserts it into the Reader page. Matches the §11
 * preferred presentation:
 *
 *   Lore
 *   Last synced: <local date/time or Never>
 *   Generation: <short SHA or unavailable>
 *   [ Sync Lore ]
 *
 * @param {object} status Result of readDesktopLoreStatus plus an optional
 *   `lastSyncedAt` ISO string and an `inProgress` flag.
 */
function buildDesktopOverlayHTML(status) {
  const s = status || {};
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
  const inProgress = s.inProgress === true;
  const buttonState = inProgress ? 'aria-busy="true" disabled' : '';
  const buttonText = inProgress ? 'Syncing…' : 'Sync Lore';

  return `<aside class="toadaid-desk-panel" aria-label="ToadAid desktop lore sync" data-toadaid-desktop="1">
  <p class="toadaid-desk-title">Lore</p>
  <p class="toadaid-desk-line">Last synced: <span>${lastSynced}</span></p>
  ${recordLine}
  <p class="toadaid-desk-line">Generation: <code>${generation}</code></p>
  <button type="button" class="toadaid-desk-sync" data-toadaid-action="sync-lore" ${buttonState}>${buttonText}</button>
  <p class="toadaid-desk-message" data-toadaid-message role="status" aria-live="polite"></p>
</aside>`;
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
  renderStatusMessage,
};