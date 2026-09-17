# 7. Photo Previews (16 Sep 2026)

## Why

Opening a photo downloaded the **full 5 MB camera original**, and the viewer also **preloaded the next
original**, so each swipe could cost two 5 MB downloads over a 24.5 Mbit/s uplink. A phone screen
(1080–1440 px wide) can't show more than ~1600 px anyway. A 12 MP original is 4000+ px wide.

## How previews work (explained before building)
- The **original is uploaded and stored untouched**, always.
- The server derives smaller copies with sharp and caches them:

| Copy | Size | Used for |
|---|---|---|
| Thumbnail | 400 px, ~15 KB | Grid |
| **Preview** (new) | ~1600 px WebP, ~150–450 KB | Full-screen viewer |
| Original | e.g. 5–12 MB | Download, deep zoom |

## Question round

| Question | Options | Chosen |
|---|---|---|
| Preview size | **1600 px WebP** / 2048 px / 1280 px | 1600 px WebP |
| Full quality | **Auto-load on zoom + Download** / "View original" button / Download only | Auto on zoom |
| Existing 271 photos | **On first view** / generate all now | On first view (later reversed, see below) |
| Parallel uploads | **4** / 3 / keep 2 | 4 |

## Build 1: previews + 4 parallel uploads (`40de129`)

- **Backend:** the thumbnailer renders two variants; `GET /api/files/:id/preview`; JPEG/PNG/WebP/AVIF/TIFF/HEIC get previews, GIF (animation) and SVG don't.
- **Rule** (identical in backend and frontend): use the preview when the photo is > 1 MB or a format browsers can't show (TIFF/HEIC).
- **Viewer:** shows the preview; preloads the *next preview*; on pinch-zoom (`visualViewport.scale > 1.05`) it loads the original in the background and swaps it in without blanking; if a preview fails, it falls back to the original.
- **Uploads:** 4 at a time.

### Verification
| Check | Result |
|---|---|
| Backend tests | 52 passing (2 new) |
| Headless browser, real photos | Viewer loaded `/preview` **244 KB instead of 5.0 MB** (~21× smaller), upright (EXIF applied); next photo preloaded as **121 KB** |
| Zoom swap | Loaded the original (5 MB, 3072×4096) once and swapped it in |
| Full browser suite | Passed after fixing a test (below) |

### Issues
| Issue | Cause | Fix |
|---|---|---|
| Headless Chrome ignored a synthesized pinch (`scale` stayed 1) | Headless doesn't apply `Input.synthesizePinchGesture` to the visual viewport | Tested the logic by overriding `visualViewport.scale` and dispatching the same `resize` event; flagged for a real-finger check |
| E2E "keyboard navigation" step timed out | With 4 parallel uploads, finish order changed; the test assumed the photo had a next neighbour, but it was 6/6 | Test steps towards whichever neighbour exists |
| `tsconfig.tsbuildinfo` appeared | Side effect of an extra `tsc -b` check | Deleted, not committed |
| `sv restart` failed in Debian during deploy | Instructions used `$PREFIX`, which is empty in Debian | Full path to `sv` and `SVDIR`; recorded for future deploys |

Deployed 17:20; both addresses served the new bundle.

## "It still takes a while to open a photo": measured on the live domain

A temporary owner session and a temporary folder were used, both deleted afterwards.

| | Cloudflare | Tailscale |
|---|---|---|
| **First open** (phone generates the preview) | **~2.0 s**, of which 1.2–1.9 s is generation | slower |
| Second open (cached preview) | 0.6–0.8 s | 0.7–1.4 s |
| Grid thumbnail (5 KB) | 0.48 s | 1.12 s |
| 4 MB original (zoom/download) | 3.15 s | 6.20 s |
| 12 MB original | 7.26 s | 12.32 s |
| Upload 4.2 MB | 2.84–2.93 s (~12 Mbit/s) | 4.67–5.53 s (6–7.5 Mbit/s) |
| Upload 4.2 MB, localhost | 0.25 s (142 Mbit/s) | |
| 4 uploads at once, Cloudflare | 11.7 s total, 12 Mbit/s combined (no gain over 1; the uplink is the limit in this test) | |

**Root cause:** 343 of 356 photos had never been opened, so **every first open waited for preview
generation**, and the viewer generated the *next* preview at the same time. About **0.5 s per request**
is the mobile link's latency floor.

### Could generation be made faster? (benchmark on two real photos)
| Setting | 4.2 MB photo | 11.6 MB photo |
|---|---|---|
| Current (WebP q80, 1 thread) | 1.88 s | 1.34 s |
| WebP effort 1 | 1.87 s | 1.02 s |
| WebP, 4 threads | 2.08 s (slower) | 2.79 s (slower) |
| JPEG mozjpeg | 1.66 s | 1.21 s |
| JPEG plain | 1.27 s | 0.84 s |
| Decode + resize only | 1.45 s | 0.55 s |

**Conclusion:** decoding dominates; encoder settings save ≤ 0.5 s; extra threads are slower under proot.
**Settings won't fix it: pre-generating will.** The earlier "on first view" advice was reversed, based on
this data.

## Build 2: background generation + instant placeholder (`08a830a`)

- **Background job at startup:** fills in every missing thumbnail and preview, **newest photos first**,
  **one at a time, only while nothing else is rendering**, so a photo someone opens never waits behind it.
  It skips files deleted or replaced meanwhile.
- **Placeholder:** while the preview downloads, the viewer shows the grid thumbnail (already in the
  browser cache), lightly blurred.

### Issues
| Issue | Fix |
|---|---|
| The first placeholder (`blur-2xl`, full-screen cover) looked like a colour wash, not the photo | A centred square thumbnail at `blur-[2px]`: recognisable immediately |
| Two background checks were lost when the Claude session was interrupted | Re-checked state directly from logs and files |

### Verification
- 53 backend tests (new: generation fills gaps, skips deleted files, second run does nothing); full browser suite passing.
- Throwaway server: startup generated 6 images in 8 s; on a throttled 300 kbit/s link the blurred photo appeared immediately and the sharp version ~9 s later.

### After deploying (17:44)
- `Generated 307 missing thumbnails/previews in 446s` (320/356 photos covered; the other 36 were HEIC, see [chapter 8](08-media-and-reliability.md)).

| Opening a photo (live) | Before previews (original) | After build 1 (first open) | **After build 2** |
|---|---|---|---|
| Cloudflare, 4–5 MB photo | 3.15 s | ~2.0 s | **0.69 s** (0.57–0.88) |
| Cloudflare, 12 MB photo | 7.26 s | ~2.0 s | **0.59 s** (0.53–0.65) |
| Tailscale Funnel | 6.20 s (4 MB) / 12.32 s (12 MB) | slower | 1.06–1.16 s |
| Data per photo | 4–12 MB | 0.11–0.48 MB | 0.11–0.48 MB |
