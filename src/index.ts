import type { Feature, LineString, MultiLineString } from "geojson";
import type { H3Index } from "h3-js";
import { getH3CellsAlongCoordinates } from "./lineCoverage.ts";

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

/**
 * Gets the H3 cells along a LineString geometry.
 */
export function getH3CellsAlongLineString(lineString: LineString, resolution: number): H3Index[] {
  return getH3CellsAlongCoordinates([lineString.coordinates], resolution);
}

/**
 * Gets the H3 cells along a MultiLineString geometry.
 */
export function getH3CellsAlongMultiLineString(
  multiLineString: MultiLineString,
  resolution: number,
): H3Index[] {
  return getH3CellsAlongCoordinates(multiLineString.coordinates, resolution);
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
