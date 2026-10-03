import { polygon } from "@turf/helpers";
import { cellToBoundary, cellToLatLng, getResolution, latLngToCell, type H3Index } from "h3-js";
import type { Feature, Polygon, Position } from "geojson";

export type CellGeometry = { polygon: Feature<Polygon>; longitude: number };

export function unwrapLongitude(longitude: number, reference: number): number {
  let unwrapped = longitude;

  while (unwrapped - reference > 180) unwrapped -= 360;
  while (unwrapped - reference < -180) unwrapped += 360;

  return unwrapped;
}

function getContainedPole(cell: H3Index): number | undefined {
  const resolution = getResolution(cell);
  return [90, -90].find((pole) => latLngToCell(pole, 0, resolution) === cell);
}

/**
 * A cell around a pole wraps all longitudes. Unroll its boundary over two turns and close it
 * along the pole so the planar polygon covers the cap whatever side of the seam a segment is on.
 */
function getPolarGeometry(boundary: Position[], pole: number): CellGeometry {
  const points: Position[] = [];

  for (const [lng, lat] of boundary.slice(0, -1)) {
    points.push([unwrapLongitude(lng, points.at(-1)?.[0] ?? lng), lat]);
  }

  if (points[points.length - 1][0] < points[0][0]) points.reverse();

  const [firstLongitude, firstLatitude] = points[0];
  const ring = [
    ...points,
    ...points.map(([lng, lat]) => [lng + 360, lat]),
    [firstLongitude + 720, firstLatitude],
    [firstLongitude + 720, pole],
    [firstLongitude, pole],
    points[0],
  ];

  return { polygon: polygon([ring]), longitude: firstLongitude + 360 };
}

function buildCellGeometry(cell: H3Index): CellGeometry {
  const boundary = cellToBoundary(cell, true);
  const pole = getContainedPole(cell);

  if (pole !== undefined) return getPolarGeometry(boundary, pole);

  const [, longitude] = cellToLatLng(cell);
  // Keep seam-crossing cells narrow, not world-spanning.
  const ring = boundary.map(([lng, lat]) => [unwrapLongitude(lng, longitude), lat]);
  return { polygon: polygon([ring]), longitude };
}

export function createCellGeometryLookup(): (cell: H3Index) => CellGeometry {
  const cache = new Map<H3Index, CellGeometry>();

  return (cell) => {
    let geometry = cache.get(cell);

    if (!geometry) {
      geometry = buildCellGeometry(cell);
      cache.set(cell, geometry);
    }

    return geometry;
  };
}
