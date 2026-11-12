# Numerical terrain, mission history, and provenance

## Current coverage

The Terrain Explorer uses the global MOLA Mission Experiment Gridded Data
Record (MEGDR), 4 pixels per degree (`MEGT90N000CB.IMG`) and its companion
areoid-radius grid (`MEGA90N000CB.IMG`). These are real numerical PDS files,
not samples extracted from the MOLA shaded-relief image.

- Dataset: `MGS-M-MOLA-5-MEGDR-L3-V1.0`, product version 2.0.
- Archive: [PDS Geosciences Node MOLA MEGDR archive](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html).
- Topography product: [MEGT90N000CB.IMG](https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg004/megt90n000cb.img).
- Areoid-radius product: [MEGA90N000CB.IMG](https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg004/mega90n000cb.img).
- Format: 1440 columns × 720 rows, signed 16-bit big-endian integers, metres, 0.25° cell spacing.
- Nominal horizontal spacing: 14.818 km at the equator; east-west spacing decreases with latitude.
- Horizontal coordinates: IAU 2000 Mars, east-positive longitude, planetocentric latitude; cell values are at cell centres. The viewer's ellipsoid/planetographic latitude is converted before raster lookup.
- Topography vertical reference: GMM3 areoid, Goddard Mars gravity model `mgm1025`, degree and order 50.

PDS describes MEGT values as median observed topography in each 0.25° bin;
cells without observations have interpolated values. The product label does
not define a no-data sentinel. Therefore these grids are treated as globally
populated, and the interface explicitly identifies the source-filled cells
as interpolation rather than claiming every cell is a direct altimeter
observation. Raw zero is retained as a valid elevation. The companion areoid
grid stores radius relative to 3,396,000 m; the decoder restores this offset
before reconstructing radial surface positions.

The current files were retrieved from the maintained PDS4 bundle on
2026-10-16 and are bundled as:

- `data/mola-meg004-topography.img`
- `data/mola-meg004-areoid-radius-offset.img`

The 4.1 MB binary bundle preserves the original PDS samples. The repository
does not redistribute complete higher-resolution global products. Compact
regional patches are documented below. PDS identifies the source as public
NASA planetary science data; retain NASA / MOLA Science Team / PDS
Geosciences Node attribution and consult the archive's current citation and
use guidance.

## Interactive regional 3D terrain

Terrain Explorer includes bundled 256 × 256 regional patches for Jezero
(Perseverance landing region), Gale (Curiosity), Gusev (Spirit), Meridiani
Planum (Opportunity), Elysium Planitia (InSight), Chryse Planitia (Viking 1),
Utopia Planitia (Viking 2), Vastitas Borealis (Phoenix), Olympus Mons, and
Valles Marineris. These are curated site/landmark regions, not rover traverse
tracks. The app does not imply that a rover crossed every displayed part of
a patch.

Patches are extracted from the MOLA MEGDR 128 pixels/degree collection in the
same PDS bundle. Each source tile is 0.00781° per cell (nominally 463 m at the
equator), signed 16-bit big-endian metres, relative to the GMM3 areoid.
Regional files contain the centered raster samples only; source tile,
coordinates, reference, and attribution are recorded in
`data/terrain-regions/manifest.json`. Patches are generated reproducibly with
`node scripts/build-terrain-regions.cjs` using HTTP byte ranges against
[the maintained PDS MOLA archive](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html).
They cover roughly 118 × 118 km around each preset. The viewer can display a
centered 25, 50, or 100 km square and rotates with mouse/touch drag, zooms with
the wheel, and supports keyboard arrow keys and `+` / `-`.

The 3D view is a mesh of gridded elevations, with 3× vertical exaggeration for
visibility; it is not a photorealistic surface, imagery texture, or a
rover-scale DEM. MOLA's 128-pixel/degree collection includes archive-
interpolated cells and has observation gaps, particularly near the equator.
Terrain Explorer's custom patch preview falls back to the bundled
4-pixel/degree grid (~14.8 km at the equator) when its selected coordinates
are outside these ten patches; it identifies that coarser source and does not
claim extra detail from mesh interpolation. Terrain Explorer now ends at the
interactive 3D regional surface; coordinate-based route profiles and the
subsequent global route-analysis tools are not part of that interface.

## MarsWalk regional surface

MarsWalk uses the same ten 128-pixel/degree patch binaries, but not Terrain
Explorer's 2D-canvas mesh renderer. It builds a separate Cesium triangular
mesh from the full 256 × 256 DEM samples and hides the global globe while the
local surface scene is active. The patch elevation samples drive the 3D mesh,
route terrain samples, and drone's terrain-relative height. The mesh includes
Mars curvature across the local 118 km square. A separate
`MOLA_THEMIS_blend` image is streamed from the USGS WMS and draped over the
mesh in simple-cylindrical Mars coordinates. The blend combines colorized
MOLA 128-pixel/degree relief with the THEMIS IR Day global mosaic (100 m/pixel
nominal). Above 88° latitude the blend uses 64-pixel/degree MOLA relief.
THEMIS is semi-controlled and may not align perfectly with the mesh; the
workspace discloses this. MarsWalk requests imagery only for patches fully
within 88° latitude. A failed optional image request is reported and falls
back to elevation coloring. Transparent or blank image responses are also
rejected rather than reported as loaded; route terrain remains the bundled
MOLA DEM.
The imagery is not HiRISE and does not increase DEM resolution.

MarsWalk requires one selected regional patch. Its planner rejects endpoints
or corridor/trajectory samples outside that patch and never substitutes the
global 4-pixel/degree grid as terrain. The bundled regional files contain no
`-32768` samples; an input patch containing that sentinel is explicitly
rejected. The global 4-pixel/degree MOLA pair is loaded only to obtain a
coarse areoid-radius datum adjustment for regional elevation-to-ellipsoid
conversion. Regional route clearance and geometry remain based on the
128-pixel/degree elevation samples.

The MarsWalk texture source is the [USGS Planetary Maps WMS](https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/mars/mars_simp_cyl.map&service=WMS&request=GetCapabilities),
layer `MOLA_THEMIS_blend`. The service advertises MOLA relief blended with
the THEMIS IR Day 100 m/pixel global mosaic; the THEMIS imagery is
semi-controlled, so it may not perfectly align with MOLA relief. MarsWalk
requests one bounded 1180 × 1180 image per regional patch and does not treat
the image as elevation data. The global Viking MDIM 2.1 basemap is separately
documented by Esri at 231 m/pixel native equatorial resolution and is not
used as MarsWalk's local texture.

HiRISE DTMs are a possible future upgrade, not a current MarsWalk terrain
source. The
[USGS HiRISE DTM documentation](https://stac.astrogeology.usgs.gov/docs/data/mars/hirise_dtms/)
describes stereo footprints posted at 1–2 m with areoid-referenced heights,
and often companion orthoimages. The [NASA/USGS cloud distribution](https://registry.opendata.aws/nasa-usgs-mars-hirise-dtms/)
provides COG assets and STAC metadata, but products have sparse coverage,
multiple projections, and scale/offset metadata that need explicit handling.
The app does not stream those assets. CTX and HRSC products are likewise not
bundled or dynamically used; their footprints and product-level reference
metadata must be validated before advertising them as route coverage.

## Sampling and slope methods

`science-data.js` decodes the two rasters as big-endian signed integers.
Point samples use bilinear interpolation between cell-centre values, with
longitude wrapped at 0°/360° and raster rows clamped at the poles. The return
object includes the numeric value, dataset and product version, units,
coordinate and vertical references, sample method, source links, resolution,
and quality note. The app loads the local static files lazily, applies the
existing 10-second request deadline, and caches the decoded grid in memory for
the current page session.

Latitude conversion uses the Mars reference ellipsoid axes already used by
the globe (3,396,190 m equatorial; 3,376,200 m polar):

`tan(planetocentric latitude) = (polar radius / equatorial radius)² × tan(planetographic latitude)`

Local slope uses central differences one grid cell east/west and north/south.
Horizontal runs use a spherical Mars mean radius of 3,389,500 m, with
east-west distance multiplied by `cos(latitude)`. Slope is
`atan(sqrt((dz/dx)² + (dz/dy)²))`; percent grade is `100 × gradient`.
This is a coarse-grid derivative, not a measurement of a rover's immediate
surface or wheel hazards.

Profile distances use great-circle interpolation on a sphere with mean Mars
radius 3,389.5 km. The sample interval is 15–150 km, default 30 km, and the
analysis is capped at 5,000 samples. A finer interval than source resolution
only interpolates the grid and does not create independent observations.
Route distance is a reference-surface geodesic, not odometer distance or
wheel travel. Profile slope is the grade between adjacent sampled points.
Summed ascent/descent and maximum slope are sparse-sample summaries.

## Route and traverse limitations

The globe no longer exposes custom route drawing/import, route profiles, or
the terrain curtain. MarsWalk's local route planner instead plans a journey
between selected coordinates against its loaded regional DEM; its route
generation and flight limitations are described in [MARSWALK.md](./MARSWALK.md).

No NASA Perseverance drive-coordinate-by-sol file is included. NASA's
[Perseverance location map](https://science.nasa.gov/mission/mars-2020-perseverance/location-map/)
shows its traverse, but no verified machine-readable ground-track data is
included in this application. MarsWalk's planned routes are not rover
traverses, and the app does not infer a rover's location from images. The
global MOLA slope assessment is descriptive and non-certifying; it must not
be used to assert rover safety.

## Mission metadata and provenance

The mission timeline is a locally maintained, static selection of major
NASA surface missions from Viking 1 (1976) through Perseverance. It is not a
complete Mars mission catalog and does not poll live mission status. Rows
separate landing date, last operational/contact date, and formal end date
where represented. Landing markers are reference coordinates, never rover
positions. Each selected mission links to an official NASA source; the NASA
[Mars mission timeline](https://science.nasa.gov/planetary-science/programs/mars-exploration/mission-timeline/)
is the general chronology reference. Update `missions` in
`science-data.js` only after checking mission-specific official sources.

Terrain point results retain the MOLA dataset identifier, product version,
source URLs, retrieval time, coordinate system, vertical datum, method, units,
and known limitations. Mission provenance identifies locally curated
metadata separately from live status. No point-specific uncertainty value is
invented where the source does not provide one.

## Build, troubleshooting, and validation

The raster files are static assets served by the local Node server and copied
to `dist/` by `npm run build`; static hosts must preserve both `.img` files
under `data/`. The initial globe does not wait for terrain. If sampling is
unavailable, check the browser Network panel for the two static raster
requests and ensure the site is served from its root path. The app has no
persistent raster cache: a page reload re-reads the bundled data. Cesium and
remote basemap/imagery services still require network access, so the whole
application is not offline.

Run `npm test` for raster decoding, coordinate conversion, slope, route
sampling, GeoJSON validation, timeline validation, module wiring, and server
asset checks. These tests validate algorithms and packaging; they do not
certify the accuracy of a rover route, local slope, or terrain hazard.
