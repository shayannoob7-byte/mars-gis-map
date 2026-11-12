# MarsWalk

MarsWalk is a standalone local-surface flythrough in the Mars Globe Command
Center. It keeps the main Cesium viewer but, while a journey is previewed or
playing, replaces the global globe with a dedicated local 3D terrain mesh.
The globe remains available for endpoint picking before planning. The local
scene is not a zoomed globe and does not substitute the global DEM when a
route leaves supported coverage.

The browser modules are:

- `marswalk-planner.js`: deterministic corridor planning, sampling, clearance
  verification, and playback interpolation.
- `marswalk-terrain.js`: regional patch coordinates, bounded sampling,
  ellipsoid/areoid height conversion, and curved local mesh geometry.
- `marswalk.js`: workspace UI, Cesium primitive/entities, synchronized camera views,
  playback, and cleanup.

## Terrain actually used

The currently bundled MarsWalk surface is NASA MOLA MEGDR at 128
pixels/degree, cut into ten centered regional patches: Jezero, Gale, Gusev,
Meridiani, Elysium, Chryse, Utopia, Olympus Mons, Valles Marineris, and
Phoenix. The source tiles are MOLA MEGDR version 2.0 `MEGT*.IMG` products
from the [PDS Geosciences Node MOLA archive](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html).
The specific tile and direct product URL for each patch are in
[`data/terrain-regions/manifest.json`](./data/terrain-regions/manifest.json).
Attribution: NASA / MOLA Science Team / PDS Geosciences Node.

- Each patch is 256 × 256 signed 16-bit big-endian elevation samples in
  metres, centered on its named region and covering about 118 × 118 km.
- Nominal posting is 463 m at the equator; east-west spacing decreases with
  latitude. This is measured regional MOLA topography, but it is not HiRISE
  detail, rover-scale terrain, or a safety-grade DEM.
- The source grid is planetocentric, east-positive, and referenced to the
  GMM3 areoid. The bundled patch files contain no `-32768` samples; sampling
  outside the square patch is explicitly invalid. The source product can
  contain archive-interpolated cells, which the app does not label as
  independent observations.
- MOLA MEGDR 128-pixel/degree products provide topography but omit the
  companion areoid map. MarsWalk uses the bundled global 4-pixel/degree
  areoid/topography rasters only to convert the regional GMM3 elevations to
  height above the viewer's reference ellipsoid. That 4-pixel/degree
  topography is not used as terrain, for route clearance, or as a coverage
  fallback.

The local terrain is a real displaced 256 × 256 triangular mesh. Its vertices
are the bundled DEM elevations, adjusted for the curvature of Mars across the
local patch. It retains the DEM's native ~463 m posting with no vertical
exaggeration. Terrain Explorer's regional preview uses the same patch source,
but builds a 128 × 128 display mesh and applies 3× vertical exaggeration.
That makes its relief look stronger; it does not mean MarsWalk is using a
coarser or less accurate DEM. MarsWalk separately drapes the USGS Planetary Maps
`MOLA_THEMIS_blend` WMS image over this geometry. The blended image includes
THEMIS IR Day mosaic at 100 m/pixel nominal and MOLA colorized relief derived
from the 128 pixels/degree product. It is near-global; above 88° latitude the
blend uses 64 pixels/degree MOLA relief. A 1180 × 1180 image is requested for
each 118 km patch and mapped onto the DEM mesh. It is not a HiRISE orthoimage
and does not add terrain detail. The THEMIS source is semi-controlled and may
not align perfectly with the mesh; the app discloses this. If the optional
WMS request fails or returns a blank/transparent image, the route/DEM still
work and the workspace explicitly reports the image failure and displays
elevation colors instead. MarsWalk requests imagery only for patches fully
within 88° latitude.

MarsWalk defaults to elevation-only colouring, which makes no WMS request.
The three surface styles change only the texture on the existing indexed DEM
mesh. `Elevation Only` and `MOLA/THEMIS` retain their existing behavior.
`Terrain Explorer` reuses Terrain Explorer's `terrainModel.buildMesh()` color
ramp and triangle-edge treatment. Terrain Explorer itself does not use a
surface imagery service: its patch and visual colors are based on the bundled
numerical MOLA elevations. MarsWalk rasterizes that same style onto its DEM
texture without replacing the mesh or changing elevations, route, or camera.
No new imagery source is requested for this style. Its texture is cached per
regional patch. If a style cannot be prepared, MarsWalk retains the previous
appearance and reports the error. The optional wireframe is an edge overlay
built from the same DEM mesh triangles; neither display control changes
vertex positions or triangle indices. Terrain queries use the same
piecewise-linear triangle interpolation as the rendered mesh, so route
elevations and inspection heights match the actual surface. Reset terrain view
returns to a patch overview.

Selecting a name in the bundled DEM coverage list loads that exact regional
binary patch, builds and frames its DEM-derived mesh, and clears any prior
route or endpoints. The displayed latitude/longitude bounds are derived from
that coverage's own center and half extent (with longitude wrapping and
planetographic latitude conversion); they describe the patch envelope, while
endpoint validation uses the exact local square patch. Use the terrain-point
selection button to pick start and destination directly on the displayed
mesh. Both elevations are sampled from the selected patch, and routes remain
constrained to its valid raster extent. Missing, invalid, or unsupported
coverage is reported rather than silently replaced by another region.

The workspace is organized around Terrain, Journey, Surface style, Flight
profile, and Flight controls. Terrain Explorer is the default style each time
MarsWalk opens; changing regions within that session keeps the selected style.
Its appearance is generated by the existing Terrain Explorer MOLA color and
triangle-edge renderer, while MOLA/THEMIS and elevation-only remain selectable
alternatives on the same unchanged mesh. Manual coordinates, display options,
advanced flight settings, route diagnostics, inspection readings, and DEM
provenance are available in collapsed disclosures so the primary workflow
stays compact.

The route planner samples this same patch raster. The drone's scene position
is derived from the sampled local terrain elevation plus its verified
clearance; the renderer and route planner do not use separate elevation
surfaces. Corridor candidates outside the patch are discarded. If both
endpoints and a complete corridor cannot be kept within one supported patch,
planning rejects the route and asks for shorter endpoints or a different
region. There is no silent fallback to the coarse global grid.

## Higher-resolution alternatives assessed

HiRISE stereo DTMs would provide substantially finer terrain where stereo
coverage exists, but are not yet integrated into this bundled offline scene.
The [USGS HiRISE DTM documentation](https://stac.astrogeology.usgs.gov/docs/data/mars/hirise_dtms/)
describes more than 900 released products (collection documentation current
to July 2023), each limited to the overlap of a stereo pair and typically
posted at 1–2 m. The data are controlled to MOLA crossover tracks and heights
are above/below the areoid. Most products also have orthoimages, often a
~1 m DTM-resolution product and a ~0.25 m full-resolution product. Coverage
is sparse rather than continuous.

For browser delivery, the [NASA/USGS HiRISE DTM cloud dataset](https://registry.opendata.aws/nasa-usgs-mars-hirise-dtms/)
provides Cloud Optimized GeoTIFFs (COGs), STAC discovery, WKT2 projection
metadata, and a CC0 1.0 license. Its products use simple cylindrical or
polar stereographic projections. The USGS processing notes that COG values
have scale/offset metadata and that controlled DTMs are not guaranteed to
co-register with uncontrolled HiRISE RDR imagery. A real-time HiRISE
implementation would therefore need footprint discovery, projection and
scale/offset handling, no-data masks, and a matched ortho asset; simply
requesting a tile from a global image service would not supply the DTM or
prove that route coverage exists.

The currently displayed global Viking MDIM 2.1 service is documented by
Esri as a NASA Ames color mosaic blended over the USGS Viking-based MDIM, with
231 m/pixel native resolution at the equator and lossy JPEG tiles. It is a
global visual basemap, not a stereo DEM and not used as the MarsWalk local
texture. MarsWalk uses the USGS MOLA/THEMIS WMS blend, whose 100 m/pixel THEMIS
imagery is higher resolution than Viking but is semi-controlled and can
misregister slightly against MOLA relief.

CTX stereo DEMs and HRSC stereo products are not part of the current bundled
dataset or runtime. This release does not claim their footprint, posting,
vertical registration, storage encoding, no-data rules, or per-product
imagery matching for any MarsWalk patch, and does not stream them. They should
only be enabled after selecting actual stereo products and validating their
PDS labels, footprints, coordinate and vertical references, no-data encoding,
and an imagery asset registered to the same surface. Until then, MOLA 128
pixels/degree is the regional numerical terrain bundled and reproducibly
available to this application.

## Planning and playback

The globe can be used to select coordinates, but MarsWalk requires an
explicit bundled DEM region. Every route is limited to that patch's actual
118 km square. Presets identify a patch and are short curated explorations
near named locations; they are not rover traverse tracks or claims about
mission paths.

The planner uses spherical Mars geodesics for distance and route interpolation,
then searches a bounded local corridor with terrain-weighted costs. Candidate
spacing is 1.5 km, with lateral lanes on both sides of the direct line. The
final trajectory is re-sampled at sub-kilometre intervals from the regional
MOLA raster; adjacent segments are also checked at their midpoints. Paths
that exceed the patch, lack a valid sample, violate the requested clearance,
or exceed the selected maximum ellipsoid height are rejected. Interpolation
increases sample density but does not create new terrain observations.

Terrain-follow mode uses a lower clearance and stronger ridge penalty;
Cinematic uses a moderate clearance; High-altitude overview uses a larger
clearance. These are visualization settings, not flight-performance or
collision-safety guarantees. The planner verifies clearance against the
regional raster only. It cannot resolve sub-cell obstacles, and archive-filled
or stereo-derived source quality is not equivalent to direct measurements at
every pixel.

Preview shows the local mesh, direct surface projection, planned flight path,
and a drone marker. Start and destination labels are separately sampled from
the selected regional DEM and sit a few metres above the corresponding mesh
surface; they remain visible while selecting, previewing, and flying. Invalid
or out-of-coverage manual coordinates do not create markers. During playback the primary
view retains its trajectory-aware oblique camera with damped position,
bounded acceleration, and bounded angular motion. The existing first-person
pilot inset is supplemented by a true north-up overhead view and a
heading-relative lateral view. The auxiliary cameras are separate Cesium
viewports because a Cesium scene has one active camera; all three secondary
viewports reuse the selected surface canvas and the same CPU-side DEM mesh,
route, and trajectory progress from the single playback loop. Cesium uploads
terrain resources separately for each WebGL context. The right-side controls
smoothly yield their space to vertically stacked Top and Side views during
playback, then return when playback ends or is stopped. A compact
Pause/Resume, Restart, Speed, and End flight toolbar remains available outside
the hidden menu. Playback rates from 0.5× to 8× change the single shared
trajectory clock, so all four camera views remain synchronized. Seek,
reduced-motion behavior, and camera restoration also remain available.

Before flight, the local scene uses a bounded camera controller instead of
Cesium's Mars-globe zoom pivot. Left drag orbits around the current terrain
focus; middle/right drag and Shift+left drag pan in the current camera's
screen-space basis. Trackpad two-finger scroll pans, Ctrl/Meta-pinch and
two-finger touch pinch zoom, and mouse wheel zooms. Orbit, focus, and zoom
settle with elapsed-time damping; panning stays within the DEM footprint,
camera height is checked against the mesh, and reset restores a useful
overview. The controller is disabled during endpoint selection and flight.

For the global 4-pixel/degree MEGDR and Terrain Explorer's regional mesh
details, see [`TERRAIN-DATA.md`](./TERRAIN-DATA.md).
