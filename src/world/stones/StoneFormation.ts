/**
 * One parent stone, broken into two pieces that still fit together.
 *
 * The world renders stones from a shared pool of instanced meshes, so a
 * formation cannot be clipped per placement without giving every cluster its
 * own geometry. The break is deterministic in the parent's seed, which means
 * both fragments can be baked as ordinary pool variants and paired at placement
 * time. Per-instance rendering therefore stays identical to whole stones.
 */

import { buildStonePolyhedron, buildStoneSurfacePlanes } from "./StoneClipper";
import type { StoneMeshMetrics } from "./StoneGeometry";
import { calculateStonePolygonAreaAndNormal } from "./StoneMeshTopology";
import { StoneRandom } from "./StoneRandom";
import type {
  StoneArchetypeId,
  StoneFractureFace,
  StoneInheritedSurface,
  StoneRecipe,
} from "./StoneRecipe";

export type StoneFragmentId = "whole" | "a" | "b";

export const STONE_FRAGMENT_IDS: readonly StoneFragmentId[] = [
  "whole",
  "a",
  "b",
];

const FRACTURABLE_ARCHETYPES: ReadonlySet<StoneArchetypeId> =
  new Set<StoneArchetypeId>(["boulder", "block", "slab", "outcrop"]);

/** Maximum lean away from a vertical fracture plane. */
const FRACTURE_TILT_LIMIT = 0.38;

/**
 * Share of the body retained by the dominant fragment.
 *
 * Near-even halves read as a saw cut. Surface breakage is normally one dominant
 * mass with a smaller detached chunk, while the viability gate below prevents
 * the small side from degenerating into an insignificant corner chip.
 */
const MAJOR_SHARE_MIN = 0.68;
const MAJOR_SHARE_MAX = 0.76;

const MINIMUM_FRACTURE_AREA_SHARE = 0.09;
const PAIR_CACHE_LIMIT = 128;
const PARTING_EPSILON = 1e-4;
const NORMAL_EPSILON = 1e-8;

interface StoneFragmentPair {
  readonly a: StoneRecipe;
  readonly b: StoneRecipe;
}

export interface StoneFormationDirection {
  readonly x: number;
  readonly z: number;
}

const pairCache = new Map<string, StoneFragmentPair | undefined>();

export function canFractureStoneArchetype(
  archetype: StoneArchetypeId,
): boolean {
  return FRACTURABLE_ARCHETYPES.has(archetype);
}

export function resolveStoneFragmentRecipe(
  parent: StoneRecipe,
  fragment: StoneFragmentId,
): StoneRecipe {
  if (fragment === "whole") return parent;
  const pair = resolveFragmentPair(parent);
  if (!pair) return parent;
  return fragment === "a" ? pair.a : pair.b;
}

export function stoneFormationSplits(parent: StoneRecipe): boolean {
  return resolveFragmentPair(parent) !== undefined;
}

function resolveFragmentPair(
  parent: StoneRecipe,
): StoneFragmentPair | undefined {
  if (parent.fracture || !canFractureStoneArchetype(parent.archetype)) {
    return undefined;
  }
  const key = `${parent.archetype}:${parent.seed}:${parent.silhouetteVariant}`;
  if (pairCache.has(key)) return pairCache.get(key);

  const pair = buildFragmentPair(parent);
  if (pairCache.size >= PAIR_CACHE_LIMIT) {
    const oldest = pairCache.keys().next().value as string | undefined;
    if (oldest !== undefined) pairCache.delete(oldest);
  }
  pairCache.set(key, pair);
  return pair;
}

function buildFragmentPair(parent: StoneRecipe): StoneFragmentPair | undefined {
  const plane = resolveFracturePlane(parent);
  if (!plane) return undefined;

  const inheritedSurface = resolveParentSurface(parent);
  const a: StoneRecipe = { ...parent, fracture: plane, inheritedSurface };
  const b: StoneRecipe = {
    ...parent,
    inheritedSurface,
    fracture: {
      nx: -plane.nx,
      ny: -plane.ny,
      nz: -plane.nz,
      constant: -plane.constant,
    },
  };
  if (!fragmentIsViable(a) || !fragmentIsViable(b)) return undefined;
  return { a, b };
}

function resolveParentSurface(parent: StoneRecipe): StoneInheritedSurface {
  return {
    coarse: buildStoneSurfacePlanes(parent, false),
    detailed: buildStoneSurfacePlanes(parent, true),
  };
}

function resolveFracturePlane(
  parent: StoneRecipe,
): StoneFractureFace | undefined {
  const random = StoneRandom.fromSeed(parent.seed).fork("formation-fracture");
  const azimuth = random.fork("azimuth").range(0, Math.PI * 2);
  const tilt = random.fork("tilt").signed(FRACTURE_TILT_LIMIT);
  const inverse = 1 / Math.hypot(1, tilt);
  const nx = Math.cos(azimuth) * inverse;
  const ny = tilt * inverse;
  const nz = Math.sin(azimuth) * inverse;

  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const polygon of buildStonePolyhedron(parent, false)) {
    for (const point of polygon.points) {
      const support = nx * point.x + ny * point.y + nz * point.z;
      minimum = Math.min(minimum, support);
      maximum = Math.max(maximum, support);
    }
  }
  if (!(maximum > minimum)) return undefined;

  const share = random.fork("share").range(MAJOR_SHARE_MIN, MAJOR_SHARE_MAX);
  return {
    nx,
    ny,
    nz,
    constant: minimum + (maximum - minimum) * share,
  };
}

function fragmentIsViable(recipe: StoneRecipe): boolean {
  const faces = buildStonePolyhedron(recipe, false);
  if (faces.length < 4) return false;

  let grounded = false;
  let fractureArea = 0;
  let totalArea = 0;
  for (const face of faces) {
    const [area] = calculateStonePolygonAreaAndNormal(face);
    totalArea += area;
    if (face.role === "fracture") fractureArea += area;
    if (face.role === "bottom" && area > 0) grounded = true;
  }
  return (
    grounded &&
    totalArea > 0 &&
    fractureArea / totalArea >= MINIMUM_FRACTURE_AREA_SHARE
  );
}

/**
 * Horizontal fracture normal after the recipe's non-uniform body transform.
 * Opening along this normal keeps asymmetric contact polygons from introducing
 * lateral shear between complementary fragments.
 */
export function resolveStoneFractureHorizontalNormal(
  recipe: StoneRecipe,
): StoneFormationDirection | undefined {
  const fracture = recipe.fracture;
  if (!fracture || !(recipe.width > 0) || !(recipe.depth > 0)) {
    return undefined;
  }
  const x = fracture.nx / recipe.width;
  const z = fracture.nz / recipe.depth;
  const length = Math.hypot(x, z);
  if (!(length > NORMAL_EPSILON)) return undefined;
  return { x: x / length, z: z / length };
}

/**
 * Small size-relative fracture aperture with a strong hairline bias.
 *
 * The stable parent material footprint is used rather than either clipped
 * fragment, so the same stone keeps the same aperture scale across fragment
 * ratios and LODs. The absolute cap prevents landmark stones from opening into
 * trenches.
 */
export function resolveStoneFormationGap(
  major: StoneMeshMetrics,
  minor: StoneMeshMetrics,
  scale: number,
  roll: number,
  ratioMin: number,
  ratioMax: number,
  maximumGap: number,
): number {
  const footprint =
    Math.max(
      major.materialFootprintRadius,
      minor.materialFootprintRadius,
    ) * Math.max(0, scale);
  const low = Math.max(0, Math.min(ratioMin, ratioMax));
  const high = Math.max(low, Math.max(ratioMin, ratioMax));
  const clampedRoll = Math.min(1, Math.max(0, roll));
  const biasedRoll = clampedRoll * clampedRoll;
  const ratio = low + (high - low) * biasedRoll;
  return Math.min(Math.max(0, maximumGap), footprint * ratio);
}

/**
 * Put the minor fragment back beside the major before yaw is applied.
 *
 * Contact-centroid translation reconstructs the original parent exactly. The
 * aperture is then added independently along the real fracture normal. Keeping
 * those operations separate preserves the mated outline while preventing a
 * crooked contact polygon from steering the crack sideways.
 */
export function resolveStoneFormationOffset(
  major: StoneMeshMetrics,
  minor: StoneMeshMetrics,
  scale: number,
  crackGap: number,
  fractureDirection?: StoneFormationDirection,
): { readonly x: number; readonly z: number } | undefined {
  const partingX = minor.contactOffsetX - major.contactOffsetX;
  const partingZ = minor.contactOffsetZ - major.contactOffsetZ;
  const parting = Math.hypot(partingX, partingZ);
  if (!(parting > PARTING_EPSILON)) return undefined;

  let directionX = partingX / parting;
  let directionZ = partingZ / parting;
  if (fractureDirection) {
    const length = Math.hypot(fractureDirection.x, fractureDirection.z);
    if (length > NORMAL_EPSILON) {
      directionX = fractureDirection.x / length;
      directionZ = fractureDirection.z / length;
      if (directionX * partingX + directionZ * partingZ < 0) {
        directionX = -directionX;
        directionZ = -directionZ;
      }
    }
  }

  const gap = Math.max(0, crackGap);
  return {
    x: partingX * scale + directionX * gap,
    z: partingZ * scale + directionZ * gap,
  };
}
