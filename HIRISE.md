# HiRISE regional overlays

The globe streams three genuine NASA Mars Trek HiRISE mosaics. Select a region under **HiRISE Close-Up** to enable its overlay and fly to it. Opacity blends it with Viking or MOLA. Changing basemaps preserves the overlay; selecting Off removes it.

## Provenance

Source: [NASA Mars Trek tile services](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars). Imagery credit: NASA / JPL-Caltech / University of Arizona. Catalog, coverage bounds, PNG tile format, geographic matrix layout, and zoom limits verified on 2026-10-03.

The app does not hardcode tile coordinates. At run time it fetches each layer's `WMTSCapabilities.xml` (the service sends `Access-Control-Allow-Origin: *`), parses the `TileMatrixSet` identifier, the `WGS84BoundingBox`, and every `TileMatrix` level with its `MatrixWidth`/`MatrixHeight`, then validates every tile request against those matrix bounds before a URL is produced. Coordinates outside the published bounds yield a transparent tile instead of a request, so out-of-range requests never reach the server as 404s. The embedded constants in `app.js` match these documents and are used only when the capabilities fetch fails.

| Region | Product | Bounds: west, south, east, north (degrees) | Maximum tile level |
| --- | --- | --- | --- |
| Gale / Curiosity | curiosity_hirise_mosaic | 137.1224669, -4.9254743, 137.7298129, -4.2489588 | 16 |
| Gusev / Spirit | spirit_hirise_mosaic | 175.4278511, -14.6925026, 175.5858031, -14.5357546 | 17 |
| Meridiani / Opportunity | opportunity_hirise_mosaic | -5.5964391, -2.7513281, -4.9954112, -1.8994384 | 17 |

Capabilities documents:

- [Curiosity](https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/WMTSCapabilities.xml)
- [Spirit](https://trek.nasa.gov/tiles/Mars/EQ/spirit_hirise_mosaic/1.0.0/WMTSCapabilities.xml)
- [Opportunity](https://trek.nasa.gov/tiles/Mars/EQ/opportunity_hirise_mosaic/1.0.0/WMTSCapabilities.xml)

REST tile layout (the `TileMatrixSet` segment is read from the capabilities document; all four layers advertise `default028mm`):

`https://trek.nasa.gov/tiles/Mars/EQ/{product}/1.0.0/default/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`

The grid is equirectangular with `TopLeftCorner -180 90`, so `TileCol` grows eastward and `TileRow` grows southward. At level *z* the matrix is `2^(z+1) × 2^z` tiles. The services use 256-pixel tiles, two columns and one row at level zero, and a longitude/latitude grid. The provider uses the existing Mars ellipsoid and a GeographicTilingScheme, with its rectangle limited to the published coverage bounds. The base layer is inserted at index zero to keep HiRISE above it.

## CTX fallback for Gale Crater

Viewing a crater as a whole asks for coverage outside the narrow HiRISE strip, where strip-only requests would have no imagery. For Gale Crater the app therefore loads a second, wider layer *beneath* the HiRISE strip:

| Region | Product | Bounds: west, south, east, north (degrees) | Maximum tile level |
| --- | --- | --- | --- |
| Gale Crater (CTX) | Gale_CTX_BlockAdj_dd | 135.1842593, -6.5732988, 139.2413012, -2.8077809 | 12 |

Credit: NASA / JPL-Caltech / MSSS. The layer is inserted at index 1 — directly above the selected global basemap and below the HiRISE strip — so pixels outside the HiRISE rectangle resolve to CTX inside Gale and to the global basemap beyond Gale. Its bounds and zoom limits come from its own `WMTSCapabilities.xml` through the same validation path as HiRISE. Its failure is reported in the HiRISE status area without affecting the strip.

## Limits

- These are regional grayscale mosaics, not continuous global HiRISE coverage. Holes and seams can occur within their bounding rectangles.
- Pixels outside coverage display the CTX layer for Gale Crater, or the selected global basemap elsewhere.
- Tile coordinates outside the matrix bounds published in GetCapabilities are answered locally with a transparent tile; such requests are never sent, so they cannot produce 404 responses.
- These imagery overlays do not supply a terrain model. Existing distance calculations still exclude terrain relief.
- The supplied original Opportunity marker uses longitude -35.47 degrees. The NASA Opportunity mosaic is near -5.3 degrees; its new camera jump follows the published mosaic coverage independently of that original marker.
- Online NASA tile availability is required. Failures are reported in the HiRISE status area.
- The standalone preview embeds the same source CSS and JavaScript. Rebuild preview.html from index.html, style.css, and app.js after changing those sources.
