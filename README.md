# h3-along

Find the H3 cells along GeoJSON `LineString` and `MultiLineString` geometries
or Features.

## Installation

```bash
pnpm add h3-along
```

## Usage

```ts
import { getH3CellsAlong } from "h3-along";

const cells = getH3CellsAlong(
  {
    type: "LineString",
    coordinates: [
      [-3.7038, 40.4168],
      [-4.0273, 39.8628],
    ],
  },
  8,
);
```

The package also exports `getH3CellsAlongLineString` and
`getH3CellsAlongMultiLineString`. Results are unique and preserve the order in
which cells are first encountered. H3 resolutions from `0` to `15` are
supported.

## Development

```bash
pnpm install
vp test
vp check
vp run build
```
