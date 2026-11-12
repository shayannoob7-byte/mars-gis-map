# Mars GIS Map

An interactive Mars globe and solar-system explorer built with vanilla HTML, CSS, JavaScript, and CesiumJS.

## Features

- Sharper HiDPI globe rendering, subtle Viking mosaic color refinement, and a sparse illustrative star field. Optional camera-relative shading adds depth at globe scale, fades at close range, and stays disabled for MOLA; it does not represent actual Martian sunlight or add terrain relief.
- DSN Now communications dashboard with Goldstone, Madrid, and Canberra antennas, spacecraft targets, uplink/downlink activity, reported data rates, and a Mars-mission filter. Source timestamps and stale-data warnings distinguish live retrieval from current observations.
- Open any location overview and select **Images & videos of [location]** to search NASA's library for that place. Each location starts a fresh search with both media types and the first results page. Filter images/videos, browse result pages, and view images or play videos with NASA credits and source links. The library is accessed from location overviews rather than the command center.
- Mars imagery with Viking and MOLA basemaps and selected HiRISE overlays.
- Landing-site markers, geographic overviews, and quick camera jumps.
- Two-point distance measurement calibrated for Mars.
- Curated NASA surface-mission timeline from Viking 1 (1976) to current Perseverance mission metadata, with source links and landing-site camera jumps.
- Lazy-loaded, real global MOLA MEGDR numerical elevation data; point elevation and coarse local slope sampling with a provenance record.
- Interactive, mouse-rotatable 3D terrain patches for curated Mars mission landing regions and major landmarks, backed by 128-pixel/degree MOLA data; arbitrary coordinates use the coarser global MOLA grid.
- **MarsWalk**, a standalone terrain-aware surface flythrough workspace with arbitrary-coordinate entry, globe picking, curated regional endpoints, route preview, altitude-aware trajectory, and playback controls.
- Terrain Explorer keeps the interactive 3D regional surface and its MOLA provenance; the former coordinate-route/profile workflow has been removed.
- Mission provenance identifies source products and reference metadata for curated mission records.
- Archived NASA InSight weather observations, with source dates and location context.
- A separate **Latest Available Curiosity Weather** overview with dated observations (air/ground temperature, pressure, sky, UV, sun times) and a recent-sols table from NASA's public Curiosity weather feed.
- A solar-system view with approximate orbital positions and Sun–Earth–Mars distances.
- Animated transitions between Mars and the solar-system view, with reduced-motion support.

## Run

On Windows with Node.js installed, double-click `Open Mars Globe.cmd`. This starts a standalone local server at http://127.0.0.1:8765/ that continues running after Freebuff closes. After a computer restart, launch it again. Alternatively, serve this directory using any static web server. No build step is required. An internet connection is needed for Cesium and remote imagery services.

## Deploy to Vercel

Import this GitHub repository into Vercel with the repository root as the Root Directory. The checked-in `vercel.json` selects the Other framework preset, runs `npm run build`, and publishes `dist/`. No environment variables are required for the current public NASA feeds. The build copies only application assets and source notes; the local Node server is not deployed.

For a CLI deployment, sign in with `npx vercel login`, then run `npx vercel --prod` from the repository root. Run `npm run build` locally to inspect the output first.

## Files

- `index.html`: application markup and controls.
- `style.css`: Mars-themed layout and styling.
- `app.js`: globe, imagery, measurements, and locations.
- `weather.js`: InSight and Curiosity panels, caching, and observation status.
- `media-library.js`: NASA archive search and media viewer.
- `dsn-now.js`: DSN XML parsing, station cards, and visible-panel polling.
- `data-services.js`: shared request deadlines, cancellation, and observation validation.
- `science-data.js`: MOLA decoding, Mars coordinate conversion, terrain/profile calculations, GeoJSON validation, and curated mission metadata.
- `marswalk-planner.js`: geodesic corridor search, MOLA-based trajectory generation, clearance checks, flight modes, and curated MarsWalk endpoints.
- `marswalk-navigation.js`: patch-scaled camera limits, normalized zoom input, and shared playback-rate progress.
- `marswalk.js`: independent MarsWalk workspace, terrain navigation, surface endpoint markers, route visualization, camera ownership, and playback lifecycle.
- `terrain-model.js`: regional MOLA patch decoding, custom coarse-patch sampling, and interactive 3D surface mesh rendering.
- `science-explorer.js`: mission timeline, interactive regional terrain workflow, and mission provenance.
- `scripts/build-preview.cjs`: reproducible standalone preview generator.
- `tests/`: dependency-free regression tests.
- `solar-system.js`: orbital model, solar-system rendering, and transitions.
- `data/`: archived NASA weather response and source notes.
- `data/mola-meg004-*.img`: original MOLA MEGDR 4 pixels/degree terrain rasters.
- `data/terrain-regions/`: curated cropped MOLA MEGDR 128 pixels/degree terrain patches and source manifest.

MarsWalk uses bundled regional 128-pixel/degree MOLA patches, with the global
grid used for vertical-datum conversion, as described in
[terrain data and methods](TERRAIN-DATA.md). See the [MarsWalk methods and
limitations](MARSWALK.md) for its route cost function, altitude conventions,
camera playback, presets, and sampled-terrain verification boundaries.

## Data limitations

InSight observations are historical station measurements, not live weather or measurements for arbitrary points on Mars. The Curiosity REMS tab reads NASA's public outreach feed, which publishes delayed observations rather than live readings. Temperature fields are daily minima/maxima; pressure is a daily average. Missing or malformed fields are shown as unavailable. The feed omits wind speed and humidity. Solar-system distances use an approximate NASA/JPL orbital model; planet display sizes are enlarged for visibility. Imagery availability depends on upstream services.

Terrain analysis uses bundled NASA MOLA MEGDR numerical data (0.25° cells, about 14.8 km at the equator), not the MOLA color-relief image. The globe inspector reports point elevation and coarse slope; custom route drawing, route profiles, and the terrain curtain are no longer exposed in the interface. This grid is too coarse to resolve rover-scale hazards. MarsWalk plans its own terrain-aware journeys and does not represent them as rover traverses. The mission timeline is static, curated NASA metadata rather than a complete international catalog or live status feed.

MarsWalk checks its precomputed trajectory against the selected regional
MOLA patch and renders a displaced local terrain mesh. Routes outside that
patch are rejected. Its reported clearance is not a guarantee against real
terrain: the approximately 463 m grid cannot resolve small hazards and may
contain archive-interpolated cells. The main globe remains a reference
ellipsoid. MarsWalk is
for geospatial exploration and education, not operational flight planning.

See [HiRISE notes](HIRISE.md) and [weather data notes](data/README.md) for further details.
See [terrain data and methods](TERRAIN-DATA.md) for PDS identifiers, coordinate conventions, vertical reference, algorithms, provenance, export formats, and known gaps.

Curated regional terrain patches can be regenerated from the public NASA PDS MOLA archive with `node scripts/build-terrain-regions.cjs`.

## Development and verification

DSN Now uses NASA's public XML feed at `https://eyes.nasa.gov/dsn/data/dsn.xml` and optional spacecraft names from `https://eyes.nasa.gov/apps/dsn-now/config.xml`. Both allow browser requests without a key. This is the DSN Now website feed, not a versioned API contract. The panel polls every 15 seconds only while open and visible, with 10-second request deadlines. Closing cancels outstanding requests. Failed refreshes retain the last response with a warning; source timestamps over two minutes old are marked stale. Inactive signal rates and negative missing-value sentinels are not shown as current traffic. The Mars filter uses a maintained list of mission codes. See [NASA's DSN overview](https://www.nasa.gov/communicating-with-missions/dsn/).

The media library uses NASA's public `https://images-api.nasa.gov/search` and `/asset/{nasa_id}` endpoints directly from the browser, with no API key. See the [official NASA API documentation](https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf). It loads 12 results per page and resolves actual asset manifests for browser-friendly images and MP4 videos. Media is historical, not live; source links provide item-specific credits and alternate formats. Requests have a 10-second deadline. Closing the library cancels requests and stops video playback.

Use Node.js 18 or newer. No npm dependencies need installing.

```sh
npm test
npm run preview:build
npm run preview:check
```

In Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`. These commands also work directly without npm: `node --test`, `node scripts/build-preview.cjs`, and `node scripts/build-preview.cjs --check`.

Build the preview after changing markup, styles, or scripts. `preview:check` fails if the local preview is missing or stale; the generated preview remains git-ignored. Tests cover request failures, timeouts (including stalled bodies), cancellation and retry, weather validation and ordering, MOLA decoding and terrain calculations, GeoJSON and mission-record validation, UI wiring, preview generation, and orbital-model boundaries. They do not certify upstream imagery availability, rover route accuracy, or ephemeris accuracy.

All weather and imagery-capability requests have a 10-second deadline. Failed capabilities requests use embedded coverage limits; failed weather requests retain saved observations. Curiosity caches pass the same validation as network records, are sorted newest-first, and show observation age even offline. The six-hour refresh interval is checked when opening the Curiosity panel; Refresh feed requests an immediate update.

## Coordinates and measurement scope

Longitudes are east-positive, displayed from −180° to 180°; the MOLA grid wraps to 0°–360°. The globe uses Mars planetographic coordinates and converts to MOLA's planetocentric latitude for raster sampling. Opportunity’s landing reference is 1.95°S, 5.53°W (354.47°E), from [NASA’s Eagle Crater reference](https://science.nasa.gov/resource/rovers-landing-hardware-at-eagle-crater-mars/). Markers are reference locations, not live rover positions. Existing distance measurement uses the configured Mars ellipsoid or explicitly labeled mean-radius sphere. Terrain elevation and slope analysis are separate, low-resolution MOLA-derived calculations.
