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
