import { BufferGeometry, Float32BufferAttribute } from 'three';

const SURFACE_ORDER = ['asphalt', 'paving', 'gravel'];
const EPSILON = 1e-8;

function bounds(points) {
  const xs = points.map(([x]) => x);
  const zs = points.map(([, z]) => z);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

function overlaps(a, b) {
  return (
    a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ
  );
}

function splitPolygon(points, distance) {
  const inside = [];
  const outside = [];
  let previous = points.at(-1);
  let previousDistance = distance(previous);
  for (const point of points) {
    const nextDistance = distance(point);
    if (
      (previousDistance > EPSILON && nextDistance < -EPSILON) ||
      (previousDistance < -EPSILON && nextDistance > EPSILON)
    ) {
      const t = previousDistance / (previousDistance - nextDistance);
      const edge = [
        previous[0] + (point[0] - previous[0]) * t,
        previous[1] + (point[1] - previous[1]) * t,
      ];
      inside.push(edge);
      outside.push(edge);
    }
    if (nextDistance >= -EPSILON) inside.push(point);
    if (nextDistance <= EPSILON) outside.push(point);
    previous = point;
    previousDistance = nextDistance;
  }
  return [inside, outside];
}

// Each road footprint is convex. Retain the pieces outside its edges and omit the intersection.
function subtractRoad(points, road) {
  if (!overlaps(bounds(points), road.bounds)) return [points];
  const pieces = [];
  for (let i = 0; i < road.corners.length && points.length >= 3; i++) {
    const [ax, az] = road.corners[i];
    const [bx, bz] = road.corners[(i + 1) % road.corners.length];
    const [inside, outside] = splitPolygon(
      points,
      ([x, z]) => (bx - ax) * (z - az) - (bz - az) * (x - ax),
    );
    if (outside.length >= 3) pieces.push(outside);
    points = inside;
  }
  return pieces;
}

function roadSegment([
  ax,
  az,
  bx,
  bz,
  width,
  followsTerrain,
  surface = 'paving',
]) {
  const length = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / length;
  const dz = (bz - az) / length;
  const x = (ax + bx) / 2;
  const z = (az + bz) / 2;
  const end = length / 2 + width / 4;
  const side = width / 2;
  const corners = [
    [-end, -side],
    [end, -side],
    [end, side],
    [-end, side],
  ].map(([along, across]) => [
    x + dx * along - dz * across,
    z + dz * along + dx * across,
  ]);
  return {
    x,
    z,
    dx,
    dz,
    corners,
    bounds: bounds(corners),
    followsTerrain,
    surface,
  };
}

// Split terrain-following roads at the same grid edges and diagonals as the terrain.
function terrainPieces(points, origin, step) {
  const { minX, maxX, minZ, maxZ } = bounds(points);
  const pieces = [];
  for (
    let col = Math.floor((minX - origin) / step);
    origin + col * step < maxX;
    col++
  ) {
    const x = origin + col * step;
    let [strip] = splitPolygon(points, ([px]) => px - x);
    if (strip.length < 3) continue;
    [strip] = splitPolygon(strip, ([px]) => x + step - px);
    if (strip.length < 3) continue;

    for (
      let row = Math.floor((minZ - origin) / step);
      origin + row * step < maxZ;
      row++
    ) {
      const z = origin + row * step;
      let [cell] = splitPolygon(strip, ([, pz]) => pz - z);
      if (cell.length < 3) continue;
      [cell] = splitPolygon(cell, ([, pz]) => z + step - pz);
      if (cell.length < 3) continue;
      pieces.push(
        ...splitPolygon(cell, ([px, pz]) => px - x + (pz - z) - step),
      );
    }
  }
  return pieces;
}

export function createRoadSurfaces(
  paths,
  { height, terrainSurface, terrainSize, terrainSegments },
) {
  const roads = paths.map(roadSegment);
  const painted = [];
  const surfaces = [];
  for (const surface of SURFACE_ORDER) {
    for (const road of roads) {
      if (road.surface !== surface) continue;
      let pieces = [road.corners];
      for (const higher of painted) {
        if (overlaps(road.bounds, higher.bounds)) {
          pieces = pieces.flatMap((piece) => subtractRoad(piece, higher));
          if (!pieces.length) break;
        }
      }
      painted.push(road);

      if (road.followsTerrain) {
        pieces = pieces.flatMap((points) =>
          terrainPieces(
            points,
            -terrainSize / 2,
            terrainSize / terrainSegments,
          ),
        );
      }
      const positions = [];
      const uvs = [];
      const tile = surface === 'paving' ? 4 : 7;
      for (const points of pieces) {
        for (let i = 1; i < points.length - 1; i++) {
          const [a, b, c] = [points[0], points[i], points[i + 1]];
          const area =
            (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
          if (area <= EPSILON) continue;
          // Counterclockwise in the xz plane faces down, so reverse it for the road top.
          for (const [x, z] of [a, c, b]) {
            const ground = road.followsTerrain ? terrainSurface(x, z) : 0;
            positions.push(x, ground + height, z);
            const px = x - road.x;
            const pz = z - road.z;
            uvs.push(
              (px * road.dx + pz * road.dz) / tile,
              (pz * road.dx - px * road.dz) / tile,
            );
          }
        }
      }
      if (!positions.length) continue;
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        'position',
        new Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
      geometry.computeVertexNormals();
      surfaces.push({ geometry, surface });
    }
  }
  return surfaces;
}
