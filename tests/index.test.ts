import type { LineString, MultiLineString, Position } from "geojson";
import { describe, expect, test } from "vite-plus/test";
import booleanIntersects from "@turf/boolean-intersects";
import { lineString, polygon } from "@turf/helpers";
import {
  cellToBoundary,
  cellToLatLng,
  getPentagons,
  gridDisk,
  latLngToCell,
  type H3Index,
} from "h3-js";
import { getH3CellsAlong, getH3CellsAlongLineString } from "../src/index.ts";
import { getH3CellsAlongCoordinates } from "../src/lineCoverage.ts";

const line: LineString = {
  type: "LineString",
  coordinates: [
    [-3.7038, 40.4168],
    [-4.0273, 39.8628],
  ],
};

const us101Road: LineString = {
  type: "LineString",
  coordinates: [
    [-122.401, 37.708],
    [-122.405, 37.723],
    [-122.406, 37.741],
    [-122.407, 37.759],
    [-122.407, 37.776],
    [-122.404, 37.79],
  ],
};

function getGridDiskOracle(
  coordinates: Position[],
  resolution: number,
  origin: H3Index,
  radius: number,
): H3Index[] {
  const line = lineString(coordinates);

  return gridDisk(origin, radius).filter((cell) => {
    let boundary = cellToBoundary(cell, true);
    const crossesSeam = boundary.some(
      (point, index) => index > 0 && Math.abs(point[0] - boundary[index - 1][0]) > 180,
    );

    if (crossesSeam) {
      boundary = boundary.map(([lng, lat]) => [
        coordinates[0][0] < 0 ? (lng > 0 ? lng - 360 : lng) : lng < 0 ? lng + 360 : lng,
        lat,
      ]);
    }

    return booleanIntersects(line, polygon([boundary]));
  });
}

function getCellCenter(cell: H3Index): Position {
  const [latitude, longitude] = cellToLatLng(cell);
  return [longitude, latitude];
}

function getAntimeridianOracle(
  coordinates: Position[],
  resolution: number,
  radius: number,
): H3Index[] {
  const toEasternHemisphere = ([lng, lat]: Position): Position => [lng < 0 ? lng + 360 : lng, lat];
  const segment = lineString(coordinates.map(toEasternHemisphere));
  const origin = latLngToCell(coordinates[0][1], coordinates[0][0], resolution);
  const interior = new Set(gridDisk(origin, radius - 1));
  const cells = gridDisk(origin, radius).filter((cell) =>
    booleanIntersects(segment, polygon([cellToBoundary(cell, true).map(toEasternHemisphere)])),
  );

  // The enumerated domain has a full ring of unused cells around the result.
  expect(cells.every((cell) => interior.has(cell))).toBe(true);
  return cells;
}

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

  test("covers every H3 cell touched by the road fixture", () => {
    const resolution = 8;
    const cells = new Set(getH3CellsAlongLineString(us101Road, resolution));

    expect(cells.has("88283082cdfffff")).toBe(true);
    expect(cells.has("882830828dfffff")).toBe(true);

    for (let index = 0; index < us101Road.coordinates.length - 1; index += 1) {
      const start = us101Road.coordinates[index];
      const end = us101Road.coordinates[index + 1];

      for (let step = 0; step <= 100; step += 1) {
        const progress = step / 100;
        const longitude = start[0] + (end[0] - start[0]) * progress;
        const latitude = start[1] + (end[1] - start[1]) * progress;
        const cell = latLngToCell(latitude, longitude, resolution);

        expect(cells.has(cell)).toBe(true);
      }
    }
  });

  test("rejects a LineString with fewer than two coordinates", () => {
    expect(() => getH3CellsAlongLineString({ type: "LineString", coordinates: [] }, 8)).toThrow();
  });

  test.each([
    [Infinity, 10],
    [10, NaN],
    [181, 10],
    [10, 91],
  ])("rejects an invalid endpoint: %j", (longitude, latitude) => {
    expect(() =>
      getH3CellsAlongCoordinates(
        [
          [
            [0, 0],
            [longitude, latitude],
          ],
        ],
        8,
      ),
    ).toThrow("Coordinates must be finite");
  });
});

describe("neighbor traversal", () => {
  test("matches an independent geometric oracle for a straight line", () => {
    const actual = getH3CellsAlongCoordinates([us101Road.coordinates], 8);
    const origin = latLngToCell(us101Road.coordinates[0][1], us101Road.coordinates[0][0], 8);
    const expected = getGridDiskOracle(us101Road.coordinates, 8, origin, 12);

    expect(new Set(actual)).toEqual(new Set(expected));
    expect(actual[0]).toBe(
      latLngToCell(us101Road.coordinates[0][1], us101Road.coordinates[0][0], 8),
    );
    expect(actual.at(-1)).toBe(
      latLngToCell(us101Road.coordinates.at(-1)![1], us101Road.coordinates.at(-1)![0], 8),
    );
  });

  test("handles a line passing through a cell vertex", () => {
    const sourceCell = latLngToCell(40.4168, -3.7038, 8);
    const [longitude, latitude] = cellToBoundary(sourceCell, true)[0];
    const coordinates: Position[] = [
      [longitude - 0.05, latitude - 0.05],
      [longitude + 0.05, latitude + 0.05],
    ];
    const actual = getH3CellsAlongCoordinates([coordinates], 8);
    const origin = latLngToCell(coordinates[0][1], coordinates[0][0], 8);

    expect(new Set(actual)).toEqual(new Set(getGridDiskOracle(coordinates, 8, origin, 16)));
    expect(actual).toStrictEqual(getH3CellsAlongCoordinates([coordinates], 8));
  });

  test("handles pentagon neighbors and a folded repeated line", () => {
    const pentagon = getPentagons(5)[0];
    const neighbor = gridDisk(pentagon, 1).find((cell) => cell !== pentagon)!;
    const pentagonCenter = cellToLatLng(pentagon);
    const neighborCenter = cellToLatLng(neighbor);
    const pentagonLine: Position[] = [
      [pentagonCenter[1], pentagonCenter[0]],
      [neighborCenter[1], neighborCenter[0]],
    ];
    const foldedLine: Position[] = [
      [-3.7, 40.4],
      [-3.5, 40.5],
      [-3.8, 40.6],
      [-3.6, 40.4],
      [-3.7, 40.4],
    ];
    const pentagonOrigin = pentagon;
    const foldedOrigin = latLngToCell(foldedLine[0][1], foldedLine[0][0], 8);

    expect(new Set(getH3CellsAlongCoordinates([pentagonLine], 5))).toEqual(
      new Set(getGridDiskOracle(pentagonLine, 5, pentagonOrigin, 2)),
    );
    expect(new Set(getH3CellsAlongCoordinates([foldedLine], 8))).toEqual(
      new Set(getGridDiskOracle(foldedLine, 8, foldedOrigin, 32)),
    );
  });

  test("matches the independent oracle at high latitude", () => {
    const coordinates: Position[] = [
      [-150, 70],
      [-130, 72],
    ];

    const origin = latLngToCell(coordinates[0][1], coordinates[0][0], 3);
    expect(new Set(getH3CellsAlongCoordinates([coordinates], 3))).toEqual(
      new Set(getGridDiskOracle(coordinates, 3, origin, 16)),
    );
  });

  test("keeps first-entry order through a bend and repeated components", () => {
    const start = latLngToCell(40.4168, -3.7038, 8);
    const path = [start];

    while (path.length < 4) {
      const previous = path.at(-1)!;
      const next = gridDisk(previous, 1)
        .filter((cell) => !path.includes(cell))
        .sort()[0];
      path.push(next);
    }

    const foldedCoordinates = path.map(getCellCenter);
    const foldedResult = getH3CellsAlongCoordinates([foldedCoordinates], 8);
    const repeatedResult = getH3CellsAlongCoordinates(
      [
        [foldedCoordinates[0], foldedCoordinates[1]],
        [foldedCoordinates[1], foldedCoordinates[0]],
        [foldedCoordinates[0], foldedCoordinates[2]],
      ],
      8,
    );

    expect(foldedResult.slice(0, path.length)).toStrictEqual(path);
    expect(foldedResult.indexOf(path[3])).toBeGreaterThan(foldedResult.indexOf(path[2]));
    expect(repeatedResult).toStrictEqual([path[0], path[1], path[2]]);
  });

  test("keeps first-entry order in a MultiLineString with a return", () => {
    const start = latLngToCell(40.4168, -3.7038, 8);
    const first = gridDisk(start, 1)
      .filter((cell) => cell !== start)
      .sort()[0];
    const second = gridDisk(first, 1)
      .filter((cell) => cell !== start && cell !== first)
      .sort()[0];
    const coordinates: MultiLineString = {
      type: "MultiLineString",
      coordinates: [
        [getCellCenter(start), getCellCenter(first)],
        [getCellCenter(first), getCellCenter(start)],
        [getCellCenter(start), getCellCenter(second)],
      ],
    };

    expect(getH3CellsAlong(coordinates, 8)).toStrictEqual([start, first, second]);
  });

  test("handles a segment collinear with a shared cell edge", () => {
    const first = latLngToCell(40.4168, -3.7038, 8);
    const second = gridDisk(first, 1)
      .filter((cell) => cell !== first)
      .sort()[0];
    const firstBoundary = cellToBoundary(first, true);
    const secondBoundary = cellToBoundary(second, true);
    const edge = firstBoundary.filter((point) =>
      secondBoundary.some((otherPoint) => point[0] === otherPoint[0] && point[1] === otherPoint[1]),
    );
    const actual = getH3CellsAlongCoordinates([edge], 8);

    expect(edge).toHaveLength(2);
    expect(new Set(actual)).toEqual(new Set(getGridDiskOracle(edge, 8, first, 2)));
    expect(actual).toStrictEqual(getH3CellsAlongCoordinates([edge], 8));
  });

  test("handles zero-length and high-resolution short segments", () => {
    const zeroLength: Position[] = [
      [-3.7038, 40.4168],
      [-3.7038, 40.4168],
    ];
    const shortSegment: Position[] = [
      [-3.7038, 40.4168],
      [-3.703799, 40.416801],
    ];
    const zeroCell = latLngToCell(zeroLength[0][1], zeroLength[0][0], 15);
    const shortOrigin = latLngToCell(shortSegment[0][1], shortSegment[0][0], 15);

    expect(getH3CellsAlongCoordinates([zeroLength], 12)).toStrictEqual([
      latLngToCell(zeroLength[0][1], zeroLength[0][0], 12),
    ]);
    expect(getH3CellsAlongCoordinates([zeroLength], 15)).toStrictEqual([zeroCell]);
    expect(new Set(getH3CellsAlongCoordinates([shortSegment], 15))).toEqual(
      new Set(getGridDiskOracle(shortSegment, 15, shortOrigin, 2)),
    );
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

describe("poles", () => {
  function getSampledCells(coordinates: Position[], resolution: number): Set<H3Index> {
    const [[startLng, startLat], [endLng, endLat]] = coordinates;
    const steps = 20000;

    return new Set(
      Array.from({ length: steps + 1 }, (_, step) => {
        const t = step / steps;
        return latLngToCell(
          startLat + (endLat - startLat) * t,
          startLng + (endLng - startLng) * t,
          resolution,
        );
      }),
    );
  }

  test.each([
    [
      "north pole",
      [
        [0, 80],
        [0, 90],
      ],
    ],
    [
      "south pole",
      [
        [30, -80],
        [30, -90],
      ],
    ],
    [
      "pole to pole",
      [
        [10, -90],
        [10, 90],
      ],
    ],
    [
      "around the pole",
      [
        [0, 89.5],
        [90, 89.5],
      ],
    ],
    [
      "across the pole",
      [
        [0, 89],
        [180, 89],
      ],
    ],
    [
      "along the south pole seam",
      [
        [-170, -89.5],
        [-100, -89.5],
      ],
    ],
  ] as [string, Position[]][])("covers every cell sampled along a line: %s", (_, coordinates) => {
    const actual = new Set(getH3CellsAlongCoordinates([coordinates], 3));

    for (const cell of getSampledCells(coordinates, 3)) {
      expect(actual.has(cell)).toBe(true);
    }
  });
});

describe("antimeridian", () => {
  test.each([5, 8])("follows the short crossing at resolution %i", (resolution) => {
    const coordinates: Position[] = [
      [179.99, 10],
      [-179.99, 10.01],
    ];
    const actual = getH3CellsAlongCoordinates([coordinates], resolution);
    const reverse = getH3CellsAlongCoordinates([[...coordinates].reverse()], resolution);

    expect(new Set(actual)).toEqual(new Set(getAntimeridianOracle(coordinates, resolution, 20)));
    expect(reverse).toStrictEqual([...actual].reverse());
    expect(actual[0]).toBe(latLngToCell(10, 179.99, resolution));
    expect(actual.at(-1)).toBe(latLngToCell(10.01, -179.99, resolution));
  });

  test("matches a pre-cut MultiLineString without duplicates or reordered cells", () => {
    const coordinates: Position[] = [
      [179, 10],
      [-179, 11],
    ];
    const actual = getH3CellsAlongCoordinates([coordinates], 5);
    const split = getH3CellsAlong(
      {
        type: "MultiLineString",
        coordinates: [
          [
            [179, 10],
            [180, 10.5],
          ],
          [
            [-180, 10.5],
            [-179, 11],
          ],
        ],
      },
      5,
    );

    expect(actual).toStrictEqual(split);
    expect(new Set(actual)).toEqual(new Set(getAntimeridianOracle(coordinates, 5, 50)));
    expect(new Set(actual).size).toBe(actual.length);
    expect(actual.length).toBeLessThan(100);
  });

  test.each([
    [
      [179.99, 10],
      [179.995, 10.01],
    ],
    [
      [-179.99, 10],
      [-179.995, 10.01],
    ],
    [
      [180, 10],
      [-180, 10.01],
    ],
    [
      [179.99, 10],
      [180, 10.01],
      [-179.99, 10.02],
      [179.99, 10],
    ],
    [
      [179.99, 75],
      [-179.99, 75.01],
    ],
    [
      [179.99, -75],
      [-179.99, -75.01],
    ],
  ])("handles seam-adjacent cells and repeated crossings: %j", (...coordinates) => {
    const actual = getH3CellsAlongCoordinates([coordinates], 8);
    expect(new Set(actual)).toEqual(new Set(getAntimeridianOracle(coordinates, 8, 20)));
  });

  test("treats +180 and -180 as the same point", () => {
    expect(
      getH3CellsAlongCoordinates(
        [
          [
            [180, 10],
            [-180, 10],
          ],
        ],
        8,
      ),
    ).toStrictEqual([latLngToCell(10, 180, 8)]);
  });

  test.each([12, 15])("keeps short crossing order at resolution %i", (resolution) => {
    const coordinates: Position[] = [
      [179.999999, 10],
      [-179.999999, 10.000001],
    ];
    const actual = getH3CellsAlongCoordinates([coordinates], resolution);

    expect(new Set(actual)).toEqual(new Set(getAntimeridianOracle(coordinates, resolution, 8)));
    expect(getH3CellsAlongCoordinates([[...coordinates].reverse()], resolution)).toStrictEqual(
      [...actual].reverse(),
    );
  });
});
