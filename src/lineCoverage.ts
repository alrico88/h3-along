import booleanIntersects from "@turf/boolean-intersects";
import { lineString } from "@turf/helpers";
import lineIntersect from "@turf/line-intersect";
import { gridDisk, latLngToCell, type H3Index } from "h3-js";
import type { Feature, LineString, Polygon, Position } from "geojson";
import { createCellGeometryLookup, unwrapLongitude, type CellGeometry } from "./cellGeometry.ts";

type SegmentCell = { cell: H3Index; entry: number };

/** Fraction (0..1) of the segment at which it first touches the cell. */
function getSegmentEntry(segment: Feature<LineString>, cellPolygon: Feature<Polygon>): number {
  const [[startX, startY], [endX, endY]] = segment.geometry.coordinates;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  let entry = Number.POSITIVE_INFINITY;

  for (const { geometry } of lineIntersect(segment, cellPolygon).features) {
    const [x, y] = geometry.coordinates;
    entry = Math.min(entry, ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared);
  }

  // Without any edge crossing the cell contains the whole segment.
  return Number.isFinite(entry) ? Math.max(0, entry) : 0;
}

function assertValidCoordinates(coordinates: Position[]): void {
  if (coordinates.length < 2) {
    throw new Error("A LineString should contain at least two coordinates");
  }

  for (const [longitude, latitude] of coordinates) {
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      Math.abs(longitude) > 180 ||
      Math.abs(latitude) > 90
    ) {
      throw new Error(
        "Coordinates must be finite longitude/latitude pairs within [-180, 180] and [-90, 90]",
      );
    }
  }
}

function getSegmentCells(
  start: Position,
  end: Position,
  resolution: number,
  getGeometry: (cell: H3Index) => CellGeometry,
): H3Index[] {
  const startCell = latLngToCell(start[1], start[0], resolution);

  if (start[0] === end[0] && start[1] === end[1]) return [startCell];

  const reference = (start[0] + end[0]) / 2;
  const segment = lineString([start.slice(0, 2), end]);
  const visited = new Set<H3Index>([startCell]);
  const queue: SegmentCell[] = [{ cell: startCell, entry: 0 }];

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    for (const neighbor of gridDisk(queue[queueIndex].cell, 1)) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);

      const { polygon, longitude } = getGeometry(neighbor);
      // Move the segment next to the cell's copy of the world instead of rebuilding the cell.
      const shift = 360 * Math.round((reference - longitude) / 360);
      const shifted =
        shift === 0
          ? segment
          : lineString([
              [start[0] - shift, start[1]],
              [end[0] - shift, end[1]],
            ]);

      if (booleanIntersects(shifted, polygon)) {
        queue.push({
          cell: neighbor,
          entry: getSegmentEntry(shifted, polygon),
        });
      }
    }
  }

  return queue
    .sort((a, b) => a.entry - b.entry || (a.cell < b.cell ? -1 : 1))
    .map(({ cell }) => cell);
}

export function getH3CellsAlongCoordinates(lines: Position[][], resolution: number): H3Index[] {
  const cells: H3Index[] = [];
  const seen = new Set<H3Index>();
  const getGeometry = createCellGeometryLookup();

  for (const coordinates of lines) {
    assertValidCoordinates(coordinates);

    for (let index = 0; index < coordinates.length - 1; index += 1) {
      const start = coordinates[index];
      const next = coordinates[index + 1];
      const end = [unwrapLongitude(next[0], start[0]), next[1]];

      for (const cell of getSegmentCells(start, end, resolution, getGeometry)) {
        if (!seen.has(cell)) {
          seen.add(cell);
          cells.push(cell);
        }
      }
    }
  }

  return cells;
}
