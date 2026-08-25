import type { StoneVec3 } from "./StoneClipper";
import { buildStonePolyhedron, facesFromPlanes } from "./StoneClipper";
import { addStoneFractureRelief } from "./StoneFractureRelief";
import { STONE_SNAP_EPSILON } from "./StoneGeometryTuning";
import { addStoneIndentation } from "./StoneIndentation";
import type { StoneRecipe } from "./StoneRecipe";

export interface StoneMaterialFrame {
  readonly height: number;
  readonly footprintRadius: number;
}

export interface StoneContactOffset {
  readonly x: number;
  readonly z: number;
}

export function transformStonePoints(
  polygons: ReturnType<typeof buildStonePolyhedron>,
  recipe: StoneRecipe,
): Set<StoneVec3> {
  const uniquePoints = new Set<StoneVec3>();
  for (const polygon of polygons) {
    for (const point of polygon.points) {
      uniquePoints.add(point);
    }
  }
  for (const point of uniquePoints) {
    const shearedX = point.x + recipe.leanX * point.y;
    const shearedZ = point.z + recipe.leanZ * point.y;
    point.x = recipe.width * shearedX;
    point.y = recipe.height * point.y;
    point.z = recipe.depth * shearedZ;
    if (Math.abs(point.y) <= STONE_SNAP_EPSILON) {
      point.y = 0;
    }
  }
  return uniquePoints;
}

/**
 * Keeps material coordinates stable when close geometry adds chips or a
 * fracture renders only one piece of its parent body.
 */
export function resolveStableStoneMaterialFrame(
  recipe: StoneRecipe,
  includeChips: boolean,
): StoneMaterialFrame | undefined {
  const inherited = recipe.inheritedSurface;
  if (recipe.fracture && inherited) {
    const parentFaces = facesFromPlanes([...inherited.coarse]);
    return measureMaterialFrame(transformStonePoints(parentFaces, recipe));
  }
  if (!includeChips) {
    return undefined;
  }

  const coarsePolygons = addStoneFractureRelief(
    addStoneIndentation(buildStonePolyhedron(recipe, false), recipe),
    recipe,
  );
  const coarsePoints = transformStonePoints(coarsePolygons, recipe);
  centerStoneContact(coarsePolygons, coarsePoints);
  return measureMaterialFrame(coarsePoints);
}

/** Centres a body on its contact polygon and reports the shift applied. */
export function centerStoneContact(
  polygons: ReturnType<typeof buildStonePolyhedron>,
  uniquePoints: ReadonlySet<StoneVec3>,
): StoneContactOffset {
  let area2Total = 0;
  let cxTotal = 0;
  let czTotal = 0;
  for (const polygon of polygons) {
    if (polygon.role !== "bottom") {
      continue;
    }
    const points = polygon.points;
    const count = points.length;
    for (let index = 0; index < count; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % count];
      const cross = current.x * next.z - next.x * current.z;
      area2Total += cross;
      cxTotal += (current.x + next.x) * cross;
      czTotal += (current.z + next.z) * cross;
    }
  }

  if (Math.abs(area2Total) < 1e-9) {
    return centerStoneContactFromCorners(polygons, uniquePoints);
  }

  const contactX = cxTotal / (3 * area2Total);
  const contactZ = czTotal / (3 * area2Total);
  shiftStonePoints(uniquePoints, contactX, contactZ);
  return { x: contactX, z: contactZ };
}

function measureMaterialFrame(
  points: ReadonlySet<StoneVec3>,
): StoneMaterialFrame | undefined {
  let height = 0;
  let footprintRadius = 0;
  for (const point of points) {
    height = Math.max(height, point.y);
    footprintRadius = Math.max(footprintRadius, Math.hypot(point.x, point.z));
  }
  if (!(height > 0) || !(footprintRadius > 0)) {
    return undefined;
  }
  return { height, footprintRadius };
}

function centerStoneContactFromCorners(
  polygons: ReturnType<typeof buildStonePolyhedron>,
  uniquePoints: ReadonlySet<StoneVec3>,
): StoneContactOffset {
  let contactX = 0;
  let contactZ = 0;
  let contactCount = 0;
  for (const polygon of polygons) {
    if (polygon.role !== "bottom") {
      continue;
    }
    for (const point of polygon.points) {
      contactX += point.x;
      contactZ += point.z;
      contactCount += 1;
    }
  }
  if (contactCount === 0) {
    return { x: 0, z: 0 };
  }

  contactX /= contactCount;
  contactZ /= contactCount;
  shiftStonePoints(uniquePoints, contactX, contactZ);
  return { x: contactX, z: contactZ };
}

function shiftStonePoints(
  points: ReadonlySet<StoneVec3>,
  offsetX: number,
  offsetZ: number,
): void {
  for (const point of points) {
    point.x -= offsetX;
    point.z -= offsetZ;
  }
}
