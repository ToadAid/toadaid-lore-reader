// Read-only packaged Pond Archive runtime.  Unlike desktop/main.mjs, this file
// has no canonical-sync, settings, preload, dialog, or IPC authority.
import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { startReaderHost } from './static-reader-host.mjs';
import { classifyNavigation } from './navigation-policy.mjs';
import { establishSingleInstance } from './single-instance.mjs';

let mainWindow = null;
let readerHost = null;

async function bootstrap() {
  // app.getAppPath() is resources/app in the packaged runtime: never a source checkout.
  readerHost = await startReaderHost({ distRoot: join(app.getAppPath(), 'dist') });
  mainWindow = new BrowserWindow({
    width: 1180, height: 800, title: 'The Pond Archive', backgroundColor: '#0d1210',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  installNavigationPolicy(mainWindow, readerHost.origin);
  await mainWindow.loadURL(readerHost.origin);
}

export function installNavigationPolicy(window, origin) {
  window.webContents.on('will-navigate', (event, url) => {
    const decision = classifyNavigation(origin, url);
    if (decision === 'allow') return;
    event.preventDefault();
    if (decision === 'external' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (classifyNavigation(origin, url) === 'external' && /^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

const ownsDesktopAuthority = establishSingleInstance({ app, getWindow: () => mainWindow });
if (ownsDesktopAuthority) {
  app.whenReady().then(bootstrap).catch((error) => { console.error('Packaged Pond Archive failed to start:', error?.message || error); process.exitCode = 1; });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { if (readerHost) readerHost.server.close(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) bootstrap(); });
}
