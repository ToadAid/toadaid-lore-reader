// Desktop navigation policy (Stage 2A-DESK1 §23/§25).
//
// Pure classification of a navigation target relative to the trusted Reader
// window's own loopback origin. The Electron main process uses this in
// `will-navigate` / `setWindowOpenHandler` to keep the trusted Reader inside the
// desktop window and route external links to the OS browser, while refusing
// privileged/unsafe schemes.
//
// Pure JS, no Electron dependency, so it is unit-tested without a graphical
// Electron session (§31 tests #20/#21/#22).

/**
 * @param {string} appOrigin The trusted Reader window's own origin, e.g.
 *   `http://127.0.0.1:54321`.
 * @param {string} url The navigation target URL to classify.
 * @returns {'allow'|'external'|'block'}
 *   - 'allow'    same-origin navigation inside the trusted Reader (a Reader route)
 *   - 'external' a safe http/https URL that should open in the OS browser
 *   - 'block'    a privileged/unsafe scheme that must not load
 */
export function classifyNavigation(appOrigin, url) {
  if (typeof url !== 'string' || url === '' || url === 'about:blank') return 'block';

  // Strip any leading whitespace; browsers tolerate it.
  const target = url.trim();

  // Privileged/unsafe schemes never load inside the trusted window (§25).
  const unsafe = /^(javascript|file|data|shell|vbscript|blob):/i;
  if (unsafe.test(target)) return 'block';

  // Same-origin (a Reader route like /chronicle/ or /record/<id>/) stays inside.
  // Match the exact appOrigin prefix, or a same-origin relative URL (no scheme).
  if (target === appOrigin || target.startsWith(`${appOrigin}/`)) return 'allow';
  if (/^[a-z]+:/i.test(target) === false) {
    // Relative URL (e.g. "/chronicle/", "../chronicle/"). Belongs to the Reader.
    return 'allow';
  }

  // Any other scheme that is not http/https is refused (defense in depth).
  if (!/^https?:\/\//i.test(target)) return 'block';

  // Safe external http/https link: leave the trusted window, open in OS browser.
  return 'external';
}

/** Safe schemes the desktop is allowed to hand to the OS browser (§25). */
export const EXTERNAL_SAFE_SCHEMES = new Set(['http:', 'https:']);