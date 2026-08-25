import type { StonePolygon, StonePlaneRole, StoneVec3 } from "./StoneClipper";
import {
  STONE_DEGENERATE_NORMAL_LENGTH,
  STONE_MESH_QUANTIZE,
  type StoneFacetSoftening,
} from "./StoneGeometryTuning";

export interface WorkingStoneFace {
  role: StonePlaneRole;
  planeId: string;
  points: StoneVec3[];
  shared: number[];
  normalX: number;
  normalY: number;
  normalZ: number;
}

export function calculateStonePolygonAreaAndNormal(
  polygon: StonePolygon,
): readonly [number, number, number, number] {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let corner = 0; corner < polygon.points.length; corner += 1) {
    const current = polygon.points[corner];
    const next = polygon.points[(corner + 1) % polygon.points.length];
    nx += (current.y - next.y) * (current.z + next.z);
    ny += (current.z - next.z) * (current.x + next.x);
    nz += (current.x - next.x) * (current.y + next.y);
  }
  const length = Math.hypot(nx, ny, nz);
  if (!(length > STONE_DEGENERATE_NORMAL_LENGTH)) {
    return [0, 0, 1, 0];
  }
  return [length * 0.5, nx / length, ny / length, nz / length];
}

export function buildWorkingStoneFaces(
  polygons: readonly StonePolygon[],
): WorkingStoneFace[] {
  const sharedIndex = new Map<string, number>();
  let nextShared = 0;
  const faces: WorkingStoneFace[] = [];

  for (const polygon of polygons) {
    const points = removeCollinearCorners(polygon.points);
    if (points.length < 3) continue;
    let newellX = 0;
    let newellY = 0;
    let newellZ = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      newellX += (current.y - next.y) * (current.z + next.z);
      newellY += (current.z - next.z) * (current.x + next.x);
      newellZ += (current.x - next.x) * (current.y + next.y);
    }
    const length = Math.hypot(newellX, newellY, newellZ);
    if (!(length > STONE_DEGENERATE_NORMAL_LENGTH)) continue;

    const shared: number[] = [];
    for (const point of points) {
      const key = `${Math.round(point.x / STONE_MESH_QUANTIZE)}:${Math.round(
        point.y / STONE_MESH_QUANTIZE,
      )}:${Math.round(point.z / STONE_MESH_QUANTIZE)}`;
      let index = sharedIndex.get(key);
      if (index === undefined) {
        index = nextShared;
        sharedIndex.set(key, index);
        nextShared += 1;
      }
      shared.push(index);
    }

    faces.push({
      role: polygon.role,
      planeId: polygon.planeId,
      points,
      shared,
      normalX: newellX / length,
      normalY: newellY / length,
      normalZ: newellZ / length,
    });
  }
  return faces;
}

/**
 * Signed dihedral sharpness per welded edge: positive on ridges, negative in
 * creases. Notches and cut junctions produce both, and they want opposite
 * treatments — a ridge catches light, a crease traps shadow — so the sign has
 * to survive rather than being flattened by an unsigned angle.
 */
export function buildStoneEdgeSharpness(
  faces: readonly WorkingStoneFace[],
  softening: StoneFacetSoftening,
): Map<string, number> {
  interface EdgeFace {
    normalX: number;
    normalY: number;
    normalZ: number;
    centerX: number;
    centerY: number;
    centerZ: number;
  }
  const firstFace = new Map<string, EdgeFace>();
  const sharpness = new Map<string, number>();

  for (const face of faces) {
    const count = face.shared.length;
    const center = faceCenter(face);
    for (let index = 0; index < count; index += 1) {
      const a = face.shared[index];
      const b = face.shared[(index + 1) % count];
      if (a === b) continue;
      const key = sharedPairKey(a, b);
      const existing = firstFace.get(key);
      if (!existing) {
        firstFace.set(key, {
          normalX: face.normalX,
          normalY: face.normalY,
          normalZ: face.normalZ,
          centerX: center[0],
          centerY: center[1],
          centerZ: center[2],
        });
        continue;
      }
      const dot =
        existing.normalX * face.normalX +
        existing.normalY * face.normalY +
        existing.normalZ * face.normalZ;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      const magnitude = smoothstep(
        angle,
        softening.wearAngleStart,
        softening.wearAngleFull,
      );
      // The first face's centre against the second face's plane: behind it the
      // pair folds outward (a ridge), in front of it the pair folds inward.
      const corner = face.points[index];
      const side =
        (existing.centerX - corner.x) * face.normalX +
        (existing.centerY - corner.y) * face.normalY +
        (existing.centerZ - corner.z) * face.normalZ;
      sharpness.set(key, side > 0 ? -magnitude : magnitude);
    }
  }
  return sharpness;
}

function faceCenter(
  face: WorkingStoneFace,
): readonly [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of face.points) {
    x += point.x;
    y += point.y;
    z += point.z;
  }
  const inverse = 1 / face.points.length;
  return [x * inverse, y * inverse, z * inverse];
}

export function countSharedStoneFacePairs(
  faces: readonly WorkingStoneFace[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const face of faces) {
    for (let a = 0; a < face.shared.length; a += 1) {
      for (let b = a + 1; b < face.shared.length; b += 1) {
        const key = sharedPairKey(face.shared[a], face.shared[b]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export function chooseStoneFanRoot(
  face: WorkingStoneFace,
  sharedFacePairs: ReadonlyMap<string, number>,
): number {
  const corners = face.shared.length;
  for (let root = 0; root < corners; root += 1) {
    let safe = true;
    for (let offset = 2; offset < corners - 1; offset += 1) {
      const other = (root + offset) % corners;
      if (
        (sharedFacePairs.get(
          sharedPairKey(face.shared[root], face.shared[other]),
        ) ?? 0) > 1
      ) {
        safe = false;
        break;
      }
    }
    if (safe) return root;
  }
  return 0;
}

function sharedPairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function removeCollinearCorners(source: readonly StoneVec3[]): StoneVec3[] {
  if (source.length <= 3) return [...source];
  const points = [...source];
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let index = 0; index < points.length; index += 1) {
      const previous = points[(index + points.length - 1) % points.length];
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const ax = current.x - previous.x;
      const ay = current.y - previous.y;
      const az = current.z - previous.z;
      const bx = next.x - current.x;
      const by = next.y - current.y;
      const bz = next.z - current.z;
      const lengthProduct = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz);
      const crossLength = Math.hypot(
        ay * bz - az * by,
        az * bx - ax * bz,
        ax * by - ay * bx,
      );
      if (
        lengthProduct > STONE_DEGENERATE_NORMAL_LENGTH &&
        ax * bx + ay * by + az * bz >= 0 &&
        crossLength <= lengthProduct * 1e-8
      ) {
        points.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return points;
}

function smoothstep(value: number, minimum: number, maximum: number): number {
  if (value <= minimum) return 0;
  if (value >= maximum) return 1;
  const amount = (value - minimum) / (maximum - minimum);
  return amount * amount * (3 - 2 * amount);
}
