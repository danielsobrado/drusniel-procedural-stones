import {
  scoreStoneRotationalSymmetry,
  scoreStoneSilhouette,
} from "./StoneSilhouetteQuality";
import { measureStoneSilhouetteStraightness } from "./StoneSilhouetteStraightness";
import {
  buildStonePolyhedron,
  type StonePolygon,
  type StoneVec3,
} from "./StoneClipper";
import { resolveStoneProfileHeights } from "./StoneProfile";
import { calculateStonePolygonAreaAndNormal } from "./StoneMeshTopology";
import { hashStoneCell, hashStoneLabel } from "./StoneRandom";
import {
  resolveStoneRecipe,
  resolveStoneSilhouetteVariant,
  type StoneArchetypeId,
  type StoneRecipe,
} from "./StoneRecipe";

const ATTEMPTS = 4;

/**
 * Sized against the measured spread of each term across the population: the
 * silhouette score varies by roughly 0.1 within an archetype, so this weight
 * makes it worth about a quarter of a point -- enough to decide between four
 * candidates that are otherwise close, not enough to overrule a body that is
 * structurally wrong.
 */
const SILHOUETTE_WEIGHT = 3;

/**
 * Symmetry runs 0 to about 0.6 in practice, so a fully repeating body loses
 * most of a point. Deliberately harsher than the silhouette reward: a rock that
 * matches itself every 60 degrees is not a rock.
 */
const ROTATIONAL_SYMMETRY_PENALTY = 1.5;
/** Long near-horizontal or near-vertical runs are the strongest masonry cue. */
const RECTILINEAR_EDGE_PENALTY = 2.4;
/** Reject only the outlying projected runs, not the broad planes themselves. */
const DOMINANT_STRAIGHTNESS_PENALTY = 1.8;
const MASONRY_WALL_PENALTY = 5.2;
const VERTICAL_CHAIN_PENALTY = 1.35;
const HORIZONTAL_CHAIN_PENALTY = 0.75;
const VERTICAL_CHAIN_PENALTY_START = 0.25;
const VERTICAL_CHAIN_PENALTY_FULL = 0.34;
const HORIZONTAL_CHAIN_PENALTY_START = 0.29;
const HORIZONTAL_CHAIN_PENALTY_FULL = 0.39;
/** Keep quality selection from buying cleaner outlines with extra clip faces. */
const BODY_FACE_PENALTY = 0.075;
const MEAN_STRAIGHTNESS_PENALTY_START = 0.235;
const MEAN_STRAIGHTNESS_PENALTY_FULL = 0.29;
const WORST_STRAIGHTNESS_PENALTY_START = 0.34;
const WORST_STRAIGHTNESS_PENALTY_FULL = 0.43;
const QUALITY_CACHE_LIMIT = 256;
const QUALITY_SEED_SALT = 0x41727479;
const TWO_PI = Math.PI * 2;
const qualityRecipeCache = new Map<string, StoneRecipe>();

function verticalSpan(face: StonePolygon): number {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const point of face.points) {
    minimum = Math.min(minimum, point.y);
    maximum = Math.max(maximum, point.y);
  }
  return maximum - minimum;
}

function bodyHeight(faces: readonly StonePolygon[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const face of faces) {
    for (const point of face.points) {
      minimum = Math.min(minimum, point.y);
      maximum = Math.max(maximum, point.y);
    }
  }
  return Math.max(1e-4, maximum - minimum);
}

function visibleScoringFaces(faces: readonly StonePolygon[]): StonePolygon[] {
  return faces.filter(
    (face) =>
      face.role !== "bottom" &&
      face.role !== "contact-bevel" &&
      face.role !== "edge-bevel",
  );
}

/** Share of visible surface that is both tall and close to a plumb wall. */
export function measureStoneMasonryWallScore(
  body: readonly StonePolygon[],
): number {
  const faces = visibleScoringFaces(body);
  const height = bodyHeight(faces);
  const entries = faces.map((face) => {
    const [area, , normalY] = calculateStonePolygonAreaAndNormal(face);
    return { face, area, normalY };
  });
  const totalArea = entries.reduce((sum, entry) => sum + entry.area, 0);
  if (!(totalArea > 0)) return 0;

  return entries.reduce((score, entry) => {
    const roleWeight =
      entry.face.role === "side"
        ? 1
        : entry.face.role === "top-bevel"
          ? 0.4
          : 0;
    if (roleWeight === 0) return score;
    const spanRatio = verticalSpan(entry.face) / height;
    const tallness = smoothstep(spanRatio, 0.42, 0.72);
    const uprightness = 1 - smoothstep(Math.abs(entry.normalY), 0.08, 0.38);
    return (
      score +
      (entry.area / totalArea) * tallness * uprightness * roleWeight
    );
  }, 0);
}

function ringSupport(
  recipe: StoneRecipe,
  ringIndex: number,
  side: number,
): number {
  const ring = recipe.profileRings[ringIndex];
  const angle = recipe.sideAngles[side];
  return (
    ring.radii[side] +
    Math.cos(angle) * ring.centerX +
    Math.sin(angle) * ring.centerZ
  );
}

function coefficientOfVariation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (!(Math.abs(mean) > 1e-6)) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

function targetScore(value: number, target: number, width: number): number {
  return Math.max(0, 1 - Math.abs(value - target) / width);
}

function profileWanderTarget(archetype: StoneArchetypeId): number {
  switch (archetype) {
    case "pebble":
      return 0.025;
    case "boulder":
      return 0.16;
    case "slab":
      return 0.1;
    case "block":
      return 0.11;
    case "shard":
      return 0.1;
    case "outcrop":
      return 0.12;
  }
}

function profileShoulderVariationTarget(archetype: StoneArchetypeId): number {
  switch (archetype) {
    case "boulder":
      return 0.13;
    case "block":
      return 0.1;
    case "outcrop":
      return 0.11;
    default:
      return 0.08;
  }
}

function profileArtDirection(recipe: StoneRecipe): number {
  let turnScore = 0;
  let monotonicTaper = 0;
  const shoulderRatios: number[] = [];
  const topRatios: number[] = [];
  const angleGaps: number[] = [];

  for (let side = 0; side < recipe.sideAngles.length; side += 1) {
    const heights = resolveStoneProfileHeights(recipe.profileRings, side);
    const slopes: number[] = [];
    let alwaysNarrows = true;
    for (let ring = 0; ring < recipe.profileRings.length - 1; ring += 1) {
      const lowerSupport = ringSupport(recipe, ring, side);
      const upperSupport = ringSupport(recipe, ring + 1, side);
      slopes.push(
        (upperSupport - lowerSupport) / (heights[ring + 1] - heights[ring]),
      );
      if (upperSupport > lowerSupport * 1.015) {
        alwaysNarrows = false;
      }
    }
    if (alwaysNarrows) monotonicTaper += 1;
    for (let index = 1; index < slopes.length; index += 1) {
      const turn = Math.abs(slopes[index] - slopes[index - 1]);
      turnScore += Math.min(1, turn / 0.22);
    }

    const belly = ringSupport(recipe, 1, side);
    const shoulder = ringSupport(recipe, 2, side);
    const top = ringSupport(recipe, recipe.profileRings.length - 1, side);
    shoulderRatios.push(shoulder / Math.max(0.05, belly));
    topRatios.push(top / Math.max(0.05, shoulder));

    const next = (side + 1) % recipe.sideAngles.length;
    const nextAngle =
      next === 0 ? recipe.sideAngles[next] + TWO_PI : recipe.sideAngles[next];
    angleGaps.push(nextAngle - recipe.sideAngles[side]);
  }

  const sideCount = recipe.sideAngles.length;
  const maximumTurns = sideCount * Math.max(1, recipe.profileRings.length - 2);
  const turnShare = turnScore / maximumTurns;
  const monotonicShare = monotonicTaper / sideCount;
  const contact = recipe.profileRings[0];
  const top = recipe.profileRings[recipe.profileRings.length - 1];
  const centerWander = Math.hypot(
    top.centerX - contact.centerX,
    top.centerZ - contact.centerZ,
  );
  const wanderTarget = profileWanderTarget(recipe.archetype);
  const wanderScore = Math.max(
    0,
    1 - Math.abs(centerWander - wanderTarget) / (wanderTarget * 1.35),
  );

  const shoulderVariation = coefficientOfVariation(shoulderRatios);
  const topVariation = coefficientOfVariation(topRatios);
  const gapVariation = coefficientOfVariation(angleGaps);
  const shoulderTarget = profileShoulderVariationTarget(recipe.archetype);
  const irregularityScore =
    targetScore(shoulderVariation, shoulderTarget, 0.12) * 0.4 +
    targetScore(topVariation, 0.11, 0.12) * 0.22 +
    targetScore(gapVariation, 0.2, 0.2) * 0.18;

  return (
    turnShare * 1.55 +
    wanderScore * 0.65 +
    irregularityScore -
    monotonicShare * 1.05
  );
}

function alignmentWeight(value: number, start: number): number {
  if (value <= start) return 0;
  const amount = Math.min(1, (value - start) / (1 - start));
  return amount * amount * (3 - 2 * amount);
}

function smoothstep(value: number, start: number, end: number): number {
  const amount = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return amount * amount * (3 - 2 * amount);
}

/**
 * Share of visible edge length that reads as a long horizontal/vertical run.
 *
 * A polyhedron necessarily has straight edges. The failure is not straightness
 * itself but a long roof line or plumb corner that dominates the silhouette and
 * makes the body read as dressed masonry. Height wander and ring-centre drift
 * naturally reduce this term without adding noisy micro-facets.
 */
function rectilinearEdgeShare(faces: readonly StonePolygon[]): number {
  const pointIds = new Map<StoneVec3, number>();
  const seenNeighbours = new Map<number, Set<number>>();
  let nextPointId = 0;
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let minimumZ = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  let maximumZ = Number.NEGATIVE_INFINITY;

  for (const face of faces) {
    for (const point of face.points) {
      if (!pointIds.has(point)) {
        pointIds.set(point, nextPointId++);
      }
      minimumX = Math.min(minimumX, point.x);
      minimumY = Math.min(minimumY, point.y);
      minimumZ = Math.min(minimumZ, point.z);
      maximumX = Math.max(maximumX, point.x);
      maximumY = Math.max(maximumY, point.y);
      maximumZ = Math.max(maximumZ, point.z);
    }
  }

  const bodyScale = Math.max(
    maximumX - minimumX,
    maximumY - minimumY,
    maximumZ - minimumZ,
    1e-4,
  );
  let totalLength = 0;
  let rectilinearLength = 0;

  for (const face of faces) {
    for (let index = 0; index < face.points.length; index += 1) {
      const a = face.points[index];
      const b = face.points[(index + 1) % face.points.length];
      const aId = pointIds.get(a);
      const bId = pointIds.get(b);
      if (aId === undefined || bId === undefined || aId === bId) continue;
      const low = Math.min(aId, bId);
      const high = Math.max(aId, bId);
      let neighbours = seenNeighbours.get(low);
      if (!neighbours) {
        neighbours = new Set<number>();
        seenNeighbours.set(low, neighbours);
      }
      if (neighbours.has(high)) continue;
      neighbours.add(high);

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dy, dz);
      if (!(length > 1e-6)) continue;
      totalLength += length;

      const horizontal = Math.hypot(dx, dz) / length;
      const vertical = Math.abs(dy) / length;
      const alignment = Math.max(
        alignmentWeight(horizontal, 0.965),
        alignmentWeight(vertical, 0.94),
      );
      if (alignment <= 0) continue;
      const normalizedLength = length / bodyScale;
      const longness = Math.max(
        0,
        Math.min(1, (normalizedLength - 0.22) / 0.33),
      );
      rectilinearLength += length * alignment * longness;
    }
  }

  return totalLength > 0 ? rectilinearLength / totalLength : 0;
}

/**
 * The body as it is drawn, not as it is clipped.
 *
 * `generateStoneMesh` shears by `lean` and scales by `width`/`height`/`depth`
 * after the clipper returns, so the polyhedron the scorer used to read was
 * isotropic and upright -- a boulder authored at `heightRatio` 0.5 was judged
 * as though it were as tall as it is wide. Every term here is a proportion, so
 * scoring the unit body meant `heightRatio`, `depthRatio` and `lean` could not
 * influence selection at all, and the silhouette term in particular could
 * never see the elongation that is most of what separates a wedge from a lump.
 */
function shapedBody(recipe: StoneRecipe): StonePolygon[] {
  const body = buildStonePolyhedron(recipe, false);
  const seen = new Set<StoneVec3>();
  for (const polygon of body) {
    for (const point of polygon.points) {
      if (seen.has(point)) continue;
      seen.add(point);
      const shearedX = point.x + recipe.leanX * point.y;
      const shearedZ = point.z + recipe.leanZ * point.y;
      point.x = recipe.width * shearedX;
      point.y = recipe.height * point.y;
      point.z = recipe.depth * shearedZ;
    }
  }
  return body;
}

/** Scores the final macro body, before optional near-range chips. */
export function scoreStoneShape(recipe: StoneRecipe): number {
  const body = shapedBody(recipe);
  const faces = visibleScoringFaces(body);
  const entries = faces.map((face) => ({
    face,
    area: calculateStonePolygonAreaAndNormal(face)[0],
  }));
  const total = entries.reduce((sum, entry) => sum + entry.area, 0);
  if (!(total > 0)) return -100;

  const shares = entries
    .map((entry) => entry.area / total)
    .sort((left, right) => right - left);
  const primarySix = shares.slice(0, 6).reduce((sum, share) => sum + share, 0);
  const primaryFour = shares.slice(0, 4).reduce((sum, share) => sum + share, 0);
  const tiny = shares
    .filter((share) => share < 0.015)
    .reduce((sum, share) => sum + share, 0);
  const mediumCount = shares.filter(
    (share) => share >= 0.025 && share <= 0.14,
  ).length;
  const topShare =
    entries
      .filter((entry) => entry.face.role === "top")
      .reduce((sum, entry) => sum + entry.area, 0) / total;
  const masonryWallScore = measureStoneMasonryWallScore(faces);

  const mean =
    recipe.sideRadii.reduce((sum, value) => sum + value, 0) /
    recipe.sideRadii.length;
  const asymmetry =
    Math.sqrt(
      recipe.sideRadii.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        recipe.sideRadii.length,
    ) / mean;
  const targetTop =
    recipe.silhouetteVariant === "capstone"
      ? 0.22
      : recipe.archetype === "slab"
        ? 0.2
        : recipe.archetype === "boulder"
          ? 0.18
          : recipe.archetype === "shard"
            ? 0.07
            : 0.14;

  // A stump combines a long near-vertical body with a pinched roof. Neither
  // measurement is sufficient alone: tall blocks are valid, and broad low tops
  // are valid, but their combination is the cut-masonry silhouette to avoid.
  const topDeficit = Math.max(0, targetTop - topShare) / targetTop;
  const stumpPenalty = masonryWallScore * topDeficit;
  const dominantPlaneScore = Math.min(1, primaryFour / 0.42);
  const rectilinear = rectilinearEdgeShare(faces);
  const straightness = measureStoneSilhouetteStraightness(body);
  const dominantStraightness =
    smoothstep(
      straightness.meanStraightChainShare,
      MEAN_STRAIGHTNESS_PENALTY_START,
      MEAN_STRAIGHTNESS_PENALTY_FULL,
    ) *
      0.65 +
    smoothstep(
      straightness.worstStraightChainShare,
      WORST_STRAIGHTNESS_PENALTY_START,
      WORST_STRAIGHTNESS_PENALTY_FULL,
    ) *
      0.35;
  const projectedVerticalPenalty = smoothstep(
    straightness.worstVerticalChainShare,
    VERTICAL_CHAIN_PENALTY_START,
    VERTICAL_CHAIN_PENALTY_FULL,
  );
  const projectedHorizontalPenalty = smoothstep(
    straightness.worstHorizontalChainShare,
    HORIZONTAL_CHAIN_PENALTY_START,
    HORIZONTAL_CHAIN_PENALTY_FULL,
  );

  return (
    primarySix * 4.2 +
    dominantPlaneScore * 0.55 -
    tiny * 7.5 -
    Math.abs(topShare - targetTop) * 2 -
    masonryWallScore * MASONRY_WALL_PENALTY -
    stumpPenalty * 5 -
    rectilinear * RECTILINEAR_EDGE_PENALTY -
    dominantStraightness * DOMINANT_STRAIGHTNESS_PENALTY -
    projectedVerticalPenalty * VERTICAL_CHAIN_PENALTY -
    projectedHorizontalPenalty * HORIZONTAL_CHAIN_PENALTY -
    faces.length * BODY_FACE_PENALTY +
    Math.min(mediumCount, 9) * 0.05 +
    Math.min(asymmetry, 0.28) * 2.15 +
    profileArtDirection(recipe) +
    // Everything above is object space, and none of it can tell a dome from a
    // faceted rock once the body is projected. These two close that gap: one
    // rewards an outline that turns in a few decisive corners from the angles
    // the game is played at, the other rejects bodies that still repeat
    // themselves under rotation, which is the radial generator showing through.
    scoreStoneSilhouette(body) * SILHOUETTE_WEIGHT -
    scoreStoneRotationalSymmetry(body) * ROTATIONAL_SYMMETRY_PENALTY
  );
}

function cacheRecipe(key: string, recipe: StoneRecipe): StoneRecipe {
  if (qualityRecipeCache.size >= QUALITY_CACHE_LIMIT) {
    const oldestKey = qualityRecipeCache.keys().next().value as
      string | undefined;
    if (oldestKey !== undefined) {
      qualityRecipeCache.delete(oldestKey);
    }
  }
  qualityRecipeCache.set(key, recipe);
  return recipe;
}

function resolveArchetypeSeed(
  archetype: StoneArchetypeId,
  seed: number,
): number {
  return hashStoneCell(seed, hashStoneLabel(archetype), QUALITY_SEED_SALT);
}

/** Deterministic best-of-four selection with a bounded runtime cache. */
export function resolveQualityStoneRecipe(
  archetype: StoneArchetypeId,
  seed: number,
): StoneRecipe {
  const key = `${archetype}:${seed >>> 0}`;
  const cached = qualityRecipeCache.get(key);
  if (cached) {
    return cached;
  }

  const archetypeSeed = resolveArchetypeSeed(archetype, seed);
  // A best-of-four art-direction pass must not silently select away a named
  // silhouette family. Choose the family once from the public variant seed,
  // then compare geometry only within that family.
  const silhouetteVariant = resolveStoneSilhouetteVariant(archetype, seed);
  let best = resolveStoneRecipe(archetype, archetypeSeed, silhouetteVariant);
  let bestScore = scoreStoneShape(best);
  for (let attempt = 1; attempt < ATTEMPTS; attempt += 1) {
    const candidate = resolveStoneRecipe(
      archetype,
      hashStoneCell(archetypeSeed, attempt, 0x5175616c),
      silhouetteVariant,
    );
    const candidateScore = scoreStoneShape(candidate);
    if (candidateScore > bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  return cacheRecipe(key, best);
}
