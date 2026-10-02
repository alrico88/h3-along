import type { Feature, LineString, MultiLineString } from "geojson";
import type { H3Index } from "h3-js";
import { getH3CellsBetweenCoordinates } from "h3-between";

export type H3LineFeature = Feature<LineString | MultiLineString | null>;
export type H3LineInput = H3LineFeature | LineString | MultiLineString;

function getLineGeometry(input: H3LineInput): LineString | MultiLineString {
  const geometry = input.type === "Feature" ? input.geometry : input;

  if (geometry?.type === "LineString" || geometry?.type === "MultiLineString") {
    return geometry;
  }

  throw new Error(
    "Unsupported GeoJSON type. Only LineString and MultiLineString Features or Geometries are allowed",
  );
}

function getCellsForLineString(lineString: LineString, resolution: number): H3Index[] {
  if (lineString.coordinates.length < 2) {
    throw new Error("A LineString should contain at least two coordinates");
  }

  const cells = new Set<H3Index>();

  for (let index = 0; index < lineString.coordinates.length - 1; index += 1) {
    const start = lineString.coordinates[index];
    const end = lineString.coordinates[index + 1];

    getH3CellsBetweenCoordinates([start[0], start[1]], [end[0], end[1]], resolution).forEach(
      (cell) => {
        cells.add(cell);
      },
    );
  }

  return [...cells];
}

/**
 * Gets the H3 cells along a LineString geometry.
 */
export function getH3CellsAlongLineString(lineString: LineString, resolution: number): H3Index[] {
  return getCellsForLineString(lineString, resolution);
}

/**
 * Gets the H3 cells along a MultiLineString geometry.
 */
export function getH3CellsAlongMultiLineString(
  multiLineString: MultiLineString,
  resolution: number,
): H3Index[] {
  const cells = new Set<H3Index>();
  multiLineString.coordinates.forEach((coordinates) => {
    getCellsForLineString({ type: "LineString", coordinates }, resolution).forEach((cell) =>
      cells.add(cell),
    );
  });

  return [...cells];
}

/**
 * Gets the H3 cells along a LineString or MultiLineString Feature or Geometry.
 */
export function getH3CellsAlong(input: H3LineInput, resolution: number): H3Index[] {
  const geometry = getLineGeometry(input);

  if (geometry.type === "LineString") {
    return getH3CellsAlongLineString(geometry, resolution);
  }

  return getH3CellsAlongMultiLineString(geometry, resolution);
}
