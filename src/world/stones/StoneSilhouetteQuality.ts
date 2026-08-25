/**
 * Scoring a stone the way it is actually looked at.
 *
 * Object-space face counts do not tell us how many corners survive projection.
 * This module measures the outline from gameplay-like viewpoints, both for art
 * direction and for deciding whether topology changes are actually justified.
 */

import type { StonePolygon, StoneVec3 } from "./StoneClipper";
import { calculateStonePolygonAreaAndNormal } from "./StoneMeshTopology";

/** Gameplay-like depression angles, in radians. */
const VIEW_PITCHES: readonly number[] = [0.31, 0.52];
/** Viewpoints around the body. The player walks around it; so does this. */
const VIEW_AZIMUTHS = 8;
/** Corners that count as carrying the outline's structure. */
const DOMINANT_CORNERS = 4;
/** Three broad outline edges are useful, but beyond half the perimeter they dominate. */
const BROAD_RUN_REWARD_LIMIT = 0.5;
/** Weight on the least flattering view, against the average of them all. */
const WORST_VIEW_WEIGHT = 0.35;
/** 5 degree steps, so common rotational periods land on whole samples. */
const SYMMETRY_SAMPLES = 72;
const SYMMETRY_SHIFTS: readonly number[] = [9, 12, 18, 24, 36];
const SYMMETRY_TOLERANCE = 0.12;
const HULL_EPSILON = 1e-9;
/**
 * Perpendicular error allowed when collapsing a projected hull point, as a
 * share of that view's perimeter. This is deliberately screen-relative: the
 * question is whether a corner changes the visible outline, not how many
 * centimetres apart two source rings happen to be.
 */
const SILHOUETTE_SIMPLIFY_PERIMETER_RATIO = 0.01;

export interface StoneProjectedPoint {
  readonly x: number;
  readonly y: number;
}

interface IndexedPoint2 extends StoneProjectedPoint {
  readonly sourceIndex: number;
}

export interface StoneSilhouetteComplexity {
  readonly views: number;
  readonly meanRawCorners: number;
  readonly meanMeaningfulCorners: number;
  readonly maximumMeaningfulCorners: number;
}

/**
 * How strongly this body reads as a placed set of planes rather than a dome,
 * from the angles it is actually seen at. Roughly [-1, 1].
 */
export function scoreStoneSilhouette(faces: readonly StonePolygon[]): number {
  const points = collectPoints(faces);
  if (points.length < 4) return 0;

  let total = 0;
  let worst = Number.POSITIVE_INFINITY;
  let views = 0;
  visitStoneProjectedHulls(points, (hull) => {
    const score = scoreOutline(hull);
    total += score;
    worst = Math.min(worst, score);
    views += 1;
  });
  if (views === 0) return 0;
  const mean = total / views;
  return mean * (1 - WORST_VIEW_WEIGHT) + worst * WORST_VIEW_WEIGHT;
}

/**
 * Raw hull vertices overstate visible complexity when several elevation-profile
 * rings land almost on one line. Collapse only points whose removal moves the
 * projected outline less than one percent of the perimeter, then report both
 * counts. This is a measurement, not a score: topology only needs changing if
 * the meaningful count stays high.
 */
export function measureStoneSilhouetteComplexity(
  faces: readonly StonePolygon[],
): StoneSilhouetteComplexity {
  const points = collectPoints(faces);
  if (points.length < 3) {
    return {
      views: 0,
      meanRawCorners: 0,
      meanMeaningfulCorners: 0,
      maximumMeaningfulCorners: 0,
    };
  }

  let views = 0;
  let rawTotal = 0;
  let meaningfulTotal = 0;
  let maximumMeaningfulCorners = 0;
  visitStoneProjectedHulls(points, (hull) => {
    const meaningful = simplifyClosedHull(hull);
    rawTotal += hull.length;
    meaningfulTotal += meaningful.length;
    maximumMeaningfulCorners = Math.max(
      maximumMeaningfulCorners,
      meaningful.length,
    );
    views += 1;
  });

  return {
    views,
    meanRawCorners: views > 0 ? rawTotal / views : 0,
    meanMeaningfulCorners: views > 0 ? meaningfulTotal / views : 0,
    maximumMeaningfulCorners,
  };
}

/**
 * How nearly this body repeats itself under rotation, in [0, 1].
 * A radial generator leaves its fingerprint in the horizontal support curve.
 */
export function scoreStoneRotationalSymmetry(
  faces: readonly StonePolygon[],
): number {
  const points = collectPoints(faces);
  if (points.length < 4) return 0;

  const support = new Float64Array(SYMMETRY_SAMPLES);
  let mean = 0;
  for (let sample = 0; sample < SYMMETRY_SAMPLES; sample += 1) {
    const angle = (sample / SYMMETRY_SAMPLES) * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    let maximum = Number.NEGATIVE_INFINITY;
    for (const point of points) {
      const projection = point.x * dirX + point.z * dirZ;
      if (projection > maximum) maximum = projection;
    }
    support[sample] = maximum;
    mean += maximum;
  }
  mean /= SYMMETRY_SAMPLES;
  if (!(mean > HULL_EPSILON)) return 0;

  let strongest = 0;
  for (const shift of SYMMETRY_SHIFTS) {
    let difference = 0;
    for (let sample = 0; sample < SYMMETRY_SAMPLES; sample += 1) {
      difference += Math.abs(
        support[sample] - support[(sample + shift) % SYMMETRY_SAMPLES],
      );
    }
    const normalized = difference / SYMMETRY_SAMPLES / mean;
    strongest = Math.max(
      strongest,
      Math.max(0, 1 - normalized / SYMMETRY_TOLERANCE),
    );
  }
  return strongest;
}

function collectPoints(faces: readonly StonePolygon[]): StoneVec3[] {
  const points: StoneVec3[] = [];
  for (const face of faces) {
    if (face.role === "bottom") continue;
    const [area] = calculateStonePolygonAreaAndNormal(face);
    if (!(area > 0)) continue;
    for (const point of face.points) points.push(point);
  }
  return points;
}

/** Visit the same projected outlines used by every gameplay-view quality metric. */
export function visitStoneProjectedHulls(
  points: readonly StoneVec3[],
  visit: (hull: readonly StoneProjectedPoint[]) => void,
): void {
  for (const pitch of VIEW_PITCHES) {
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    for (let step = 0; step < VIEW_AZIMUTHS; step += 1) {
      const azimuth = (step / VIEW_AZIMUTHS) * Math.PI * 2;
      const cosAzimuth = Math.cos(azimuth);
      const sinAzimuth = Math.sin(azimuth);
      const rightX = -sinAzimuth;
      const rightZ = cosAzimuth;
      const upX = -sinPitch * cosAzimuth;
      const upY = cosPitch;
      const upZ = -sinPitch * sinAzimuth;

      const projected: StoneProjectedPoint[] = points.map((point) => ({
        x: point.x * rightX + point.z * rightZ,
        y: point.x * upX + point.y * upY + point.z * upZ,
      }));
      visit(convexHull(projected));
    }
  }
}

function scoreOutline(hull: readonly StoneProjectedPoint[]): number {
  if (hull.length < 3) return 0;
  const edges: number[] = [];
  const turns: number[] = [];
  let perimeter = 0;
  let doubleArea = 0;
  for (let index = 0; index < hull.length; index += 1) {
    const current = hull[index];
    const next = hull[(index + 1) % hull.length];
    const previous = hull[(index + hull.length - 1) % hull.length];
    const length = Math.hypot(next.x - current.x, next.y - current.y);
    edges.push(length);
    perimeter += length;
    doubleArea += current.x * next.y - next.x * current.y;

    const inX = current.x - previous.x;
    const inY = current.y - previous.y;
    const outX = next.x - current.x;
    const outY = next.y - current.y;
    const cross = inX * outY - inY * outX;
    const dot = inX * outX + inY * outY;
    turns.push(Math.abs(Math.atan2(cross, dot)));
  }
  if (!(perimeter > HULL_EPSILON)) return 0;

  turns.sort((left, right) => right - left);
  let dominantTurn = 0;
  const corners = Math.min(DOMINANT_CORNERS, turns.length);
  for (let index = 0; index < corners; index += 1) {
    dominantTurn += turns[index];
  }
  const turnConcentration = dominantTurn / (Math.PI * 2);

  edges.sort((left, right) => right - left);
  let longRun = 0;
  const runs = Math.min(3, edges.length);
  for (let index = 0; index < runs; index += 1) {
    longRun += edges[index];
  }
  longRun = Math.min(BROAD_RUN_REWARD_LIMIT, longRun / perimeter);

  const area = Math.abs(doubleArea) * 0.5;
  const circularity = (4 * Math.PI * area) / (perimeter * perimeter);

  return turnConcentration * 0.9 + longRun * 0.7 - circularity * 0.9;
}

/**
 * Greedy closed-hull simplification with an error bound against the original
 * outline, not against the already-simplified neighbours.
 *
 * Checking only the current corner's distance lets many individually-small
 * removals accumulate into a large shape change. That is especially dangerous
 * here because a smooth round body can then report only a handful of
 * "meaningful" corners and hide the topology problem this metric exists to
 * diagnose. Each candidate therefore checks every original point that would be
 * represented by the replacement segment.
 */
function simplifyClosedHull(
  hull: readonly StoneProjectedPoint[],
): StoneProjectedPoint[] {
  if (hull.length <= 3) return [...hull];
  const simplified: IndexedPoint2[] = hull.map((point, sourceIndex) => ({
    ...point,
    sourceIndex,
  }));
  let perimeter = 0;
  for (let index = 0; index < hull.length; index += 1) {
    const a = hull[index];
    const b = hull[(index + 1) % hull.length];
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (!(perimeter > HULL_EPSILON)) return [...hull];
  const tolerance = perimeter * SILHOUETTE_SIMPLIFY_PERIMETER_RATIO;

  while (simplified.length > 3) {
    let candidate = -1;
    let minimumError = Number.POSITIVE_INFINITY;
    for (let index = 0; index < simplified.length; index += 1) {
      const previous = simplified[
        (index + simplified.length - 1) % simplified.length
      ];
      const next = simplified[(index + 1) % simplified.length];
      const error = maximumSourceArcError(
        hull,
        previous.sourceIndex,
        next.sourceIndex,
        previous,
        next,
      );
      if (error < minimumError) {
        minimumError = error;
        candidate = index;
      }
    }
    if (candidate < 0 || minimumError > tolerance) break;
    simplified.splice(candidate, 1);
  }
  return simplified.map(({ x, y }) => ({ x, y }));
}

function maximumSourceArcError(
  source: readonly StoneProjectedPoint[],
  startIndex: number,
  endIndex: number,
  start: StoneProjectedPoint,
  end: StoneProjectedPoint,
): number {
  let maximum = 0;
  let index = (startIndex + 1) % source.length;
  while (index !== endIndex) {
    maximum = Math.max(
      maximum,
      pointSegmentDistance(source[index], start, end),
    );
    index = (index + 1) % source.length;
  }
  return maximum;
}

function pointSegmentDistance(
  point: StoneProjectedPoint,
  a: StoneProjectedPoint,
  b: StoneProjectedPoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > HULL_EPSILON)) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

/** Monotone chain, counter-clockwise, without collinear runs. */
function convexHull(
  points: readonly StoneProjectedPoint[],
): StoneProjectedPoint[] {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort(
    (left, right) => left.x - right.x || left.y - right.y,
  );
  const build = (
    source: readonly StoneProjectedPoint[],
  ): StoneProjectedPoint[] => {
    const chain: StoneProjectedPoint[] = [];
    for (const point of source) {
      while (chain.length >= 2) {
        const a = chain[chain.length - 2];
        const b = chain[chain.length - 1];
        const cross =
          (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
        if (cross > HULL_EPSILON) break;
        chain.pop();
      }
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...build(sorted), ...build([...sorted].reverse())];
}
