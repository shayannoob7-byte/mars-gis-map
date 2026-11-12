# Martian Map ZIP integration review

Reviewed 2026-11-12 against the supplied `martian_map.zip`.

## Result

Integrated the archive's application source, data, documentation, build scripts,
and tests into this project. File hashes confirm that all imported source/data
files match the archive except the four intentionally adapted files listed below.
Existing Git/Vercel configuration and Windows launchers were retained. Archive
editor identity, macOS metadata, duplicate launchers, and prebuilt output were
excluded; production output and the standalone preview were regenerated locally.

## Defects repaired

1. `scripts/build-site.cjs` omitted `marswalk-navigation.js`, despite the HTML
   requiring it. That would silently disable MarsWalk in the deployed build.
   The module is now published, with a regression test checking every local HTML
   asset and all bundled terrain files against their source bytes.
2. `app.js` and `science-explorer.js` did not connect the visible point elevation,
   slope, or provenance controls to location selection. Selection and clearing
   now drive lazy MOLA sampling. Stale responses cannot repopulate cleared or
   replaced selections; errors remain visible and failed grid loads can retry.
3. `README.md` described MarsWalk as using global coarse terrain. Updated it to
   describe its regional terrain mesh, bounded coverage, and global datum grid.

## Feature cross-check

| Feature from archive | Verification |
| --- | --- |
| Mission History: dated records, filters, landing references, source/provenance | Browser rendered all ten records; automated metadata validation and UI wiring checks passed. |
| Point elevation, slope, and provenance | Repaired missing wiring; browser inspected InSight: -2,599 m, 0.07 degrees, with dataset/reference details; stale-selection regression passed. |
| Terrain Explorer: ten regional models, custom coarse-grid coordinates, scale and reset | Browser loaded/rendered Jezero at 50 km; regional data, mesh, custom-grid calculations, and UI checks passed. |
| MarsWalk: regional terrain and independent workspace | Browser loaded Jezero; native displaced mesh, coverage, sampling, and geometry tests passed. |
| Endpoints: presets, manual coordinates, globe/terrain selection, markers | All curated presets passed route planning; coordinate/coverage validation and event-wiring tests passed. Browser used the Jezero preset. |
| Terrain-aware route planning, clearance, altitude limits, flight profiles | Synthetic ridge detours, altitude rejection, regional clearance, boundary and longitude tests passed; browser planned an 11.1 km route. |
| Playback, four synchronized cameras, seeking, speeds, navigation | Browser completed the Jezero journey; shared clock, seeking, rates, camera basis, orbit/pan/zoom tests passed. |
| Surface styles, optional MOLA/THEMIS texture, wireframe and inspection | Default Terrain Explorer style loaded in browser; mesh preservation, texture bounds/failure detection, inspection and display-wiring tests passed. Optional remote texture was not manually verified. |
| Terrain provenance and bundled rasters | Both global rasters and all ten regional patches imported; decoding, manifest/coverage and build-asset checks passed. |
| Existing weather, DSN, NASA media, imagery, measurements, solar system | Existing modules retained; regression suite passed. Live upstream services were not exhaustively exercised. |
| Local server, standalone preview, Vercel build | Local HTTP served app and new assets; generated preview freshness passed; production build includes all referenced assets. No deployment performed. |

## Validation and limits

- 74 tests passed, zero failures (`node --test`). Some archive tests check source
  wiring, rather than simulate every browser interaction.
- Preview generation/freshness and `git diff --check` passed.
- Browser console contained no errors during the checked workflows.
- Runtime preview: http://127.0.0.1:8765/.
- This is source, data, automated regression, and representative browser
  verification. It does not certify every gesture/device, upstream imagery
  availability, scientific accuracy, or deployed Vercel behavior.
- Regional DEM posting is about 463 m at the equator; global sampling is about
  14.8 km. Neither resolves rover-scale hazards or certifies flight safety.

Changes are left uncommitted for review.
