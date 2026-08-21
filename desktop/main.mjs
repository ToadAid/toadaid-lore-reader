// Electron main process — ToadAid Lore Reader desktop shell (Stage 2A-DESK1).
//
// The desktop host wraps the EXISTING built static Reader (dist/) and adds ONE
// operator control: Sync Lore. The Reader remains the Astro static Reader;
// this shell is operator tooling with filesystem/Git authority (§1/§22).
//
// Architecture:
//   Electron main (this file) — window, loopback host, narrow IPC, navigation policy
//     ↓ reuses
//   DesktopLoreSyncService (lore-sync-service.mjs) — testable orchestration seam
//     ↓ spawns (no duplicate implementation — §8)
//   `npm run sync:canonical` (P2R2 engine) → `npm run build` → reload
//
// Security: see preload.cjs. nodeIntegration:false, contextIsolation:true.
// No public runtime canonical fetch; sync is an explicit operator button (§24/§41).

import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { startReaderHost } from './static-reader-host.mjs';
import { createSettingsStore } from './settings-store.mjs';
import { createDesktopLoreSyncService } from './lore-sync-service.mjs';
import { classifyNavigation } from './navigation-policy.mjs';
import { establishSingleInstance } from './single-instance.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DIST_ROOT = join(REPO_ROOT, 'dist');
const GENERATED_DIR = join(REPO_ROOT, 'generated');
const PRELOAD_PATH = join(__dirname, 'preload.cjs');

/** @type {BrowserWindow|null} */
let mainWindow = null;
let hostOrigin = null;

async function bootstrap() {
  // Loopback-only static host for the built Reader (§23). 127.0.0.1, ephemeral.
  const host = await startReaderHost({ distRoot: DIST_ROOT });
  hostOrigin = host.origin;

  const settingsStore = createSettingsStore(app.getPath('userData'));
  const service = createDesktopLoreSyncService({
    repoRoot: REPO_ROOT,
    settingsStore,
    generatedDir: GENERATED_DIR,
    reload: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reloadIgnoringCache();
      }
    },
  });

  registerIpc(settingsStore, service);
  await createWindow();
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    title: 'ToadAid Lore Reader',
    backgroundColor: '#0d1210',
    webPreferences: {
      nodeIntegration: false,   // §9/§26: Reader page JS has no Node
      contextIsolation: true,   // §9/§26: preload world isolated from page
      sandbox: false,           // preload needs require for the local overlay module
      preload: PRELOAD_PATH,
    },
  });

  installNavigationPolicy(mainWindow, hostOrigin);

  await mainWindow.loadURL(hostOrigin);
}

function installNavigationPolicy(window, origin) {
  const wc = window.webContents;

  // In-page/JS navigations: keep trusted Reader routes inside; send safe
  // http/https to the OS browser; block unsafe schemes (§25, tests #20/#21/#22).
  wc.on('will-navigate', (event, url) => {
    const decision = classifyNavigation(origin, url);
    if (decision === 'allow') return;            // a Reader route — stay inside
    event.preventDefault();                       // never replace the trusted Reader
    if (decision === 'external') {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
    // 'block' → just prevented
  });

  // window.open / target=_blank: never open in-app; route http/https externally.
  wc.setWindowOpenHandler(({ url }) => {
    const decision = classifyNavigation(origin, url);
    if (decision === 'external' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' }; // never replace the trusted window
  });
}

function pushStatus(service) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop:status-update', service.getStatus());
  }
}

function registerIpc(settingsStore, service) {
  ipcMain.handle('desktop:get-status', () => service.getStatus());

  ipcMain.handle('desktop:choose-repo', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select the local canonical repository (ToadAid/toadaid.github.io)',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null;
    const selected = result.filePaths[0];
    settingsStore.setCanonicalRepoPath(selected);
    pushStatus(service);
    return true;
  });

  ipcMain.handle('desktop:sync-lore', async () => {
    const result = await service.syncLore();
    pushStatus(service);
    return result;
  });
}

// Establish native Electron desktop authority before any host/service/window is
// created. A second process exits and focuses/restores this first window.
const ownsDesktopAuthority = establishSingleInstance({ app, getWindow: () => mainWindow });

if (ownsDesktopAuthority) {
  // No auto-sync on start (§41).
  app.whenReady().then(bootstrap).catch((err) => {
    console.error('ToadAid desktop shell failed to start:', err && err.message ? err.message : err);
    process.exitCode = 1;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (mainWindow === null) await bootstrap();
    }
  });
}
