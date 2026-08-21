// Native Electron single-instance authority for the desktop operator shell.

export function establishSingleInstance({ app, getWindow }) {
  const ownsDesktopAuthority = app.requestSingleInstanceLock();
  if (!ownsDesktopAuthority) {
    app.quit();
    return false;
  }

  app.on('second-instance', () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  return true;
}
