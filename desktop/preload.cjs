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
  createDesktopOverlayController,
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
  'color:#e8f0ec', 'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
  'max-width:min(272px,calc(100vw - 24px))', 'user-select:none',
].join(';');
const BUTTON_STYLE = [
  'width:100%', 'margin-top:7px', 'padding:6px 10px',
  'background:#1f6f4a', 'color:#fff', 'border:1px solid #2a3a32',
  'border-radius:6px', 'cursor:pointer', 'font:inherit',
].join(';');
const COLLAPSED_STYLE = [
  'width:auto', 'margin:0', 'padding:7px 11px', 'background:rgba(13,18,16,0.9)',
  'color:#e8f0ec', 'border:1px solid #52655a', 'border-radius:999px',
  'box-shadow:0 3px 14px rgba(0,0,0,0.38)', 'backdrop-filter:blur(4px)',
  'cursor:pointer', 'font:inherit',
].join(';');
const DETAILS_STYLE = [
  'box-sizing:border-box', 'width:260px', 'max-width:100%', 'padding:10px 12px',
  'background:rgba(13,18,16,0.94)', 'border:1px solid #2a3a32', 'border-radius:8px',
  'box-shadow:0 4px 18px rgba(0,0,0,0.45)', 'backdrop-filter:blur(4px)',
].join(';');
const HEADER_STYLE = ['display:flex', 'align-items:center', 'justify-content:space-between', 'gap:12px'].join(';');
const COLLAPSE_STYLE = [
  'margin:0', 'padding:1px 6px', 'background:transparent', 'color:#d8e4dc',
  'border:1px solid #52655a', 'border-radius:5px', 'cursor:pointer', 'font:inherit',
].join(';');
const LINE_STYLE = ['margin:7px 0 0', 'overflow-wrap:anywhere'].join(';');
const MESSAGE_STYLE = ['margin:7px 0 0', 'max-width:100%', 'white-space:normal', 'overflow-wrap:anywhere', 'color:#f2d9a7'].join(';');

const panelState = { expanded: false, syncing: false, message: '' };
let currentStatus = { available: false, lastSyncedAt: null, inProgress: false };
let controller;

function applyStyles(node) {
  node.style.cssText = PANEL_STYLE;
  const collapsed = node.querySelector('[data-toadaid-action="expand"]');
  if (collapsed) collapsed.style.cssText = COLLAPSED_STYLE;
  const details = node.querySelector('[data-toadaid-details]');
  if (details) details.style.cssText = DETAILS_STYLE;
  const header = node.querySelector('.toadaid-desk-header');
  if (header) header.style.cssText = HEADER_STYLE;
  const collapse = node.querySelector('[data-toadaid-action="collapse"]');
  if (collapse) collapse.style.cssText = COLLAPSE_STYLE;
  for (const line of node.querySelectorAll('.toadaid-desk-line')) line.style.cssText = LINE_STYLE;
  const message = node.querySelector('[data-toadaid-message]');
  if (message) message.style.cssText = MESSAGE_STYLE;
  for (const action of node.querySelectorAll('[data-toadaid-action="choose-repo"], [data-toadaid-action="sync-lore"]')) {
    action.style.cssText = BUTTON_STYLE;
  }
}

function createPanel(status) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildDesktopOverlayHTML(status, panelState);
  const node = wrapper.firstElementChild;
  if (!node) return null;
  applyStyles(node);
  wirePanel(node);
  return node;
}

function renderOverlay() {
  const next = createPanel(currentStatus);
  if (!next) return;
  const prior = document.querySelector('[data-toadaid-desktop="1"]');
  if (prior) prior.replaceWith(next);
  else document.body.appendChild(next);
}

function wirePanel(node) {
  node.querySelector('[data-toadaid-action="expand"]')?.addEventListener('click', () => {
    panelState.expanded = true;
    renderOverlay();
  });
  node.querySelector('[data-toadaid-action="collapse"]')?.addEventListener('click', () => {
    panelState.expanded = false;
    renderOverlay();
  });

  node.querySelector('[data-toadaid-action="choose-repo"]')?.addEventListener('click', async () => {
    try {
      panelState.message = '';
      await controller.chooseCanonicalRepo();
    } catch (err) {
      panelState.message = `Folder selection error: ${err && err.message ? err.message : String(err)}`;
      renderOverlay();
    }
  });

  node.querySelector('[data-toadaid-action="sync-lore"]')?.addEventListener('click', async () => {
    if (panelState.syncing) return;
    panelState.syncing = true;
    panelState.message = '';
    renderOverlay();
    try {
      panelState.message = renderStatusMessage(await controller.syncLore());
    } catch (err) {
      panelState.message = `Sync error: ${err && err.message ? err.message : String(err)}`;
    } finally {
      panelState.syncing = false;
      try { await controller.refreshStatus(); } catch { renderOverlay(); }
    }
  });
}

function updateOverlay(status) {
  currentStatus = status || currentStatus;
  renderOverlay();
}

function ready(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => fn(), { once: true });
  } else {
    fn();
  }
}

ready(async () => {
  controller = createDesktopOverlayController(bridge, updateOverlay);
  try { await controller.refreshStatus(); } catch { renderOverlay(); }
  controller.subscribe();
});
