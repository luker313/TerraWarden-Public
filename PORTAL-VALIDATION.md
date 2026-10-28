# Validation

Completed on 28 October 2026:

- Eleven Node tests passed: affine/bilinear coordinate transforms, offset and sheared maps, the antimeridian, degenerate reference points, SSE framing/CRLF, multipath updates/deletions, layer/pin tombstones and privacy removals, route revisions/chunks/segments/counts, invitation parsing, Swift date epoch, viewer-only membership creation, rejection of editor invitations, access-cancellation handling, API-key persistence/removal and blocked-storage reporting.
- JavaScript syntax checks passed for application modules.
- Browser demo opened its GeoPDF and aligned all eleven fictional features across three layers. Layer toggles and feature details were exercised.
- The PDF upload control opened a file from disk.
- The portal and demo worked when served from `/portal/`, including local module, worker, font, artwork and PDF paths.
- A synthetic test API key was saved through the UI, retained through a page reload, and removed. No real key was entered for this browser test and no Firebase account/group was created for it.
- The demo PDF was rendered with Poppler and inspected, and the browser rendering was inspected.
- Original TW mark matches the existing public site byte-for-byte; mountain artwork matches the app resource byte-for-byte.
- The delivered folder and ZIP were scanned for the actual Firebase API key. The key is excluded from all delivered files.

Live Firebase synchronization has not been exercised against a real group. End-to-end verification still requires a current **Read-only** invitation, the entered API key to be allowed for browser requests, and the existing Firebase service to be available. Unit tests mock the service; they do not verify the deployed Firebase rules. Mobile layouts and pinch handling are implemented but have not been verified on a physical device.


## Automatic grid alignment and GPS update

- 24 Node tests pass, retaining the original 11 checks and adding ArcMap WKT-only detection, reversed X/Y viewport bounds, compressed PDF objects, rotated/cropped pages, unsupported/conflicting datum rejection, EPSG grid labels, UTM zone exceptions, grid readouts, GPS opt-in/stop/denial/timeout handling and accuracy-ring geometry.
- MGA94, MGA2020, NZTM2000 and northern/southern UTM projection outputs agree with independent PROJ reference values within 0.1 mm. This is a numerical projection check, not a statement of GPS or datum accuracy.
- The ICSM ALIC example verifies the seven-parameter GDA94–GDA2020 conversion and its inverse against PROJ.
- The supplied ArcMap PDF was tested locally. Its GDA94 / MGA Zone 50 metadata is recognised without manual points; all four control points round-trip within 0.0001 PDF points. Browser upload detects “GDA94 GeoPDF aligned” and displays the EPSG:28350 easting/northing readout.
- The uploaded PDF and its actual control-point coordinates are excluded from the repository. Published regression PDF fixtures are synthetic and generated in memory.
- Live device GPS is implemented and tested with a mock location provider. Physical-device GPS accuracy and the browser permission flow have not been exercised here. Existing live Firebase verification limitations still apply.


## Theme, labels, layout and editor update

- 28 automated tests pass, including editor creation/movement, stale-edit rejection, viewer rejection, immutable line metadata, label pivot/zoom invariants and preference persistence.
- Isolated Firebase Database/Auth emulators with the current private repository rules accepted layer/pin/line creation, pin movement, line edits/redrawing, deletion tombstones and contribution records, and rejected viewer writes and writes after a role downgrade. Production database rules were not changed.
- Browser checks created a demo pin and line, verified a saved 45-degree label angle after reload, inspected dark mode, and measured the footer below the feature list on desktop and at a 393-pixel mobile viewport. Physical Safari/device checks remain outside this environment.

## Theme contrast and PDF sharpness fixes

- 31 automated tests pass. New checks cover device-resolution rendering at 1200% zoom, page-edge clipping, bounded canvas memory for large maps/screens, and cancellation so an old page cannot replace the current image.
- Pin details, edit dialogs, errors, hover states and drop feedback use theme colours. Checked text in the pin details/editor/readout/footer exceeds 4.5:1 contrast in both themes; the lowest sampled ratio was 5.01:1 in light mode and 5.78:1 in dark mode.
- At mobile CSS viewport widths of 320, 393 and 430 pixels, the theme SVG is centred to within 0.01 pixels and the header retains at least a 10-pixel gap after the wordmark. Pin panels follow the active theme.
- The PDF renderer redraws the visible region after zooming/panning at the display's pixel density, with a 6-million-pixel/4096-pixel-side limit. The base image remains visible while a new crop renders. Superseded canvases are cancelled and released.
- Browser checks verified detailed rendering with the demo at 584% and the supplied ArcMap PDF at 251%, including panning. The latter's GDA94/MGA50 automatic alignment remains intact. Uploaded maps are excluded from the public code.
- Browser checks use Chrome with mobile CSS viewports; physical iOS Safari and device GPS remain untested.
- The map viewport clips transformed content without becoming a scroll container, so focusing zoom tools or off-screen features cannot scroll the floating controls or pin panel out of position.

## Web Portal texture, GeoPDF export and GPS following

- The portal and public navigation use **Web Portal**; the repository and `/portal/` URL are unchanged. The README now covers the portal, support/privacy pages, permissions, local storage, deployment and dependencies.
- A local 20 KB vector contour texture is applied to the header, sidebar, cards and dialogs in light/dark mode. PDF artwork is not textured. Browser layouts at 320, 393 and 430 CSS pixels retain header spacing and the footer below all features.
- 39 Node tests pass, including selected-layer/search export filtering, original image and vector-content byte preservation, original PDF layer visibility, a single selected page, selected geospatial viewport, manual WGS84 alignment, CropBox/rotation/UserUnit, rotated label anchoring, route clipping and cancellation.
- A demo export was rendered independently with Poppler and inspected. It contains the six selected drill-collar pins and two routes/lines, with the observation layer excluded, rotated labels and 65% overlay opacity.
- An export of the supplied ArcMap map retained its original `/LPTS`, `/GPTS`, `/Bounds` and `/BBox` exactly. Independent pypdf checks confirmed the original 30 image payloads and a Māori/Greek pin label were retained. This uploaded map and its export are excluded from the public repository.
- Browser checks generated the GeoPDF and exposed the download link. The cloud browser's URL policy blocks opening or collecting `blob:` downloads; exported files were instead validated through the same exporter locally. Physical Safari/Avenza import and device GPS are not claimed as tested.
- A local simulated browser GPS provider exercised successive moving fixes, zoom while locked, pointer-drag unlock, fixes while unlocked, resume, off-page handling and stop. On-page fixes stayed within 0.001 CSS pixels of the camera centre; off-page fixes preserved the last useful view. The simulation harness is not published.
- The real Firebase API key remains excluded from public files; backend rules and permissions are unchanged.
