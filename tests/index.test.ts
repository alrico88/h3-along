import type { LineString, MultiLineString } from "geojson";
import { describe, expect, test } from "vite-plus/test";
import { getH3CellsAlong, getH3CellsAlongLineString } from "../src/index.ts";

const line: LineString = {
  type: "LineString",
  coordinates: [
    [-3.7038, 40.4168],
    [-4.0273, 39.8628],
  ],
};

describe("getH3CellsAlongLineString", () => {
  test("returns one cell for a line inside one cell", () => {
    const sameCellLine: LineString = {
      type: "LineString",
      coordinates: [
        [-3.7038, 40.4168],
        [-3.7039, 40.4169],
      ],
    };

    expect(getH3CellsAlongLineString(sameCellLine, 8)).toHaveLength(1);
  });

  test("returns the cells in the segment order without duplicates", () => {
    const cells = getH3CellsAlongLineString(line, 8);
    expect(cells.length).toBeGreaterThan(1);
    expect(new Set(cells).size).toBe(cells.length);
  });

  test("rejects a LineString with fewer than two coordinates", () => {
    expect(() => getH3CellsAlongLineString({ type: "LineString", coordinates: [] }, 8)).toThrow();
  });
});

describe("getH3CellsAlong", () => {
  test("accepts a Feature and a MultiLineString", () => {
    const multiLineString: MultiLineString = {
      type: "MultiLineString",
      coordinates: [line.coordinates],
    };

    const fromFeature = getH3CellsAlong({ type: "Feature", properties: {}, geometry: line }, 8);
    const fromMultiLineString = getH3CellsAlong(multiLineString, 8);

    expect(fromFeature).toStrictEqual(fromMultiLineString);
  });

  test("rejects Features without a supported geometry", () => {
    expect(() => getH3CellsAlong({ type: "Feature", properties: {}, geometry: null }, 8)).toThrow();
  });
});
