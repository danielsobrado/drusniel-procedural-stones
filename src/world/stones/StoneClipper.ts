import type { StonePlaneRole, StoneRecipe } from "./StoneRecipe";
import { hashStoneCell } from "./StoneRandom";

/** Convex polyhedron construction from deterministic half-spaces. */
export type { StonePlaneRole };

export interface StonePlane {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly constant: number;
  readonly id: string;
  readonly role: StonePlaneRole;
}

export interface StoneVec3 {
  x: number;
  y: number;
  z: number;
}

export interface StonePolygon {
  readonly planeId: string;
  readonly role: StonePlaneRole;
  readonly points: StoneVec3[];
}

const PLANE_EPSILON = 1e-7;
const POINT_MERGE_EPSILON = 2.5e-4;
const MINIMUM_FACE_AREA = 5e-6;
const MAX_HEAL_PASSES = 4;
const HEAL_RADIUS = 1.2e-2;
const FACE_QUAD_EXTENT = 6;
const CUT_GROUND_CLEARANCE = 0.02;
const CUT_MINIMUM_EFFECTIVE_DEPTH = 0.015;
const CHIP_MINIMUM_EFFECTIVE_DEPTH = 0.004;
// A cut has to take a real share of the surface before it reads as a fracture
// face rather than a scratch across one. At 0.055 a "major" cut could take a
// twentieth of the body and still count.
const MINIMUM_MAJOR_CUT_AREA_SHARE = 0.09;
/**
 * Arris softening.
 *
 * The bevel is what puts a lit sliver along the silhouette when the sun comes
 * across a stone: a plane meeting a plane at a mathematical edge takes one
 * lighting value on each side and none between, which is the read that gives a
 * generated rock away. Sampling a fifth of the edges left most of the
 * silhouette mathematically sharp and made the softening look like damage on
 * random arrises rather than weathering of the whole body, so every edge that
 * clears the length and dihedral gates now takes one, and the per-edge hash
 * spends itself on depth instead of on acceptance.
 *
 * Depths are fractions of the unit footprint radius (0.5), so 0.0125–0.025
 * covers 2.5–5% of local radius: wide enough to catch light at the distance
 * stones are actually seen from, narrow enough that the large planes the
 * archetypes exist to show still meet almost directly.
 */
const EDGE_CHAMFER_DEPTH_MIN = 0.0125;
const EDGE_CHAMFER_DEPTH_MAX = 0.025;
/**
 * Shortest edge worth a bevel, per level of detail.
 *
 * Bevelling every qualifying edge on both meshes roughly doubled the triangle
 * potential of the field, and most of that spend lands on short interior
 * arrises that a distant stone never resolves. The close mesh keeps the low
 * threshold and softens the whole body; the coarse mesh bevels only edges long
 * enough to be silhouette, which is the part of the effect that survives the
 * distance at which it is drawn.
 */
const EDGE_CHAMFER_MIN_LENGTH_DETAIL = 0.24;
const EDGE_CHAMFER_MIN_LENGTH_COARSE = 0.34;
/**
 * Weathering history per family, hardest last.
 *
 * A tumbled pebble has had every arris worn; a shard broke recently and its
 * edges are still nearly true. Shards are no longer skipped outright — an
 * unbevelled body reads as flat-shaded geometry from any angle — but they take
 * the narrowest bevel of the set, small enough to catch a highlight without
 * claiming a weathering history the family does not have.
 */
const EDGE_CHAMFER_SCALE: Record<StoneRecipe["archetype"], number> = {
  pebble: 1.1,
  boulder: 1,
  outcrop: 0.95,
  slab: 0.85,
  block: 0.8,
  shard: 0.5,
};
const FACE_HIERARCHY_TOLERANCE = 0.015;
const PROFILE_MIN_HEIGHT_GAP = 0.06;
/**
 * How far past tangency a grounded profile plane is pushed. Exact tangency
 * leaves a zero-width sliver face that relief displacement can overturn, and
 * an outward push only ever makes a half-space less cutting, so clearing the
 * contact ring generously costs nothing.
 */
export const PROFILE_GROUND_CLEARANCE = 0.01;

const RIDGE_CHANCE: Record<StoneRecipe["archetype"], number> = {
  pebble: 0.08,
  boulder: 0.18,
  slab: 0.82,
  block: 0.2,
  shard: 0,
  outcrop: 0.88,
};
/** Broad boulder crowns increasingly need a second plane to avoid a sawn lid. */
const BOULDER_BROAD_ROOF_RIDGE_BOOST = 0.55;
const BOULDER_TOP_SCALE_MIN = 0.74;
const BOULDER_TOP_SCALE_MAX = 0.94;
/** Capstones retain a broad roof; this is only a shallow geological hinge. */
const CAPSTONE_ROOF_BREAK_STRENGTH = 0.08;

function normalizePlane(
  nx: number,
  ny: number,
  nz: number,
  constant: number,
  id: string,
  role: StonePlaneRole,
): StonePlane {
  const length = Math.hypot(nx, ny, nz);
  return {
    nx: nx / length,
    ny: ny / length,
    nz: nz / length,
    constant: constant / length,
    id,
    role,
  };
}

function profileHeights(recipe: StoneRecipe, side: number): number[] {
  const rings = recipe.profileRings;
  const heights = new Array<number>(rings.length);
  heights[0] = 0;
  for (let index = 1; index < rings.length - 1; index += 1) {
    const remaining = rings.length - 1 - index;
    const maximum = 1 - remaining * PROFILE_MIN_HEIGHT_GAP;
    const raw = rings[index].height + rings[index].heightOffsets[side];
    heights[index] = Math.min(
      maximum,
      Math.max(heights[index - 1] + PROFILE_MIN_HEIGHT_GAP, raw),
    );
  }
  heights[rings.length - 1] = 1;
  return heights;
}

function resolveTopBreakAxis(recipe: StoneRecipe): readonly [number, number] {
  const axisRoll =
    hashStoneCell(recipe.seed, 0x41786973, 0x52696467) / 4294967296;
  const acrossAngle =
    recipe.archetype === "slab" || recipe.archetype === "outcrop"
      ? (axisRoll - 0.5) * 0.55
      : axisRoll * Math.PI * 2;
  return [Math.cos(acrossAngle), Math.sin(acrossAngle)];
}

function addPairedTopPlanes(
  planes: StonePlane[],
  recipe: StoneRecipe,
  slope: number,
  idPrefix: string,
  centerHinge = false,
): void {
  const [acrossX, acrossZ] = resolveTopBreakAxis(recipe);
  const topRing = recipe.profileRings[recipe.profileRings.length - 1];
  // Put the hinge through the authored crown centre. A ridge through object
  // origin can leave one plane as a tiny sliver after profile centre-wander.
  const hingeOffset = centerHinge
    ? slope * (acrossX * topRing.centerX + acrossZ * topRing.centerZ)
    : 0;
  planes.push(
    normalizePlane(
      recipe.topTiltX + acrossX * slope,
      1,
      recipe.topTiltZ + acrossZ * slope,
      1 + hingeOffset,
      `${idPrefix}:0`,
      "top",
    ),
    normalizePlane(
      recipe.topTiltX - acrossX * slope,
      1,
      recipe.topTiltZ - acrossZ * slope,
      1 - hingeOffset,
      `${idPrefix}:1`,
      "top",
    ),
  );
}

function addTopPlanes(planes: StonePlane[], recipe: StoneRecipe): void {
  const ridgeRoll =
    hashStoneCell(recipe.seed, 0x52696467, 0x546f7052) / 4294967296;

  // A capstone still reads as one broad, flattened crown. The shallow paired
  // planes only remove the uninterrupted horizontal cut that made it look
  // manufactured; they are deliberately much weaker than a slab ridge.
  if (recipe.silhouetteVariant === "capstone") {
    addPairedTopPlanes(
      planes,
      recipe,
      CAPSTONE_ROOF_BREAK_STRENGTH * (0.85 + ridgeRoll * 0.3),
      "top-capstone-break",
      true,
    );
    return;
  }

  let ridgeChance = RIDGE_CHANCE[recipe.archetype];
  if (recipe.archetype === "boulder") {
    const broadness = Math.min(
      1,
      Math.max(
        0,
        (recipe.topScale - BOULDER_TOP_SCALE_MIN) /
          (BOULDER_TOP_SCALE_MAX - BOULDER_TOP_SCALE_MIN),
      ),
    );
    ridgeChance += broadness * BOULDER_BROAD_ROOF_RIDGE_BOOST;
  }
  if (ridgeRoll >= ridgeChance) {
    planes.push(
      normalizePlane(recipe.topTiltX, 1, recipe.topTiltZ, 1, "top", "top"),
    );
    return;
  }

  const familyStrength =
    recipe.archetype === "slab" || recipe.archetype === "outcrop" ? 0.19 : 0.13;
  const ridgeSlope = familyStrength * (0.72 + ridgeRoll * 0.72);
  addPairedTopPlanes(planes, recipe, ridgeSlope, "top-ridge");
}

/**
 * Build the layered macro body. Each radial sector contributes four planes:
 * contact→belly, belly→shoulder, shoulder→crown, and crown→top. The support
 * radius and centre both change between rings, so silhouettes turn repeatedly
 * through the height instead of exposing one long extruded wall.
 */
export function buildStonePlanes(recipe: StoneRecipe): StonePlane[] {
  const planes: StonePlane[] = [
    {
      nx: 0,
      ny: -1,
      nz: 0,
      constant: 0,
      id: "bottom",
      role: "bottom",
    },
  ];
  addTopPlanes(planes, recipe);

  const rings = recipe.profileRings;
  const sideCount = recipe.sideAngles.length;
  for (let side = 0; side < sideCount; side += 1) {
    const angle = recipe.sideAngles[side];
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const heights = profileHeights(recipe, side);
    const contactSupport =
      rings[0].radii[side] + nx * rings[0].centerX + nz * rings[0].centerZ;

    for (let segment = 0; segment < rings.length - 1; segment += 1) {
      const lower = rings[segment];
      const upper = rings[segment + 1];
      const lowerHeight = heights[segment];
      const upperHeight = heights[segment + 1];
      const heightSpan = Math.max(
        PROFILE_MIN_HEIGHT_GAP,
        upperHeight - lowerHeight,
      );
      const lowerSupport =
        lower.radii[side] + nx * lower.centerX + nz * lower.centerZ;
      const upperSupport =
        upper.radii[side] + nx * upper.centerX + nz * upper.centerZ;
      const ny = (lowerSupport - upperSupport) / heightSpan;
      // A segment is exact only between its own two rings; below the lower one
      // it keeps extrapolating. A flaring crown anchored high on a narrow ring
      // therefore reaches y = 0 with a far smaller -- sometimes negative --
      // support and slices the contact polygon away, leaving the stone
      // hovering. The profile's slope bound cannot prevent this on its own,
      // because clamping a ring radius bottoms out at MIN_RADIUS and the
      // offending slope survives. Ring 0 is the ground contact, so no profile
      // plane may reach inside its support along its own direction; a plane
      // pushed out to tangency simply stops cutting, which is the only
      // resolution a single half-space allows.
      const constant =
        segment === 0
          ? lowerSupport + ny * lowerHeight
          : Math.max(
              lowerSupport + ny * lowerHeight,
              contactSupport + PROFILE_GROUND_CLEARANCE,
            );
      const role: StonePlaneRole =
        segment === 0
          ? "contact-bevel"
          : segment === rings.length - 2
            ? "top-bevel"
            : "side";
      planes.push(
        normalizePlane(
          nx,
          ny,
          nz,
          constant,
          `profile:${segment}:${side}`,
          role,
        ),
      );
    }
  }
  return planes;
}

function planeDistance(plane: StonePlane, point: StoneVec3): number {
  return (
    plane.nx * point.x +
    plane.ny * point.y +
    plane.nz * point.z -
    plane.constant
  );
}

function nearlySame(a: StoneVec3, b: StoneVec3): boolean {
  return (
    Math.abs(a.x - b.x) <= POINT_MERGE_EPSILON &&
    Math.abs(a.y - b.y) <= POINT_MERGE_EPSILON &&
    Math.abs(a.z - b.z) <= POINT_MERGE_EPSILON
  );
}

function cleanPolygonPoints(points: StoneVec3[]): StoneVec3[] {
  const cleaned: StoneVec3[] = [];
  for (const point of points) {
    if (
      cleaned.length === 0 ||
      !nearlySame(cleaned[cleaned.length - 1], point)
    ) {
      cleaned.push(point);
    }
  }
  while (
    cleaned.length > 1 &&
    nearlySame(cleaned[0], cleaned[cleaned.length - 1])
  ) {
    cleaned.pop();
  }
  return cleaned;
}

function polygonArea(points: StoneVec3[]): number {
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
  return Math.hypot(newellX, newellY, newellZ) * 0.5;
}

function faceHierarchyScore(faces: StonePolygon[]): number {
  const areas = faces
    .filter(
      (face) =>
        face.role !== "bottom" &&
        face.role !== "contact-bevel" &&
        face.role !== "edge-bevel",
    )
    .map((face) => polygonArea(face.points))
    .sort((left, right) => right - left);
  const total = areas.reduce((sum, area) => sum + area, 0);
  if (!(total > 0)) return 0;
  const primaryShare =
    areas.slice(0, 5).reduce((sum, area) => sum + area, 0) / total;
  const tinyShare =
    areas
      .filter((area) => area / total < 0.025)
      .reduce((sum, area) => sum + area, 0) / total;
  return primaryShare - tinyShare * 0.8;
}

function clipPolygonByHalfSpace(
  points: StoneVec3[],
  plane: StonePlane,
): StoneVec3[] {
  const clipped: StoneVec3[] = [];
  const count = points.length;
  for (let index = 0; index < count; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % count];
    const currentDistance = planeDistance(plane, current);
    const nextDistance = planeDistance(plane, next);
    const currentInside = currentDistance <= PLANE_EPSILON;
    const nextInside = nextDistance <= PLANE_EPSILON;

    if (currentInside) clipped.push(current);
    if (currentInside !== nextInside) {
      const denominator = currentDistance - nextDistance;
      if (Math.abs(denominator) > PLANE_EPSILON) {
        const t = Math.min(1, Math.max(0, currentDistance / denominator));
        clipped.push({
          x: current.x + (next.x - current.x) * t,
          y: current.y + (next.y - current.y) * t,
          z: current.z + (next.z - current.z) * t,
        });
      }
    }
  }
  return clipped;
}

function seedQuadOnPlane(plane: StonePlane): StoneVec3[] {
  const absX = Math.abs(plane.nx);
  const absY = Math.abs(plane.ny);
  const absZ = Math.abs(plane.nz);
  let referenceX = 0;
  let referenceY = 0;
  let referenceZ = 0;
  if (absX <= absY && absX <= absZ) referenceX = 1;
  else if (absY <= absZ) referenceY = 1;
  else referenceZ = 1;

  let tangentX = referenceY * plane.nz - referenceZ * plane.ny;
  let tangentY = referenceZ * plane.nx - referenceX * plane.nz;
  let tangentZ = referenceX * plane.ny - referenceY * plane.nx;
  const tangentLength = Math.hypot(tangentX, tangentY, tangentZ);
  tangentX /= tangentLength;
  tangentY /= tangentLength;
  tangentZ /= tangentLength;
  const bitangentX = plane.ny * tangentZ - plane.nz * tangentY;
  const bitangentY = plane.nz * tangentX - plane.nx * tangentZ;
  const bitangentZ = plane.nx * tangentY - plane.ny * tangentX;

  const centerX = plane.nx * plane.constant;
  const centerY = plane.ny * plane.constant;
  const centerZ = plane.nz * plane.constant;
  const corner = (tangentSign: number, bitangentSign: number): StoneVec3 => ({
    x:
      centerX +
      (tangentX * tangentSign + bitangentX * bitangentSign) * FACE_QUAD_EXTENT,
    y:
      centerY +
      (tangentY * tangentSign + bitangentY * bitangentSign) * FACE_QUAD_EXTENT,
    z:
      centerZ +
      (tangentZ * tangentSign + bitangentZ * bitangentSign) * FACE_QUAD_EXTENT,
  });
  const quad = [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)];

  let newellX = 0;
  let newellY = 0;
  let newellZ = 0;
  for (let index = 0; index < quad.length; index += 1) {
    const current = quad[index];
    const next = quad[(index + 1) % quad.length];
    newellX += (current.y - next.y) * (current.z + next.z);
    newellY += (current.z - next.z) * (current.x + next.x);
    newellZ += (current.x - next.x) * (current.y + next.y);
  }
  if (newellX * plane.nx + newellY * plane.ny + newellZ * plane.nz < 0) {
    quad.reverse();
  }
  return quad;
}

export function facesFromPlanes(planes: StonePlane[]): StonePolygon[] {
  const welded = weldFaces(buildFacesOnce(planes));
  const substantial = welded.filter(
    (face) => polygonArea(face.points) >= MINIMUM_FACE_AREA,
  );
  return healBoundaryGaps(substantial);
}

/**
 * Close non-manifold gaps left by near-coincident planes.
 *
 * Break-face corners are pinned. A mated pair is one body clipped by a plane
 * and its negation, so both halves see an identical plane set and their break
 * outlines are identical the moment they leave the clipper. Healing is where
 * that stopped being true: the representative for a cluster was whichever
 * suspect the iteration reached first, and iteration order follows the face
 * list, which is *not* the same on the two halves. A rim corner could be
 * pulled onto a neighbour on one half and left alone on the other, and the
 * pair no longer met. Rim corners may be snapped *to*; they are never moved.
 */
function healBoundaryGaps(faces: StonePolygon[]): StonePolygon[] {
  const pinned = new Set<StoneVec3>();
  for (const face of faces) {
    if (face.role !== "fracture") continue;
    for (const point of face.points) pinned.add(point);
  }
  let current = faces;
  for (let pass = 0; pass < MAX_HEAL_PASSES; pass += 1) {
    const counts = new Map<string, number>();
    for (const face of current) {
      const count = face.points.length;
      for (let index = 0; index < count; index += 1) {
        const key = edgeKey(
          face.points[index],
          face.points[(index + 1) % count],
        );
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    const suspects = new Set<StoneVec3>();
    for (const face of current) {
      const count = face.points.length;
      for (let index = 0; index < count; index += 1) {
        const a = face.points[index];
        const b = face.points[(index + 1) % count];
        if (counts.get(edgeKey(a, b)) !== 2) {
          suspects.add(a);
          suspects.add(b);
        }
      }
    }
    if (suspects.size === 0) return current;

    const representatives = new Map<StoneVec3, StoneVec3>();
    // Pinned corners are representatives before anything else is considered,
    // so a cluster containing one always collapses onto it.
    const chosen: StoneVec3[] = [];
    for (const suspect of suspects) {
      if (pinned.has(suspect)) chosen.push(suspect);
    }
    // Order the rest by position rather than by face order. The clipper emits
    // faces in plane order, which two fragments of one body do not share.
    const ordered = [...suspects].filter((point) => !pinned.has(point));
    ordered.sort(
      (left, right) =>
        left.x - right.x || left.y - right.y || left.z - right.z,
    );
    for (const suspect of ordered) {
      let match: StoneVec3 | undefined;
      for (const candidate of chosen) {
        const dx = candidate.x - suspect.x;
        const dy = candidate.y - suspect.y;
        const dz = candidate.z - suspect.z;
        if (dx * dx + dy * dy + dz * dz <= HEAL_RADIUS * HEAL_RADIUS) {
          match = candidate;
          break;
        }
      }
      if (match) representatives.set(suspect, match);
      else chosen.push(suspect);
    }
    if (representatives.size === 0) return current;

    const healed: StonePolygon[] = [];
    for (const face of current) {
      const points: StoneVec3[] = [];
      for (const point of face.points) {
        const replacement = representatives.get(point) ?? point;
        if (points.length === 0 || points[points.length - 1] !== replacement) {
          points.push(replacement);
        }
      }
      while (points.length > 1 && points[0] === points[points.length - 1]) {
        points.pop();
      }
      if (points.length >= 3) {
        healed.push({ planeId: face.planeId, role: face.role, points });
      }
    }
    current = healed;
  }
  return current;
}

const EDGE_QUANTIZE = 5e-4;
const WELD_EPSILON = 2e-3;

function buildFacesOnce(planes: StonePlane[]): StonePolygon[] {
  const faces: StonePolygon[] = [];
  for (const plane of planes) {
    let points = seedQuadOnPlane(plane);
    for (const other of planes) {
      if (other === plane) continue;
      points = clipPolygonByHalfSpace(points, other);
      if (points.length < 3) break;
    }
    const cleaned = cleanPolygonPoints(points);
    if (cleaned.length >= 3) {
      faces.push({ planeId: plane.id, role: plane.role, points: cleaned });
    }
  }
  return faces;
}

function edgeKey(a: StoneVec3, b: StoneVec3): string {
  const ka = `${Math.round(a.x / EDGE_QUANTIZE)}:${Math.round(a.y / EDGE_QUANTIZE)}:${Math.round(a.z / EDGE_QUANTIZE)}`;
  const kb = `${Math.round(b.x / EDGE_QUANTIZE)}:${Math.round(b.y / EDGE_QUANTIZE)}:${Math.round(b.z / EDGE_QUANTIZE)}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function weldFaces(faces: StonePolygon[]): StonePolygon[] {
  const buckets = new Map<string, StoneVec3[]>();
  const representative = (point: StoneVec3): StoneVec3 => {
    const cellX = Math.round(point.x / WELD_EPSILON);
    const cellY = Math.round(point.y / WELD_EPSILON);
    const cellZ = Math.round(point.z / WELD_EPSILON);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const key = `${cellX + dx}:${cellY + dy}:${cellZ + dz}`;
          const bucket = buckets.get(key);
          if (!bucket) continue;
          for (const existing of bucket) {
            const offsetX = existing.x - point.x;
            const offsetY = existing.y - point.y;
            const offsetZ = existing.z - point.z;
            if (
              offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ <=
              WELD_EPSILON * WELD_EPSILON
            ) {
              return existing;
            }
          }
        }
      }
    }
    const ownKey = `${cellX}:${cellY}:${cellZ}`;
    const ownBucket = buckets.get(ownKey);
    if (ownBucket) ownBucket.push(point);
    else buckets.set(ownKey, [point]);
    return point;
  };

  const welded: StonePolygon[] = [];
  for (const face of faces) {
    const points: StoneVec3[] = [];
    for (const point of face.points) {
      const shared = representative(point);
      if (points.length === 0 || points[points.length - 1] !== shared) {
        points.push(shared);
      }
    }
    while (points.length > 1 && points[0] === points[points.length - 1]) {
      points.pop();
    }
    if (points.length >= 3 && polygonArea(points) >= MINIMUM_FACE_AREA) {
      welded.push({ planeId: face.planeId, role: face.role, points });
    }
  }
  return welded;
}

export function resolveCutPlanes(
  bodyPlanes: StonePlane[],
  recipe: StoneRecipe,
  includeChips = false,
): StonePlane[] {
  const planes = [...bodyPlanes];
  const accepted: StonePlane[] = [];
  const operations = includeChips
    ? [...recipe.cuts, ...recipe.chips]
    : recipe.cuts;
  const firstChip = recipe.cuts.length;

  for (let index = 0; index < operations.length; index += 1) {
    const cut = operations[index];
    const isChip = index >= firstChip;
    const faces = facesFromPlanes(planes);
    let minimumProjection = Number.POSITIVE_INFINITY;
    let maximumProjection = Number.NEGATIVE_INFINITY;
    let maximumGroundProjection = Number.NEGATIVE_INFINITY;
    for (const face of faces) {
      for (const point of face.points) {
        const projection =
          cut.normalX * point.x + cut.normalY * point.y + cut.normalZ * point.z;
        minimumProjection = Math.min(minimumProjection, projection);
        maximumProjection = Math.max(maximumProjection, projection);
        if (Math.abs(point.y) <= POINT_MERGE_EPSILON * 4) {
          maximumGroundProjection = Math.max(
            maximumGroundProjection,
            projection,
          );
        }
      }
    }
    const span = maximumProjection - minimumProjection;
    if (span <= PLANE_EPSILON) continue;

    const candidate = maximumProjection - cut.depthFraction * span;
    const guarded =
      maximumGroundProjection > Number.NEGATIVE_INFINITY
        ? Math.max(candidate, maximumGroundProjection + CUT_GROUND_CLEARANCE)
        : candidate;
    const minimumDepth = isChip
      ? CHIP_MINIMUM_EFFECTIVE_DEPTH
      : CUT_MINIMUM_EFFECTIVE_DEPTH;
    if ((maximumProjection - guarded) / span < minimumDepth) continue;

    const plane: StonePlane = {
      nx: cut.normalX,
      ny: cut.normalY,
      nz: cut.normalZ,
      constant: guarded,
      id: isChip ? `chip:${index - firstChip}` : `cut:${index}`,
      role: "cut",
    };
    if (!isChip && recipe.archetype !== "shard") {
      const candidateFaces = facesFromPlanes([...planes, plane]);
      const exposed = candidateFaces.filter(
        (face) => face.role !== "bottom" && face.role !== "contact-bevel",
      );
      const totalArea = exposed.reduce(
        (sum, face) => sum + polygonArea(face.points),
        0,
      );
      const cutArea = exposed
        .filter((face) => face.planeId === plane.id)
        .reduce((sum, face) => sum + polygonArea(face.points), 0);
      if (
        !(totalArea > 0) ||
        cutArea / totalArea < MINIMUM_MAJOR_CUT_AREA_SHARE
      ) {
        continue;
      }
      if (
        faceHierarchyScore(candidateFaces) <
        faceHierarchyScore(faces) - FACE_HIERARCHY_TOLERANCE
      ) {
        continue;
      }
    }
    planes.push(plane);
    accepted.push(plane);
  }
  return accepted;
}

function addEdgeChamferPlanes(
  planes: StonePlane[],
  recipe: StoneRecipe,
  minimumEdgeLength: number,
): StonePlane[] {
  const faces = facesFromPlanes(planes);
  const planeById = new Map(planes.map((plane) => [plane.id, plane]));
  const edges = new Map<
    string,
    { a: StoneVec3; b: StoneVec3; faces: StonePolygon[] }
  >();
  for (const face of faces) {
    for (let index = 0; index < face.points.length; index += 1) {
      const a = face.points[index];
      const b = face.points[(index + 1) % face.points.length];
      const key = edgeKey(a, b);
      const edge = edges.get(key);
      if (edge) edge.faces.push(face);
      else edges.set(key, { a, b, faces: [face] });
    }
  }

  const chamfers: StonePlane[] = [];
  for (const edge of edges.values()) {
    if (edge.faces.length !== 2) continue;
    const [faceA, faceB] = edge.faces;
    if (
      faceA.role === "bottom" ||
      faceB.role === "bottom" ||
      faceA.role === "contact-bevel" ||
      faceB.role === "contact-bevel" ||
      edge.a.y <= POINT_MERGE_EPSILON * 4 ||
      edge.b.y <= POINT_MERGE_EPSILON * 4
    ) {
      continue;
    }
    if (
      Math.hypot(
        edge.a.x - edge.b.x,
        edge.a.y - edge.b.y,
        edge.a.z - edge.b.z,
      ) < minimumEdgeLength
    ) {
      continue;
    }
    const midpointX = (edge.a.x + edge.b.x) * 0.5;
    const midpointZ = (edge.a.z + edge.b.z) * 0.5;
    const chamferRoll =
      hashStoneCell(
        Math.round(midpointX * 997),
        Math.round(midpointZ * 991),
        recipe.seed ^ 0x4265766c,
      ) / 4294967296;
    const depth =
      (EDGE_CHAMFER_DEPTH_MIN +
        chamferRoll * (EDGE_CHAMFER_DEPTH_MAX - EDGE_CHAMFER_DEPTH_MIN)) *
      EDGE_CHAMFER_SCALE[recipe.archetype];

    const a = planeById.get(faceA.planeId);
    const b = planeById.get(faceB.planeId);
    if (!a || !b) continue;
    const dot = a.nx * b.nx + a.ny * b.ny + a.nz * b.nz;
    if (dot > 0.88) continue;
    const nx = a.nx + b.nx;
    const ny = a.ny + b.ny;
    const nz = a.nz + b.nz;
    const length = Math.hypot(nx, ny, nz);
    if (!(length > 1e-6)) continue;
    const unitX = nx / length;
    const unitY = ny / length;
    const unitZ = nz / length;
    const edgeConstant = unitX * edge.a.x + unitY * edge.a.y + unitZ * edge.a.z;
    let maximumGroundProjection = Number.NEGATIVE_INFINITY;
    for (const face of faces) {
      for (const point of face.points) {
        if (Math.abs(point.y) <= POINT_MERGE_EPSILON * 4) {
          maximumGroundProjection = Math.max(
            maximumGroundProjection,
            unitX * point.x + unitY * point.y + unitZ * point.z,
          );
        }
      }
    }
    const guardedConstant =
      maximumGroundProjection > Number.NEGATIVE_INFINITY
        ? Math.max(edgeConstant - depth, maximumGroundProjection + 0.005)
        : edgeConstant - depth;

    chamfers.push({
      nx: unitX,
      ny: unitY,
      nz: unitZ,
      constant: guardedConstant,
      id: `edge-bevel:${chamfers.length}`,
      role: "edge-bevel",
    });
  }
  return chamfers;
}

/**
 * Every half-space that bounds this body.
 *
 * A fragment takes the whole set from its parent rather than resolving any of
 * it again, and adds only its break. That is what makes the two halves of a
 * formation share one surface: they are the same intersection, differing by a
 * single plane whose sign is flipped between them.
 */
export function buildStoneSurfacePlanes(
  recipe: StoneRecipe,
  includeChips = false,
): StonePlane[] {
  const inherited = recipe.inheritedSurface;
  if (inherited) {
    const planes: StonePlane[] = [
      ...(includeChips ? inherited.detailed : inherited.coarse),
    ];
    const fracture = recipe.fracture;
    if (fracture) {
      planes.push(
        normalizePlane(
          fracture.nx,
          fracture.ny,
          fracture.nz,
          fracture.constant,
          "fracture",
          "fracture",
        ),
      );
    }
    return planes;
  }
  const bodyPlanes = buildStonePlanes(recipe);
  const cutPlanes = resolveCutPlanes(bodyPlanes, recipe, includeChips);
  const structuralPlanes = [...bodyPlanes, ...cutPlanes];
  const chamfers = addEdgeChamferPlanes(
    structuralPlanes,
    recipe,
    includeChips
      ? EDGE_CHAMFER_MIN_LENGTH_DETAIL
      : EDGE_CHAMFER_MIN_LENGTH_COARSE,
  );
  return [...structuralPlanes, ...chamfers];
}

export function buildStonePolyhedron(
  recipe: StoneRecipe,
  includeChips = false,
): StonePolygon[] {
  return facesFromPlanes(buildStoneSurfacePlanes(recipe, includeChips));
}
