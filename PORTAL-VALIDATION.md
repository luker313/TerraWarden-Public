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
