# Mobile PWA real-device acceptance

Structural readiness is provided by the governed public PWA build: a verified,
base-aware static Reader generation is installable and cached as a same-origin
offline archive. It does not claim freshness while disconnected.

Public URL: `https://toadaid.github.io/toadaid-lore-reader/`

PWA IMPLEMENTATION: COMPLETE

MOBILE STRUCTURAL READINESS: COMPLETE

REAL DEVICE ACCEPTANCE: PENDING

IOS REAL DEVICE DOGFOOD: PENDING

ANDROID REAL DEVICE DOGFOOD: PENDING

TABLET REAL DEVICE DOGFOOD: PENDING

WINDOWS LIVE DOGFOOD: PENDING

MACOS LIVE DOGFOOD: PENDING

## iOS / iPadOS Safari

1. Open the public Reader online in Safari; verify the cover, `Verified canonical archive`, and its canonical snapshot prefix.
2. Use Share → Add to Home Screen; confirm the installed name is Pond Archive (or the platform equivalent), then launch it.
3. Verify standalone presentation, Chronicle, Bookmarks, several records, and return to the cover.
4. Close the app, enable airplane mode, and relaunch from the home-screen icon.
5. Confirm cover, Chronicle, Bookmarks, local art/layout, and multiple record pages not opened before disconnect remain readable.
6. External X/YouTube/media failure offline is an EXPECTED EXTERNAL-MEDIA LIMITATION; core lore text and navigation must still work.
7. Reconnect and relaunch; record the result.

## Android Chrome / Chromium

1. Open the public Reader online; verify the cover and canonical snapshot.
2. Choose Install app or Add to Home screen, launch Pond Archive, and verify standalone presentation.
3. Verify Chronicle, Bookmarks, and several records; close the app, disconnect, and relaunch offline.
4. Verify cover, Chronicle, Bookmarks, local art/layout, and multiple record pages not individually visited before disconnect.
5. Treat unavailable external media offline as EXPECTED EXTERNAL-MEDIA LIMITATION; reconnect, relaunch, and record the result.

## Visual checks

Inspect portrait phone, landscape phone if practical, and tablet portrait/landscape where available. Confirm no horizontal overflow, clipped title, inaccessible Enter the Archive control, unreadable snapshot or bottom notes, overlap, impractical touch targets, or unreadable Chronicle, Bookmarks, and records. This ceremony—not source inspection—establishes real-device visual acceptance.
