/**
 * Waving structural break lines so generated stones read fractured rather than
 * sliced.
 *
 * Clipping a convex body with a plane produces perfectly straight rim edges.
 * The topology can stay unchanged: moving each welded rim point keeps the shell
 * watertight while a small low-frequency displacement removes the ruler-straight
 * read. Formation fractures use the stronger treatment; ordinary structural
 * cuts use a subtler version so broad planes remain broad.
 */

import type { StonePolygon, StoneVec3 } from "./StoneClipper";
import { hashStoneCell } from "./StoneRandom";
import type { StoneRecipe } from "./StoneRecipe";

/** Peak formation-fracture displacement in unit body space. */
export const STONE_FRACTURE_RELIEF = 0.018;
/** Maximum structural-cut displacement before per-family scaling. */
export const STONE_CUT_RELIEF_MAX = 0.009;

/**
 * Harder, sharper families keep a smaller cut waver. The smallest value stays
 * below the family's minimum edge-chamfer depth, preventing relief from folding
 * the narrow bevel that carries the highlight along the cut.
 */
const CUT_RELIEF_SCALE: Readonly<Record<StoneRecipe["archetype"], number>> = {
  pebble: 0.45,
  boulder: 1,
  slab: 0.85,
  block: 0.8,
  shard: 0.42,
  outcrop: 1,
};

/** Height over which relief fades in, so ground contact stays flat. */
const RELIEF_GROUND_FADE = 0.14;
/** Lattice period of the waver, in unit body space. */
const RELIEF_PERIOD_HEIGHT = 0.42;
const RELIEF_PERIOD_ALONG = 0.55;
/** Intersecting formation and cut relief gets only a small extra allowance. */
const MAX_MIXED_RELIEF = 0.021;
/**
 * Fraction of the smallest face a rim point touches that relief may spend.
 * Rim points are welded, so displacing one also drags every neighbouring face
 * that shares it. A near-degenerate sliver can be narrower than the
 * displacement itself, and moving its corners that far turns the face inside
 * out. Ordinary faces are unaffected: at this fraction anything with a
 * diagonal past about 0.14 already has more budget than MAX_MIXED_RELIEF can
 * spend, so only near-degenerate slivers ever bind.
 */
const RELIEF_FACE_BUDGET = 0.15;
const RELIEF_SEED_XOR = 0x52656c66;
const CUT_RELIEF_SEED_XOR = 0x43757452;
const HORIZONTAL_EPSILON = 1e-6;

interface ReliefSource {
  readonly planeId: string;
  readonly role: "cut" | "fracture";
  readonly directionX: number;
  readonly directionZ: number;
  readonly tangentX: number;
  readonly tangentZ: number;
  readonly amplitude: number;
  readonly seed: number;
}

interface ReliefOffset {
  cutX: number;
  cutZ: number;
  fractureX: number;
  fractureZ: number;
}

/** Apply matching relief to formation fractures and structural cut rims. */
export function addStoneFractureRelief(
  polygons: StonePolygon[],
  recipe: StoneRecipe,
  strengthScale = 1,
): StonePolygon[] {
  if (strengthScale <= 0) return polygons;
  const sources = resolveReliefSources(recipe, strengthScale);
  if (sources.length === 0) return polygons;

  // facesFromPlanes() welds shared shell corners to the same object. Keeping the
  // offsets by identity avoids string allocation and, more importantly, cannot
  // move an unrelated nearby corner merely because both positions quantize to
  // the same cell.
  const offsets = new Map<StoneVec3, ReliefOffset>();
  for (const source of sources) {
    const sourcePoints = new Set<StoneVec3>();
    for (const polygon of polygons) {
      if (polygon.role !== source.role || polygon.planeId !== source.planeId) {
        continue;
      }
      for (const point of polygon.points) {
        if (sourcePoints.has(point)) continue;
        sourcePoints.add(point);
        const along = point.x * source.tangentX + point.z * source.tangentZ;
        const amount =
          smoothField(along, point.y, source.seed) *
          source.amplitude *
          groundFade(point.y);
        let offset = offsets.get(point);
        if (!offset) {
          offset = { cutX: 0, cutZ: 0, fractureX: 0, fractureZ: 0 };
          offsets.set(point, offset);
        }
        if (source.role === "fracture") {
          offset.fractureX += source.directionX * amount;
          offset.fractureZ += source.directionZ * amount;
        } else {
          offset.cutX += source.directionX * amount;
          offset.cutZ += source.directionZ * amount;
        }
      }
    }
  }
  if (offsets.size === 0) return polygons;

  // Mated fragments must displace their shared rim identically. The budget is
  // measured from incident faces, and the two halves of a break do not share
  // those, so applying it to a fragment would part the rim. Whole stones carry
  // the sliver protection; fragments keep exact parity, which the formation
  // gate checks.
  const budgets = recipe.fracture
    ? undefined
    : resolveReliefBudgets(polygons, offsets);
  const maximumCutRelief = resolveCutRelief(recipe);
  for (const [point, offset] of offsets) {
    const cutLength = Math.hypot(offset.cutX, offset.cutZ);
    const cutScale =
      cutLength > maximumCutRelief ? maximumCutRelief / cutLength : 1;
    let x = offset.cutX * cutScale + offset.fractureX;
    let z = offset.cutZ * cutScale + offset.fractureZ;
    const mixedLength = Math.hypot(x, z);
    if (mixedLength > MAX_MIXED_RELIEF && mixedLength > HORIZONTAL_EPSILON) {
      const mixedScale = MAX_MIXED_RELIEF / mixedLength;
      x *= mixedScale;
      z *= mixedScale;
    }
    const budget = budgets?.get(point);
    if (budget !== undefined) {
      const length = Math.hypot(x, z);
      if (length > budget && length > HORIZONTAL_EPSILON) {
        const scale = budget / length;
        x *= scale;
        z *= scale;
      }
    }
    point.x += x;
    point.z += z;
  }
  return polygons;
}

/**
 * Budget each moving point by the smallest face it belongs to, measured as that
 * face's bounding diagonal. Only slivers ever bind.
 */
function resolveReliefBudgets(
  polygons: readonly StonePolygon[],
  offsets: ReadonlyMap<StoneVec3, ReliefOffset>,
): Map<StoneVec3, number> {
  const budgets = new Map<StoneVec3, number>();
  for (const polygon of polygons) {
    let minimumX = Infinity;
    let minimumY = Infinity;
    let minimumZ = Infinity;
    let maximumX = -Infinity;
    let maximumY = -Infinity;
    let maximumZ = -Infinity;
    let touches = false;
    for (const point of polygon.points) {
      if (offsets.has(point)) touches = true;
      if (point.x < minimumX) minimumX = point.x;
      if (point.y < minimumY) minimumY = point.y;
      if (point.z < minimumZ) minimumZ = point.z;
      if (point.x > maximumX) maximumX = point.x;
      if (point.y > maximumY) maximumY = point.y;
      if (point.z > maximumZ) maximumZ = point.z;
    }
    if (!touches) continue;
    const diagonal = Math.hypot(
      maximumX - minimumX,
      maximumY - minimumY,
      maximumZ - minimumZ,
    );
    const budget = diagonal * RELIEF_FACE_BUDGET;
    for (const point of polygon.points) {
      if (!offsets.has(point)) continue;
      const existing = budgets.get(point);
      if (existing === undefined || budget < existing) {
        budgets.set(point, budget);
      }
    }
  }
  return budgets;
}

function resolveReliefSources(
  recipe: StoneRecipe,
  strengthScale = 1,
): ReliefSource[] {
  const sources: ReliefSource[] = [];
  const fracture = recipe.fracture;
  if (fracture) {
    const source = createReliefSource(
      "fracture",
      "fracture",
      fracture.nx,
      fracture.nz,
      STONE_FRACTURE_RELIEF * strengthScale,
      recipe.seed,
    );
    if (source) sources.push(source);
  }

  const cutRelief = resolveCutRelief(recipe) * strengthScale;
  for (let index = 0; index < recipe.cuts.length; index += 1) {
    const cut = recipe.cuts[index];
    const source = createReliefSource(
      `cut:${index}`,
      "cut",
      cut.normalX,
      cut.normalZ,
      cutRelief,
      hashStoneCell(recipe.seed, index, CUT_RELIEF_SEED_XOR),
    );
    if (source) sources.push(source);
  }
  return sources;
}

function resolveCutRelief(recipe: StoneRecipe): number {
  return STONE_CUT_RELIEF_MAX * CUT_RELIEF_SCALE[recipe.archetype];
}

function createReliefSource(
  planeId: string,
  role: "cut" | "fracture",
  nx: number,
  nz: number,
  amplitude: number,
  seed: number,
): ReliefSource | undefined {
  const horizontal = Math.hypot(nx, nz);
  if (!(horizontal > HORIZONTAL_EPSILON)) return undefined;

  // Formation siblings store their break normal with opposite signs. A
  // canonical sign also makes ordinary cut relief independent of representation.
  const flip = canonicalSign(nx, nz);
  const directionX = (nx / horizontal) * flip;
  const directionZ = (nz / horizontal) * flip;
  return {
    planeId,
    role,
    directionX,
    directionZ,
    tangentX: -directionZ,
    tangentZ: directionX,
    amplitude,
    seed,
  };
}

function canonicalSign(nx: number, nz: number): number {
  const dominant = Math.abs(nx) >= Math.abs(nz) ? nx : nz;
  return dominant < 0 ? -1 : 1;
}

function groundFade(y: number): number {
  if (y <= 0) return 0;
  if (y >= RELIEF_GROUND_FADE) return 1;
  const amount = y / RELIEF_GROUND_FADE;
  return amount * amount * (3 - 2 * amount);
}

/** Smooth signed value noise on a break plane, in [-1, 1]. */
function smoothField(along: number, height: number, seed: number): number {
  const u = along / RELIEF_PERIOD_ALONG;
  const v = height / RELIEF_PERIOD_HEIGHT;
  const cellU = Math.floor(u);
  const cellV = Math.floor(v);
  const fadeU = fade(u - cellU);
  const fadeV = fade(v - cellV);
  const top =
    lattice(cellU, cellV, seed) * (1 - fadeU) +
    lattice(cellU + 1, cellV, seed) * fadeU;
  const bottom =
    lattice(cellU, cellV + 1, seed) * (1 - fadeU) +
    lattice(cellU + 1, cellV + 1, seed) * fadeU;
  return top * (1 - fadeV) + bottom * fadeV;
}

function fade(amount: number): number {
  return amount * amount * (3 - 2 * amount);
}

function lattice(u: number, v: number, seed: number): number {
  return (hashStoneCell(u, v, seed ^ RELIEF_SEED_XOR) / 4294967296) * 2 - 1;
}
