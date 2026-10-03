# Mars GIS Map

An interactive Mars globe and solar-system explorer built with vanilla HTML, CSS, JavaScript, and CesiumJS.

## Features

- Mars imagery with Viking and MOLA basemaps and selected HiRISE overlays.
- Landing-site markers, geographic overviews, and quick camera jumps.
- Two-point distance measurement calibrated for Mars.
- Archived NASA InSight weather observations, with source dates and location context.
- A solar-system view with approximate orbital positions and Sun–Earth–Mars distances.
- Animated transitions between Mars and the solar-system view, with reduced-motion support.

## Run

On Windows with Node.js installed, double-click `Open Mars Globe.cmd`. This starts a standalone local server at http://127.0.0.1:8765/ that continues running after Freebuff closes. After a computer restart, launch it again. Alternatively, serve this directory using any static web server. No build step is required. An internet connection is needed for Cesium and remote imagery services.

## Files

- `index.html`: application markup and controls.
- `style.css`: Mars-themed layout and styling.
- `app.js`: globe, imagery, measurements, locations, and weather.
- `solar-system.js`: orbital model, solar-system rendering, and transitions.
- `data/`: archived NASA weather response and source notes.

## Data limitations

InSight observations are historical station measurements, not live weather or measurements for arbitrary points on Mars. Solar-system distances use an approximate NASA/JPL orbital model; planet display sizes are enlarged for visibility. Imagery availability depends on upstream services.

See [HiRISE notes](HIRISE.md) and [weather data notes](data/README.md) for further details.
