# TerraWarden Web Portal and support pages

The public website for **TerraWarden** and **TerraWarden Field**, including the
browser map portal, support information and privacy policy. Everything is a
static site served by GitHub Pages from `docs/`.

Developer: Luke Richards

Support and privacy contact: [luker313@icloud.com](mailto:luker313@icloud.com)

## Open the website

| Page | Live URL | Source |
| --- | --- | --- |
| Home | https://luker313.github.io/TerraWarden-Public/ | `docs/index.html` |
| Web Portal | https://luker313.github.io/TerraWarden-Public/portal/ | `docs/portal/` |
| Support | https://luker313.github.io/TerraWarden-Public/support/ | `docs/support/index.html` |
| Privacy policy | https://luker313.github.io/TerraWarden-Public/privacy/ | `docs/privacy/index.html` |

## Web Portal

Open a PDF map and connect a TerraWarden group to view shared pins, recorded
routes and drawn lines. A fictional **Explore demo** workspace is available
without connecting to Firebase.

- **View or contribute.** Read-only invitation codes allow viewing. Edit codes
  allow creating and editing shared pins, lines and layers, subject to the
  existing group permissions and Firebase rules.
- **Bring your own map.** PDF files are processed in this browser session.
  Supported GeoPDFs align automatically, including ArcMap GDA94/MGA maps.
  Other PDFs can be aligned using WGS84 reference points.
- **Navigate with GPS.** The GPS button starts location following after browser
  permission is granted. The camera follows fresh fixes and keeps the puck
  centred while zooming. Pan or centre another feature to unlock the view;
  press GPS to resume following. Press it while following to turn GPS off.
  Easting/northing, the coordinate system and GPS accuracy are displayed.
- **Export a GeoPDF.** Export the current complete PDF page with the currently
  visible layers, search results, overlay opacity and pin text angle. Original
  map images are kept at their native resolution; existing artwork and added
  pins/lines remain vector where supported. Export retains the selected GeoPDF
  georeferencing, or embeds the manual map alignment. UI controls, the texture
  and the temporary GPS puck are excluded. Align the map before exporting.
- **Make it comfortable.** Light/dark themes include a faint topographic UI
  texture. Theme and pin-text-angle preferences are remembered on this browser.
  The map redraws at the current zoom and display density for sharp viewing.

Use **API key** to enter the Firebase Web API key once and save it in this
browser. The real key is deliberately excluded from public source code. The
browser stores its own anonymous Firebase identity and remembers the last
group; clearing site data removes that identity and saved preferences.

PDF maps, manual alignment, downloads and the GPS readout are handled locally.
Shared edits go to the connected group's existing Firebase backend. This
repository does not include the private app source, backend credentials or
Firebase rules, and the portal does not change those rules.

See [PORTAL.md](PORTAL.md) for setup, supported formats, permission behaviour,
export details, dependencies and limitations. See
[PORTAL-VALIDATION.md](PORTAL-VALIDATION.md) for validation notes.

## Support and privacy pages

The support and privacy pages cover TerraWarden and TerraWarden Field,
including optional layer sharing, satellite imagery and self-service cloud
account deletion. Keep the supported app versions and deletion behaviour in
step with the released apps and deployed service. Retain the provider
disclosures and support contact when updating these pages.

No advertising or usage analytics are included. The Web Portal uses Firebase
only when a user connects a group; the fictional demo does not contact it.

## GitHub Pages setup and local development

In **Settings → Pages**, choose **Deploy from a branch**, select **main** and
**/docs**, and keep HTTPS enabled. No build command or server runtime is needed.
The Web Portal stays at `/portal/`.

Serve `docs/` with a local static HTTP server to preview the site. Use HTTPS or
localhost for real browser geolocation. Dependencies, fonts, workers and
branding are vendored in the repository; normal use does not require a CDN.

Run the automated checks with Node:

```sh
npm test
```

When changing browser assets, update their versioned references so existing
browsers receive the new files without clearing saved identities or settings.

## Licensing and scope

The original TerraWarden branding is retained. Third-party notices for PDF.js,
pdf-lib, fontkit and bundled fonts/codecs are in `docs/portal/vendor/`.
The native app source and private service configuration remain outside this
public repository.


### Remembered connections

The API key, last successful invitation, group and browser identity are saved locally. Connection/authentication failures and opening the demo do not erase the remembered connection. Use **Reconnect saved group** to retry; the server still checks membership and editing permissions. **Disconnect** explicitly forgets the group and invitation. **Remove saved key** forgets the API key.

The portal requests persistent storage when you save a key or join, where supported. This is best effort: Safari and a Home Screen installation can have separate data, and browser eviction or clearing site data can remove all saved settings. If the saved identity is missing, rejoin with a current invitation. Site updates keep the same storage keys.
