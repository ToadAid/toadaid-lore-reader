'use strict';
// Electron preload — the narrow context-isolation bridge (Stage 2A-DESK1 §9/§10/§11).
//
// SECURITY MODEL (§9/§26):
//   nodeIntegration: false  (Reader page JS has no Node)
//   contextIsolation: true  (preload's Node world is isolated from the page)
//   sandbox: false          (preload needs require for the local overlay module)
//
// Because context isolation is on, the ONLY things that cross into the Reader
// page are what contextBridge.exposeInMainWorld() puts there. The Reader must
// NOT gain require, process, fs, child_process, ipcRenderer, shell, or any
// generic command/filesystem API (§9/§10, tests #18/#19). Only the narrowly
// typed operations in DESKTOP_METHODS are exposed.
//
// The Sync Lore control is INJECTED here by the trusted shell layer (§11), so
// the public/static Reader HTML never authors it (test #1) and it appears only
// under Electron (test #2).

const { contextBridge, ipcRenderer } = require('electron');
const {
  DESKTOP_METHODS,
  FORBIDDEN_EXPOSED,
  buildDesktopOverlayHTML,
  renderStatusMessage,
} = require('./desktop-overlay.cjs');

// Narrow bridge: each method maps to one bounded ipcRenderer.invoke/handle. No
// generic IPC, no arbitrary channel forwarding, no command execution.
const bridge = {
  isDesktop: true,
  getStatus: () => ipcRenderer.invoke('desktop:get-status'),
  chooseCanonicalRepo: () => ipcRenderer.invoke('desktop:choose-repo'),
  syncLore: () => ipcRenderer.invoke('desktop:sync-lore'),
  onStatusUpdate: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('desktop:status-update', listener);
    return () => ipcRenderer.removeListener('desktop:status-update', listener);
  },
};

// Guard: assert the exposed surface is exactly the allowlist and contains none
// of the forbidden names. This runs in the preload (trusted) and fails fast if
// the surface drifts.
const exposedKeys = Object.keys(bridge).sort();
const expectedKeys = [...DESKTOP_METHODS].sort();
if (JSON.stringify(exposedKeys) !== JSON.stringify(expectedKeys)) {
  throw new Error(`desktop bridge surface drift: exposed ${exposedKeys.join(',')} !== expected ${expectedKeys.join(',')}`);
}
for (const forbidden of FORBIDDEN_EXPOSED) {
  if (forbidden in bridge) {
    throw new Error(`desktop bridge must not expose forbidden API: ${forbidden}`);
  }
}

contextBridge.exposeInMainWorld('toadaidDesktop', bridge);

// ---------------------------------------------------------------------------
// Trusted Sync Lore overlay injection (§11). The preload shares the DOM with
// the page but is context-isolated, so this is the one trusted surface that adds
// desktop chrome without the page's JS seeing any Node authority.
// ---------------------------------------------------------------------------

const PANEL_STYLE = [
  'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483647',
  'background:rgba(13,18,16,0.92)', 'color:#e8f0ec', 'border:1px solid #2a3a32',
  'border-radius:8px', 'padding:10px 12px', 'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
  'max-width:240px', 'box-shadow:0 4px 18px rgba(0,0,0,0.45)',
  'backdrop-filter:blur(4px)', 'user-select:none',
].join(';');
const BUTTON_STYLE = [
  'width:100%', 'margin-top:6px', 'padding:6px 10px',
  'background:#1f6f4a', 'color:#fff', 'border:1px solid #2a3a32',
  'border-radius:6px', 'cursor:pointer', 'font:inherit',
].join(';');

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function formatLocal(iso) {
  try { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(); } catch { return iso; }
}

function mountPanel(status) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildDesktopOverlayHTML(status);
  const node = wrapper.firstElementChild;
  if (!node) return null;
  node.style.cssText = PANEL_STYLE;
  const button = node.querySelector('[data-toadaid-action="sync-lore"]');
  if (button) button.style.cssText = BUTTON_STYLE;
  wireButton(node);
  document.body.appendChild(node);
  return node;
}

function wireButton(node) {
  const button = node.querySelector('[data-toadaid-action="sync-lore"]');
  const message = node.querySelector('[data-toadaid-message]');
  if (!button) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Syncing…';
    if (message) message.textContent = '';
    try {
      const result = await window.toadaidDesktop.syncLore();
      if (message) message.textContent = renderStatusMessage(result);
      await refreshStatus();
    } catch (err) {
      if (message) message.textContent = `Sync error: ${err && err.message ? err.message : String(err)}`;
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = 'Sync Lore';
    }
  });
}

// Rebuild the read-only lines from status, preserving the message text and the
// button's in-flight state across a status push (e.g. after sync→build→reload).
function updateOverlay(status) {
  const node = document.querySelector('[data-toadaid-desktop="1"]');
  if (!node) { mountPanel(status); return; }
  const prevMessage = node.querySelector('[data-toadaid-message]')?.textContent || '';
  const prevButton = node.querySelector('[data-toadaid-action="sync-lore"]');
  const prevDisabled = prevButton ? prevButton.disabled : false;
  const prevText = prevButton ? prevButton.textContent : 'Sync Lore';
  node.innerHTML = buildDesktopOverlayHTML(status);
  if (prevDisabled) {
    const b = node.querySelector('[data-toadaid-action="sync-lore"]');
    if (b) { b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = prevText; }
  }
  const m = node.querySelector('[data-toadaid-message]');
  if (m) m.textContent = prevMessage;
  wireButton(node);
}

async function refreshStatus() {
  try { updateOverlay(await window.toadaidDesktop.getStatus()); } catch { /* best-effort */ }
}

function ready(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => fn(), { once: true });
  } else {
    fn();
  }
}

ready(async () => {
  let initialStatus = { available: false, lastSyncedAt: null, inProgress: false };
  try { initialStatus = await window.toadaidDesktop.getStatus(); } catch { /* offline */ }
  mountPanel(initialStatus);
  window.toadaidDesktop.onStatusUpdate((status) => updateOverlay(status));
});