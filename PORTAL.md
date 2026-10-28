# TerraWarden layer portal

A static, browser-based viewer for TerraWarden's existing Firebase `sharingV2` layers over a locally opened PDF. Designed for the `luker313/TerraWarden-Public` GitHub Pages site.

## Install on the existing GitHub Pages site

1. Copy **only `docs/portal/`** into the existing repository's `docs/` folder. Keep its existing home, support and privacy pages.
2. Keep GitHub Pages set to `main` and `/docs`. Commit the new portal folder. No build step is required.
3. Open the site's `/portal/` page.
4. Choose **API key**, paste the TerraWarden Firebase API key, and choose **Save key**. The key is stored in this browser's local storage and survives reloads. It is deliberately absent from this package and needs to be entered on each browser/device. **Remove saved key** removes this saved value; clearing the site's browser data also removes it.
5. In TerraWarden, the group owner sets its invitation permission to **Read-only** and shares the resulting invitation code or `terrawarden://join?code=…` link. Choose **Connect group**, enter a viewer name and the invitation, then **Join as viewer**.
6. Open the corresponding PDF. Supported WGS84 GeoPDF pages align automatically; other PDFs need WGS84 reference points.

The portal accepts viewer invitations only. Joining creates an anonymous browser identity and writes only that identity's own group membership. The member name appears in TerraWarden. Existing editor invitations must be replaced with a Read-only invitation; the portal does not change a group's invitation settings.

The database address is in `docs/portal/config.js`. **Never add an API key, service-account file, database secret, token or user data to that file or the repository.** The user-entered key is used in browser-to-Google requests. Its browser-side storage does not make it a secret from someone using that same browser.

The key supplied in chat comes from the private iOS application's configuration. Its Google Cloud API/application restrictions have not been tested here. If the browser receives an API-key restriction error, use a Firebase Web application key for the same project with the appropriate browser/API restrictions. Preserve the existing Realtime Database membership rules.

## What works

- Local PDF upload/drop, multi-page navigation, pan, wheel/pinch zoom and fit.
- Live Firebase REST streams for group pins/layers and route manifests, automatic token refresh/reconnection, and immutable route-chunk downloads.
- Shared pin details, route and drawn-line geometry, layer visibility, opacity, and feature search.
- Tombstones and privacy-removal filters, route-revision checks, and clearing shared features when group access ends.
- The app's exact TW mark and mountain PNG assets. The public site's deep green `#174d3a`, bright green `#00cc12`, paper and typography conventions are retained. No replacement logo is generated.
- A fictional Redridge demo with a bundled GeoPDF, pins, recorded route and drawn boundary. It does not contact Firebase.
- A dedicated Save key control, masked input, optional reveal, removal and persistent browser storage. Saving does not require a successful group connection.

## PDF alignment

The app's shared records contain geographic coordinates; PDF anchors and local display styles are not synced. The browser must align its own PDF.

Automatic alignment reads standard `/VP` + `/Measure` (`/Subtype /GEO`) objects, `/BBox`, `/LPTS`, `/GPTS` and `/Bounds`, including compressed PDF objects. It supports geographic WGS84 and projected WGS84 GCS metadata whose GPTS values are standard latitude/longitude. It uses a bilinear fit, supports rotated/cropped PDF pages and multiple map viewports, and clips overlays to the selected footprint. Regions with unsupported datums or unreliable control points are rejected rather than placed using guessed coordinates.

For other pages, expand **Map alignment**, select **Pick reference point**, click a known point and enter its **WGS84 decimal-degree latitude and longitude**. Southern latitudes are negative. Repeat for at least three well-spaced, non-collinear points. The manual model is an affine geographic approximation suited to local maps. Four or more points provide a fit residual; three points cannot independently establish accuracy. Projected grid lines over large areas may need a proper datum/projection workflow beyond this starter.

Manual reference points are saved in this browser against the PDF fingerprint and page. The PDF itself must be reopened after a reload. Save/load alignment JSON is available for the exact same PDF and page. Resetting **Use PDF alignment** removes manual points for that page.

This starter does not automatically transform GDA94, GDA2020, NZGD2000 or unknown datums. Use verified WGS84 reference points for those PDFs. It also does not implement legacy TerraGo `/LGIDict` metadata, encrypted PDFs, KMZ/KML import, editing or document-bound drawings that the native app keeps local. PDF size is capped at 100 MB. Styles absent from native shared data are assigned locally.

## Data and browser storage

- PDF bytes remain in memory in the browser. No PDF is uploaded to GitHub or Firebase.
- The entered API key, anonymous refresh credential, viewer name, last group and PDF reference points are stored on this site's browser origin. Access tokens stay in memory. Shared layer geometry is not deliberately written to local storage.
- The browser is a separate viewer identity from the phone. Clearing browser data loses that identity. The group owner can remove the old browser member in TerraWarden.
- **Disconnect** stops viewing and clears displayed shared data and the remembered group. It keeps the API key and identity for later use and does not delete the server-side membership. The owner manages that membership in the app.
- No analytics, external fonts, CDN scripts or server component are used. PDF dependencies are included locally.

## Local preview and validation

Serve `docs/` with a static web server, then open `/portal/`. For example, from the project root:

```sh
python3 -m http.server 8000 --directory docs
```

Open `http://localhost:8000/portal/`. ES modules and the PDF worker require HTTP(S); double-clicking `index.html` is not sufficient.

The automated tests need Node.js 22 or later and no package installation:

```sh
npm test
```

See `PORTAL-VALIDATION.md` for completed checks and the remaining live-service check.

## Included third-party libraries

- PDF.js / `pdfjs-dist` **5.6.205**, Apache-2.0: PDF rendering, worker, character maps, standard fonts and WASM codecs. License: `docs/portal/vendor/PDFJS-LICENSE`; individual font/codec licenses are retained in their folders.
- `pdf-lib` **1.17.1**, MIT: GeoPDF object/metadata inspection. License: `docs/portal/vendor/PDF-LIB-LICENSE.md`.

References: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Firebase REST database and streams](https://firebase.google.com/docs/reference/rest/database), [Firebase REST authentication](https://firebase.google.com/docs/reference/rest/auth), [PDF.js](https://mozilla.github.io/pdf.js/).
