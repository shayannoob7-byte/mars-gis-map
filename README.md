# Mars GIS Map

An interactive Mars globe and solar-system explorer built with vanilla HTML, CSS, JavaScript, and CesiumJS.

## Features

- Sharper HiDPI globe rendering, subtle Viking mosaic color refinement, and a sparse illustrative star field. Optional camera-relative shading adds depth at globe scale, fades at close range, and stays disabled for MOLA; it does not represent actual Martian sunlight or add terrain relief.
- DSN Now communications dashboard with Goldstone, Madrid, and Canberra antennas, spacecraft targets, uplink/downlink activity, reported data rates, and a Mars-mission filter. Source timestamps and stale-data warnings distinguish live retrieval from current observations.
- Open any location overview and select **Images & videos of [location]** to search NASA's library for that place. Each location starts a fresh search with both media types and the first results page. Filter images/videos, browse result pages, and view images or play videos with NASA credits and source links. The library is accessed from location overviews rather than the command center.
- Mars imagery with Viking and MOLA basemaps and selected HiRISE overlays.
- Landing-site markers, geographic overviews, and quick camera jumps.
- Two-point distance measurement calibrated for Mars.
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
- `scripts/build-preview.cjs`: reproducible standalone preview generator.
- `tests/`: dependency-free regression tests.
- `solar-system.js`: orbital model, solar-system rendering, and transitions.
- `data/`: archived NASA weather response and source notes.

## Data limitations

InSight observations are historical station measurements, not live weather or measurements for arbitrary points on Mars. The Curiosity REMS tab reads NASA's public outreach feed, which publishes delayed observations rather than live readings. Temperature fields are daily minima/maxima; pressure is a daily average. Missing or malformed fields are shown as unavailable. The feed omits wind speed and humidity. Solar-system distances use an approximate NASA/JPL orbital model; planet display sizes are enlarged for visibility. Imagery availability depends on upstream services.

See [HiRISE notes](HIRISE.md) and [weather data notes](data/README.md) for further details.

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

Build the preview after changing markup, styles, or scripts. `preview:check` fails if the local preview is missing or stale; the generated preview remains git-ignored. Tests cover request failures, timeouts (including stalled bodies), cancellation and retry, weather validation and ordering, UI wiring, preview generation, and orbital-model boundaries. They do not certify upstream imagery availability or ephemeris accuracy.

All weather and imagery-capability requests have a 10-second deadline. Failed capabilities requests use embedded coverage limits; failed weather requests retain saved observations. Curiosity caches pass the same validation as network records, are sorted newest-first, and show observation age even offline. The six-hour refresh interval is checked when opening the Curiosity panel; Refresh feed requests an immediate update.

## Coordinates and measurement scope

Longitudes are east-positive, displayed from −180° to 180°. Opportunity’s landing reference is 1.95°S, 5.53°W (354.47°E), from [NASA’s Eagle Crater reference](https://science.nasa.gov/resource/rovers-landing-hardware-at-eagle-crater-mars/). Markers are reference locations, not live rover positions. Distances use the configured Mars ellipsoid or the explicitly labeled mean-radius sphere. There is no terrain elevation or slope analysis.
