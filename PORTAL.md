# TerraWarden layer portal

A static, browser-based portal for TerraWarden's existing Firebase `sharingV2` layers over a locally opened PDF. Designed for the `luker313/TerraWarden-Public` GitHub Pages site.

## Install on the existing GitHub Pages site

1. Copy **only `docs/portal/`** into the existing repository's `docs/` folder. Keep its existing home, support and privacy pages.
2. Keep GitHub Pages set to `main` and `/docs`. Commit the new portal folder. No build step is required.
3. Open the site's `/portal/` page.
4. Choose **API key**, paste the TerraWarden Firebase API key, and choose **Save key**. The key is stored in this browser's local storage and survives reloads. It is deliberately absent from this package and needs to be entered on each browser/device. **Remove saved key** removes this saved value; clearing the site's browser data also removes it.
5. In TerraWarden, the group owner shares an **edit** or **Read-only** invitation code or `terrawarden://join?code=…` link. Choose **Connect group**, enter a viewer name and the invitation, then **Connect group**.
6. Open the corresponding PDF. Supported GeoPDF pages align automatically, including WGS84, GDA94 / MGA, GDA2020 / MGA and NZGD2000 maps. Other PDFs need WGS84 reference points.

Viewer codes allow viewing. Edit codes allow creating layers, adding and moving pins, drawing lines, editing metadata, redrawing lines, and deleting features. Browser membership and Firebase rules determine the effective role. If this browser is already a viewer, entering an edit code offers **Rejoin with edit code** to replace only its own membership; other members and group data are retained. A live role downgrade disables editing. Edits require a connection, and unsaved drafts remain only in this tab.

The database address is in `docs/portal/config.js`. **Never add an API key, service-account file, database secret, token or user data to that file or the repository.** The user-entered key is used in browser-to-Google requests. Its browser-side storage does not make it a secret from someone using that same browser.

The key supplied in chat comes from the private iOS application's configuration. Its Google Cloud API/application restrictions have not been tested here. If the browser receives an API-key restriction error, use a Firebase Web application key for the same project with the appropriate browser/API restrictions. Preserve the existing Realtime Database membership rules.

## What works

- Local PDF upload/drop, multi-page navigation, pan, wheel/pinch zoom and fit.
- Automatic recognition of supported GeoPDF coordinate systems from EPSG metadata or ArcMap WKT, including reversed viewport bounds.
- Easting and northing as the main readout, labelled with the map grid, datum and EPSG code; WGS84 latitude/longitude stays secondary. Pin details use the same grid.
- Optional **Locate me** for live browser GPS, with a location dot, accuracy area, easting/northing and accuracy/age status. Location starts only when requested and is not sent to Firebase.
- Live Firebase REST streams for group pins/layers and route manifests, automatic token refresh/reconnection, and immutable route-chunk downloads.
- Shared pin details, route and drawn-line geometry, layer visibility, opacity, and feature search.
- Tombstones and privacy-removal filters, route-revision checks, and clearing shared features when group access ends.
- The app's exact TW mark and mountain PNG assets. The public site's deep green `#174d3a`, bright green `#00cc12`, paper and typography conventions are retained. No replacement logo is generated.
- A fictional Redridge demo with a bundled GeoPDF, pins, recorded route and drawn boundary. It does not contact Firebase.
- A dedicated Save key control, masked input, optional reveal, removal and persistent browser storage. Saving does not require a successful group connection.

## PDF alignment

The app's shared records contain geographic coordinates; PDF anchors and local display styles are not synced. The browser must align its own PDF.

Automatic alignment reads standard `/VP` + `/Measure` (`/Subtype /GEO`) objects, `/BBox`, `/LPTS`, `/GPTS` and `/Bounds`, including compressed PDF objects. It recognises WGS84, GDA94, GDA2020 and NZGD2000 geodetic metadata, including ArcMap WKT with no EPSG number. GPTS values are interpreted as geographic latitude/longitude in the declared source datum. ArcMap viewport bounds may be reversed in either axis; the signed LPTS-to-page mapping is preserved before the fitting domain is normalised. It uses a bilinear fit, supports rotated/cropped PDF pages and multiple map viewports, and clips overlays to the selected footprint. Regions with unsupported datums or unreliable control points are rejected rather than placed using guessed coordinates.

For other pages, expand **Map alignment**, select **Pick reference point**, click a known point and enter its **WGS84 decimal-degree latitude and longitude**. Southern latitudes are negative. Repeat for at least three well-spaced, non-collinear points. The manual model is an affine geographic approximation suited to local maps. Four or more points provide a fit residual; three points cannot independently establish accuracy. Projected grid lines over large areas may need a proper datum/projection workflow beyond this starter.

Manual reference points are saved in this browser against the PDF fingerprint and page. The PDF itself must be reopened after a reload. Save/load alignment JSON is available for the exact same PDF and page. Resetting **Use PDF alignment** removes manual points for that page.

GDA94 ↔ GDA2020 uses the official EPSG:8048 conformal seven-parameter transformation. GPS WGS84 ↔ GDA2020 uses EPSG:8450’s approximate 3 m relationship; local distortion and coordinate epochs are not modelled. NZGD2000 uses the native app’s navigation approximation, without a deformation model. This is phone/browser navigation, not survey control. Unknown datums still need verified WGS84 reference points. The viewer does not implement legacy TerraGo `/LGIDict` metadata, encrypted PDFs, KMZ/KML import or document-bound drawings that the native app keeps local. PDF size is capped at 100 MB. Styles absent from native shared data are assigned locally.

## Easting, northing and GPS

The coordinate card shows the current map cursor or selected pin. Choose **Locate me** (the crosshair in the map controls) to show live device GPS instead; approve the browser's location prompt if desired. Choose **Stop GPS location** to stop. GPS does not automatically restart after reloading.

A recognised projected map keeps its fixed grid and zone, even near a zone boundary. For a geographic-only map, a compatible grid is derived from its centre; without a recognised map grid, WGS84 UTM is chosen for the position. The readout always labels the datum, zone/projection and EPSG code. Readouts outside the supported projection domain show no grid value. A map cursor is labelled as a cursor, not GPS. Approximate datum relationships are described under Map alignment and in the grid label tooltip.

GPS accuracy is supplied by the browser. Stale fixes and off-page positions are identified; a failed or denied request never creates a fake position. GPS fixes remain in memory and are not shared or stored as pins.

## Data and browser storage

- PDF bytes remain in memory in the browser. No PDF is uploaded to GitHub or Firebase.
- The entered API key, anonymous refresh credential, viewer name, last group and PDF reference points are stored on this site's browser origin. Access tokens stay in memory. Shared layer geometry is not deliberately written to local storage.
- The browser is a separate viewer identity from the phone. Clearing browser data loses that identity. The group owner can remove the old browser member in TerraWarden.
- **Disconnect** stops viewing and clears displayed shared data and the remembered group. It keeps the API key and identity for later use and does not delete the server-side membership. The owner manages that membership in the app.
- No analytics, external fonts, CDN scripts or new server component are used. Editor operations use the existing Firebase rules, contribution records, immutable geometry chunks and conditional versions. PDF dependencies are included locally.

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

See `PORTAL-VALIDATION.md` for completed checks and the remaining live-service check. Projection and datum-transform reference values are independently checked against PROJ; public regression fixtures use synthetic maps, not uploaded customer/site PDFs.

## Included third-party libraries

- PDF.js / `pdfjs-dist` **5.6.205**, Apache-2.0: PDF rendering, worker, character maps, standard fonts and WASM codecs. License: `docs/portal/vendor/PDFJS-LICENSE`; individual font/codec licenses are retained in their folders.
- `pdf-lib` **1.17.1**, MIT: GeoPDF object/metadata inspection. License: `docs/portal/vendor/PDF-LIB-LICENSE.md`.

References: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Firebase REST database and streams](https://firebase.google.com/docs/reference/rest/database), [Firebase REST authentication](https://firebase.google.com/docs/reference/rest/auth), [PDF.js](https://mozilla.github.io/pdf.js/).


## Theme, labels and editing

Use the sun/moon button in the header to switch light/dark mode. The initial theme follows the system; a chosen theme is remembered. PDF artwork retains its original colours. Under Layers, **Pin text angle** rotates all pin labels around their own pin positions from -180° to +180°. The angle is saved in this browser; **Reset text angle** restores 0°.

Editors can use **New layer**, **Add pin** and **Draw line**. Click the aligned map to position a pin or add line vertices, then finish and save. Pins can also be positioned with the displayed grid's easting/northing or WGS84 latitude/longitude. Select a feature for Edit/Delete; drawn lines also offer Redraw line. Existing recorded routes support metadata edits but are not converted to drawn lines. Layer names are edited with the pencil beside the layer.

Writes register contribution and upload ownership records for the existing privacy/deletion service. Version checks reject stale changes rather than overwriting a newer device edit. Deletions are native-compatible tombstones. Published geometry is immutable; redrawing creates a replacement line and removes the original. Failed replacement cleanup is reported explicitly. The demo supports these controls in memory only, without contacting Firebase. The API key remains user-entered and excluded from source.

The sidebar scrolls as one column; sections cannot shrink below their contents, so the footer follows the final feature on desktop and mobile.
