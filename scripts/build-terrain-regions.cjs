const fs = require('node:fs');
const path = require('node:path');
const science = require('../science-data.js');
const terrain = require('../terrain-model.js');

const root = path.resolve(__dirname, '..');
const archive = 'https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg128';
const recordBytes = 23040;
const pixelsPerDegree = 128;
const patchSize = terrain.SIZE;
const marsRadiusKm = science.MARS_MEAN_RADIUS_M / 1000;

function tileFor(latitude, longitude) {
  const normalizedLongitude = science.normalizeLongitude(longitude);
  const tileTopLatitude = latitude >= 0
    ? (latitude < 44 ? 44 : 88)
    : (latitude >= -44 ? 0 : -44);
  const tileTopLongitude = Math.floor(normalizedLongitude / 90) * 90;
  const latitudeCode = `${String(Math.abs(tileTopLatitude)).padStart(2, '0')}${tileTopLatitude < 0 ? 's' : 'n'}`;
  const longitudeCode = String(tileTopLongitude).padStart(3, '0');
  return { tileTopLatitude, tileTopLongitude, latitudeCode, longitudeCode };
}

function getWindow(region) {
  const centerLatitude = science.planetographicToPlanetocentric(region.latitude);
  const centerLongitude = science.normalizeLongitude(region.longitude);
  const tile = tileFor(centerLatitude, centerLongitude);
  const firstRow = [], columnsByRow = [], rowRanges = [];
  const halfExtentKm = terrain.HALF_EXTENT_KM;
  for (let row = 0; row < patchSize; row++) {
    const northKm = (0.5 - row / (patchSize - 1)) * halfExtentKm * 2;
    const latitude = centerLatitude + northKm / marsRadiusKm * 180 / Math.PI;
    const sourceRow = Math.round((tile.tileTopLatitude - latitude) * pixelsPerDegree - 0.5);
    firstRow.push(sourceRow);
    const longitudeStep = Math.max(0.001, Math.cos(latitude * Math.PI / 180));
    const columns = [];
    for (let column = 0; column < patchSize; column++) {
      const eastKm = (column / (patchSize - 1) - 0.5) * halfExtentKm * 2;
      const sampleLongitude = science.normalizeLongitude(
        centerLongitude + eastKm / (marsRadiusKm * longitudeStep) * 180 / Math.PI
      );
      columns.push(Math.round((sampleLongitude - tile.tileTopLongitude) * pixelsPerDegree - 0.5));
    }
    columnsByRow.push(columns);
    rowRanges.push({
      row: sourceRow,
      firstColumn: Math.min(...columns),
      lastColumn: Math.max(...columns)
    });
  }
  const rowStart = Math.min(...firstRow), rowEnd = Math.max(...firstRow);
  if (rowStart < 0 || rowEnd >= 5632 || columnsByRow.flat().some(column => column < 0 || column >= 11520)) {
    throw new RangeError(`Preset ${region.id} patch crosses an unsupported MOLA tile edge.`);
  }
  return {
    ...tile,
    firstRow,
    columnsByRow,
    rowRanges,
    rowStart,
    rowEnd,
    filename: `megt${tile.latitudeCode}${tile.longitudeCode}hb.img`
  };
}

async function fetchRows(window) {
  const url = `${archive}/${window.filename}`;
  const ranges = window.rowRanges.map(range => ({
    start: range.row * recordBytes + range.firstColumn * 2,
    end: range.row * recordBytes + (range.lastColumn + 1) * 2 - 1,
    row: range.row,
    firstColumn: range.firstColumn
  }));
  const response = await fetch(url, {
    headers: { Range: `bytes=${ranges.map(range => `${range.start}-${range.end}`).join(',')}` }
  });
  if (response.status !== 206) throw new Error(`Expected ranged MOLA response for ${window.filename}; received HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') || '';
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundary) throw new Error(`MOLA archive did not return a multipart byte-range response for ${window.filename}.`);
  const delimiter = Buffer.from(`--${(boundary[1] || boundary[2]).trim()}`);
  const body = Buffer.from(await response.arrayBuffer());
  const parts = new Map();
  let position = 0;
  while ((position = body.indexOf(delimiter, position)) >= 0) {
    position += delimiter.length;
    if (body.subarray(position, position + 2).toString() === '--') break;
    if (body.subarray(position, position + 2).toString() === '\r\n') position += 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), position);
    if (headerEnd < 0) throw new Error(`Malformed multipart MOLA response for ${window.filename}.`);
    const headers = body.subarray(position, headerEnd).toString('ascii');
    const contentRange = headers.match(/content-range:\s*bytes\s+(\d+)-(\d+)\/\d+/i);
    if (!contentRange) throw new Error(`MOLA range metadata is missing for ${window.filename}.`);
    const start = Number(contentRange[1]), end = Number(contentRange[2]);
    const dataStart = headerEnd + 4, dataEnd = dataStart + end - start + 1;
    if (dataEnd > body.length) throw new Error(`Incomplete MOLA byte range for ${window.filename}.`);
    parts.set(start, body.subarray(dataStart, dataEnd));
    position = dataEnd;
  }
  const rows = new Map();
  for (const range of ranges) {
    const bytes = parts.get(range.start);
    if (!bytes || bytes.length !== range.end - range.start + 1) {
      throw new Error(`Incomplete MOLA row ${range.row} for ${window.filename}.`);
    }
    rows.set(range.row, { bytes, firstColumn: range.firstColumn });
  }
  return rows;
}

async function main() {
  const output = path.join(root, 'data', 'terrain-regions');
  fs.mkdirSync(output, { recursive: true });
  const manifest = [];
  for (const region of terrain.REGIONS) {
    const window = getWindow(region);
    console.log(`Fetching ${region.name} from ${window.filename} rows ${window.rowStart}-${window.rowEnd}…`);
    const rows = await fetchRows(window);
    const patch = Buffer.alloc(patchSize * patchSize * 2);
    for (let row = 0; row < patchSize; row++) {
      const sourceRow = rows.get(window.firstRow[row]);
      for (let column = 0; column < patchSize; column++) {
        const sourceOffset = (window.columnsByRow[row][column] - sourceRow.firstColumn) * 2;
        const targetOffset = (row * patchSize + column) * 2;
        sourceRow.bytes.copy(patch, targetOffset, sourceOffset, sourceOffset + 2);
      }
    }
    fs.writeFileSync(path.join(output, `${region.id}.bin`), patch);
    manifest.push({
      id: region.id,
      name: region.name,
      latitude: region.latitude,
      longitude: region.longitude,
      file: `${region.id}.bin`,
      bytes: patch.length,
      product: 'MEGT MOLA MEGDR 128 pixels/degree, product version 2.0',
      sourceProduct: window.filename.toUpperCase(),
      sourceUrl: `${archive}/${window.filename}`,
      latitudeReference: 'Planetocentric source grid; preset coordinates are converted from planetographic degrees for raster indexing.',
      verticalReference: 'GMM3 areoid',
      nominalResolutionMetersAtEquator: 463,
      patchWidthKm: terrain.HALF_EXTENT_KM * 2,
      attribution: 'NASA / MOLA Science Team / PDS Geosciences Node'
    });
  }
  fs.writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Generated ${manifest.length} regional MOLA patches in ${output}.`);
}

main().catch(error => {
  console.error(`Could not generate regional terrain patches: ${error.message}`);
  process.exitCode = 1;
});
