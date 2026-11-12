# NASA InSight observations

`insight-weather-response.json` is the unmodified successful response retrieved from https://api.nasa.gov/insight_weather/?api_key=DEMO_KEY&feedtype=json&ver=1.0 on 2026-10-03.

The newest complete sol in that response is 681. NASA's validity checks mark both AT (air temperature) and PRE (pressure) valid. The app embeds that verified observation so it remains available during network failures and shared DEMO_KEY rate limits.

- Observation interval: 2020-10-25T22:29:51Z to 2020-10-26T23:09:26Z
- Mean air temperature, AT.av: -62.434 degrees Celsius
- Mean atmospheric pressure, PRE.av: 743.55 pascals

These are archived measurements from InSight at Elysium Planitia, not present-day global weather. NASA ended the InSight mission in December 2022: https://www.nasa.gov/missions/insight/nasa-retires-insight-mars-lander-mission-after-years-of-science/

The app checks for validated observations no more than once every six hours, caches successful responses locally, and preserves its saved observation when the API fails or returns incomplete/invalid data. Observation dates are separate from retrieval dates. No synthetic weather values are used.

## MOLA numerical terrain

The application also bundles two original 4 pixels/degree MOLA MEGDR rasters:
`mola-meg004-topography.img` (MEGT90N000CB) and
`mola-meg004-areoid-radius-offset.img` (MEGA90N000CB). The PDS product
identifiers, binary layout, areoid reference, sampling rules, limitations,
and attribution are documented in [TERRAIN-DATA.md](../TERRAIN-DATA.md).
These are numerical elevation inputs; the existing MOLA shaded-relief
basemap remains an image and is not queried for elevation.
