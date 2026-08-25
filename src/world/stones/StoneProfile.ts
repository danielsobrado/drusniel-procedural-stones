import { hashStoneCell, StoneRandom } from "./StoneRandom";
import type {
  StoneArchetypeId,
  StoneSilhouetteVariant,
} from "./StoneRecipe";

export interface StoneProfileRing {
  readonly height: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly radii: readonly number[];
  /** Smooth per-sector vertical variation; top/contact rings remain fixed. */
  readonly heightOffsets: readonly number[];
}

export interface StoneProfileInput {
  readonly archetype: StoneArchetypeId;
  readonly silhouetteVariant: StoneSilhouetteVariant;
  readonly seed: number;
  readonly sideAngles: readonly number[];
  readonly sideRadii: readonly number[];
  readonly taper: number;
  readonly topScale: number;
  readonly topBevelHeight: number;
  readonly contactInset: number;
  readonly contactBevelHeight: number;
}

interface Range {
  readonly min: number;
  readonly max: number;
}

interface ProfileFamily {
  readonly bellyBulge: Range;
  readonly bellyVariation: number;
  readonly shoulderVariation: number;
  readonly crownVariation: number;
  readonly centerWander: Range;
  readonly verticalVariation: number;
  readonly slopeTurn: number;
  readonly directionalCompression: Range;
  readonly shoulderBreak: Range;
  readonly bodyTurn: Range;
  /**
   * How tightly the compression and shoulder-break lobes are focused.
   *
   * The lobe is a smoothstepped cosine, so it is nonzero across a full half
   * turn: at 1 it spreads a shoulder over every sector facing roughly the
   * right way, and a displacement spread over every sector is a gradient, not
   * a shoulder. Raising the exponent narrows the support until one or two
   * sectors take the whole displacement and the sectors beside them do not,
   * which is what makes an edge instead of a slope.
   */
  readonly lobeSharpness: number;
  /**
   * How much a ring may widen over the one below it, per unit height.
   *
   * The pass below used to force the radius non-increasing above the belly,
   * which made the loft a stack that can only narrow: a cone with the corners
   * knocked off. Allowing a rise does not create an overhang -- the body is an
   * intersection of half-spaces and stays convex whatever the rings ask for --
   * it lets a sector hold its width up the body and so present one tall wall
   * where the old profile had to break the same height into three narrowing
   * bands.
   */
  readonly maximumRise: number;
  /**
   * How nearly the crown ring sits on the line from shoulder to top.
   *
   * The crown radius is a fixed blend weighted toward the shoulder, which puts
   * it outside the shoulder-to-top chord and bends the upper body into a
   * dome shoulder. At 1 the crown lands exactly on that chord, the two ring
   * segments become coplanar, and the clipper returns one tall upper face
   * instead of two stacked bands -- two fewer outline corners per side, which
   * is the term the silhouette score is actually dominated by.
   */
  readonly crownStraightness: number;
}

const PROFILE_FAMILIES: Record<StoneArchetypeId, ProfileFamily> = {
  pebble: {
    bellyBulge: { min: 0.02, max: 0.08 },
    bellyVariation: 0.035,
    shoulderVariation: 0.035,
    crownVariation: 0.025,
    centerWander: { min: 0.015, max: 0.045 },
    verticalVariation: 0.025,
    slopeTurn: 0.025,
    directionalCompression: { min: 0, max: 0 },
    shoulderBreak: { min: 0, max: 0 },
    bodyTurn: { min: 0, max: 0 },
    lobeSharpness: 1,
    maximumRise: 0,
    crownStraightness: 0,
  },
  boulder: {
    // Boulder massing is directional: one broad side recedes and another
    // shoulder breaks away. Stronger centre drift and per-sector height wander
    // keep the broad planes while preventing plumb walls and level roof lines.
    bellyBulge: { min: -0.03, max: 0.02 },
    bellyVariation: 0.07,
    shoulderVariation: 0.1,
    crownVariation: 0.07,
    centerWander: { min: 0.11, max: 0.24 },
    verticalVariation: 0.085,
    slopeTurn: 0.04,
    directionalCompression: { min: 0.22, max: 0.4 },
    shoulderBreak: { min: 0.18, max: 0.34 },
    bodyTurn: { min: 0.04, max: 0.08 },
    lobeSharpness: 3.4,
    maximumRise: 0.1,
    crownStraightness: 0.68,
  },
  slab: {
    bellyBulge: { min: 0.035, max: 0.09 },
    bellyVariation: 0.055,
    shoulderVariation: 0.07,
    crownVariation: 0.05,
    centerWander: { min: 0.05, max: 0.12 },
    verticalVariation: 0.055,
    slopeTurn: 0.05,
    directionalCompression: { min: 0.03, max: 0.08 },
    shoulderBreak: { min: 0.02, max: 0.075 },
    bodyTurn: { min: 0, max: 0 },
    lobeSharpness: 2.1,
    maximumRise: 0.08,
    crownStraightness: 0.4,
  },
  block: {
    bellyBulge: { min: 0.015, max: 0.065 },
    bellyVariation: 0.06,
    shoulderVariation: 0.075,
    crownVariation: 0.055,
    centerWander: { min: 0.05, max: 0.13 },
    verticalVariation: 0.06,
    slopeTurn: 0.04,
    directionalCompression: { min: 0.04, max: 0.1 },
    shoulderBreak: { min: 0.03, max: 0.09 },
    bodyTurn: { min: 0, max: 0 },
    lobeSharpness: 2.2,
    maximumRise: 0.1,
    crownStraightness: 0.38,
  },
  shard: {
    bellyBulge: { min: -0.015, max: 0.035 },
    bellyVariation: 0.045,
    shoulderVariation: 0.06,
    crownVariation: 0.055,
    centerWander: { min: 0.065, max: 0.15 },
    verticalVariation: 0.045,
    slopeTurn: 0.045,
    directionalCompression: { min: 0.025, max: 0.07 },
    shoulderBreak: { min: 0.02, max: 0.065 },
    bodyTurn: { min: 0, max: 0 },
    lobeSharpness: 2.4,
    maximumRise: 0.06,
    crownStraightness: 0.35,
  },
  outcrop: {
    bellyBulge: { min: 0.08, max: 0.19 },
    bellyVariation: 0.11,
    shoulderVariation: 0.12,
    crownVariation: 0.085,
    centerWander: { min: 0.09, max: 0.2 },
    verticalVariation: 0.09,
    slopeTurn: 0.035,
    directionalCompression: { min: 0.08, max: 0.17 },
    shoulderBreak: { min: 0.06, max: 0.14 },
    bodyTurn: { min: 0, max: 0 },
    lobeSharpness: 2.8,
    maximumRise: 0.12,
    crownStraightness: 0.7,
  },
};

const MIN_RADIUS = 0.075;
/** Authored ring centres stay well separated before per-sector height wander. */
const AUTHORED_MIN_RING_GAP = 0.105;
/** Effective geometry gap shared with the silhouette scorer. */
export const STONE_PROFILE_MIN_HEIGHT_GAP = 0.06;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function signedHash(seed: number, index: number, salt: number): number {
  return hashStoneCell(seed, index, salt) / 2147483648 - 1;
}

function smoothSectorVariation(
  seed: number,
  side: number,
  sideCount: number,
  salt: number,
): number {
  const sample = (offset: number): number =>
    signedHash(seed, (side + offset + sideCount) % sideCount, salt);
  return sample(-1) * 0.2 + sample(0) * 0.6 + sample(1) * 0.2;
}

function directionalLobe(
  angle: number,
  direction: number,
  sharpness: number,
): number {
  const cosine = Math.max(0, Math.cos(angle - direction));
  const raw = sharpness === 1 ? cosine : Math.pow(cosine, sharpness);
  return raw * raw * (3 - 2 * raw);
}

function centerPoint(
  strength: number,
  primaryAngle: number,
  secondaryAngle: number,
  primaryWeight: number,
  secondaryWeight: number,
): readonly [number, number] {
  return [
    Math.cos(primaryAngle) * strength * primaryWeight +
      Math.cos(secondaryAngle) * strength * secondaryWeight,
    Math.sin(primaryAngle) * strength * primaryWeight +
      Math.sin(secondaryAngle) * strength * secondaryWeight,
  ];
}

function resolveEffectiveHeights(
  baseHeights: readonly number[],
  heightOffsets: readonly (readonly number[])[],
  side: number,
): number[] {
  const heights = new Array<number>(baseHeights.length);
  heights[0] = baseHeights[0];
  const topHeight = baseHeights[baseHeights.length - 1];
  for (let index = 1; index < baseHeights.length - 1; index += 1) {
    const remaining = baseHeights.length - 1 - index;
    const maximum = topHeight - remaining * STONE_PROFILE_MIN_HEIGHT_GAP;
    const raw = baseHeights[index] + heightOffsets[index][side];
    heights[index] = Math.min(
      maximum,
      Math.max(
        heights[index - 1] + STONE_PROFILE_MIN_HEIGHT_GAP,
        raw,
      ),
    );
  }
  heights[baseHeights.length - 1] = topHeight;
  return heights;
}

/** Effective ring heights used by both geometry and art-direction scoring. */
export function resolveStoneProfileHeights(
  rings: readonly StoneProfileRing[],
  side: number,
): readonly number[] {
  return resolveEffectiveHeights(
    rings.map((ring) => ring.height),
    rings.map((ring) => ring.heightOffsets),
    side,
  );
}

/**
 * Build contact → belly → shoulder → crown → top profiles.
 *
 * Rings are not scaled copies. Broad directional compression, an independent
 * shoulder break, vertical wander, and a moving centre make the silhouette read
 * as a few fractured masses while keeping the convex clipper robust.
 */
export function resolveStoneProfile(
  input: StoneProfileInput,
  random: StoneRandom,
): readonly StoneProfileRing[] {
  const family = PROFILE_FAMILIES[input.archetype];
  const sideCount = input.sideAngles.length;
  const bellyHeight = clamp(
    Math.max(input.contactBevelHeight * 1.35, random.range(0.2, 0.3)),
    0.18,
    0.34,
  );
  const shoulderHeight = random.range(0.53, 0.67);
  const crownHeight = clamp(
    1 - input.topBevelHeight,
    shoulderHeight + AUTHORED_MIN_RING_GAP,
    input.silhouetteVariant === "capstone" ? 0.9 : 0.88,
  );
  const baseHeights = [0, bellyHeight, shoulderHeight, crownHeight, 1] as const;

  const center = random.fork("profile-centres");
  const wander = center.range(family.centerWander.min, family.centerWander.max);
  const primaryAngle = center.range(0, Math.PI * 2);
  const secondaryAngle = primaryAngle + center.range(1.15, 2.35);
  const [bellyX, bellyZ] = centerPoint(
    wander,
    primaryAngle,
    secondaryAngle,
    0.32,
    0.08,
  );
  const [shoulderX, shoulderZ] = centerPoint(
    wander,
    primaryAngle,
    secondaryAngle,
    0.72,
    0.22,
  );
  const [crownX, crownZ] = centerPoint(
    wander,
    primaryAngle,
    secondaryAngle,
    0.55,
    0.72,
  );
  const [topX, topZ] = centerPoint(
    wander,
    primaryAngle,
    secondaryAngle,
    0.42,
    0.85,
  );
  const centers: readonly (readonly [number, number])[] = [
    [0, 0],
    [bellyX, bellyZ],
    [shoulderX, shoulderZ],
    [crownX, crownZ],
    [topX, topZ],
  ];

  const bellyBulge = random.range(
    family.bellyBulge.min,
    family.bellyBulge.max,
  );
  const massing = random.fork("profile-massing");
  const compressionStrength = massing.range(
    family.directionalCompression.min,
    family.directionalCompression.max,
  );
  const shoulderBreakStrength = massing.range(
    family.shoulderBreak.min,
    family.shoulderBreak.max,
  );
  const compressionAngle = primaryAngle + massing.range(2.1, 4.2);
  const shoulderBreakAngle =
    compressionAngle + massing.range(0.8, 1.55) * (massing.chance(0.5) ? 1 : -1);
  // Resolve the added macro turn after the established massing values so the
  // existing compression and fracture choices retain their seeded results.
  const bodyTurnStrength = massing.range(
    family.bodyTurn.min,
    family.bodyTurn.max,
  );
  const bodyTurnAngle = compressionAngle + massing.signed(0.35);
  const desired: number[][] = [[], [], [], [], []];
  const heightOffsets: number[][] = [[], [], [], [], []];

  for (let side = 0; side < sideCount; side += 1) {
    const base = input.sideRadii[side];
    const angle = input.sideAngles[side];
    const compression =
      directionalLobe(angle, compressionAngle, family.lobeSharpness) *
      compressionStrength;
    const shoulderBreak =
      directionalLobe(angle, shoulderBreakAngle, family.lobeSharpness) *
      shoulderBreakStrength;
    const bodyTurn =
      directionalLobe(angle, bodyTurnAngle, 1.7) * bodyTurnStrength;
    const contactVariation = smoothSectorVariation(
      input.seed,
      side,
      sideCount,
      0x436f6e74,
    );
    const bellyVariation = smoothSectorVariation(
      input.seed,
      side,
      sideCount,
      0x42656c6c,
    );
    const shoulderVariation = smoothSectorVariation(
      input.seed,
      side,
      sideCount,
      0x53686f75,
    );
    const crownVariation = smoothSectorVariation(
      input.seed,
      side,
      sideCount,
      0x43726f77,
    );

    const contactRadius = Math.max(
      MIN_RADIUS,
      base - input.contactInset * (0.55 + (contactVariation + 1) * 0.32),
    );
    const bellyRadius = Math.max(
      MIN_RADIUS,
      base *
        (1 +
          bellyBulge +
          bellyVariation * family.bellyVariation -
          compression * 0.28 +
          bodyTurn * 0.4),
    );
    const shoulderRadius = Math.max(
      MIN_RADIUS,
      base -
        input.taper * shoulderHeight * 0.48 +
        base * shoulderVariation * family.shoulderVariation -
        base * (compression * 0.72 + shoulderBreak + bodyTurn * 0.6),
    );
    const topRadius = Math.max(
      MIN_RADIUS,
      (base - input.taper) *
        input.topScale *
        (1 + crownVariation * family.crownVariation * 0.55) *
        (input.silhouetteVariant === "capstone"
          ? 1
          : Math.max(0.62, 1 - compression * 0.9 - shoulderBreak * 0.55)),
    );
    const sector = random.fork(`profile-sector:${side}`);
    // Where the crown would sit if the upper body were one straight face.
    const crownSpan = (crownHeight - shoulderHeight) / (1 - shoulderHeight);
    const crownLinear =
      shoulderRadius + (topRadius - shoulderRadius) * crownSpan;
    const crownBlend =
      input.silhouetteVariant === "capstone"
        ? shoulderRadius * sector.range(0.82, 0.91) +
          topRadius * sector.range(0.12, 0.2) +
          base * crownVariation * family.crownVariation * 0.65
        : shoulderRadius * sector.range(0.7, 0.86) +
          topRadius * sector.range(0.14, 0.3) +
          base * crownVariation * family.crownVariation;
    const crownRadius = Math.max(
      topRadius + (input.silhouetteVariant === "capstone" ? 0.018 : 0.025),
      crownBlend +
        (crownLinear - crownBlend) * family.crownStraightness,
    );

    desired[0].push(contactRadius);
    desired[1].push(bellyRadius);
    desired[2].push(shoulderRadius);
    desired[3].push(crownRadius);
    desired[4].push(topRadius);

    heightOffsets[0].push(0);
    heightOffsets[1].push(
      smoothSectorVariation(input.seed, side, sideCount, 0x42656c48) *
        family.verticalVariation,
    );
    heightOffsets[2].push(
      smoothSectorVariation(input.seed, side, sideCount, 0x53686f48) *
        family.verticalVariation,
    );
    heightOffsets[3].push(
      smoothSectorVariation(input.seed, side, sideCount, 0x43726f48) *
        family.verticalVariation *
        0.8,
    );
    heightOffsets[4].push(0);
  }

  // Bound how fast the support function may turn outward, using the exact ring
  // heights the clipper will see. An earlier pass used pre-clamp heights, which
  // could make a segment redundant after per-sector height wander was clamped.
  //
  // This is a bound, not a concavity proof. It used to force strict concavity,
  // which guaranteed every ring segment produced a facet -- and a body whose
  // every segment produces a facet of similar size is the definition of the
  // dome this archetype kept reading as. Letting neighbouring segments share a
  // slope lets the clipper drop the redundant one and hand back a single tall
  // face instead of three stacked bands. Convexity is not at risk either way:
  // the body is an intersection of half-spaces.
  for (let side = 0; side < sideCount; side += 1) {
    const angle = input.sideAngles[side];
    const directionX = Math.cos(angle);
    const directionZ = Math.sin(angle);
    const heights = resolveEffectiveHeights(baseHeights, heightOffsets, side);
    const supports = desired.map(
      (ring, ringIndex) =>
        ring[side] +
        directionX * centers[ringIndex][0] +
        directionZ * centers[ringIndex][1],
    );

    let previousSlope = Number.POSITIVE_INFINITY;
    for (let ringIndex = 1; ringIndex < supports.length; ringIndex += 1) {
      const span = heights[ringIndex] - heights[ringIndex - 1];
      let slope = (supports[ringIndex] - supports[ringIndex - 1]) / span;
      if (Number.isFinite(previousSlope)) {
        let maximumSlope =
          previousSlope -
          (input.silhouetteVariant === "capstone"
            ? family.slopeTurn * 0.4
            : family.slopeTurn);
        if (ringIndex >= 2) {
          maximumSlope = Math.min(family.maximumRise, maximumSlope);
        }
        if (slope > maximumSlope) {
          const projection =
            directionX * centers[ringIndex][0] +
            directionZ * centers[ringIndex][1];
          const targetSupport =
            supports[ringIndex - 1] + maximumSlope * span;
          desired[ringIndex][side] = Math.max(
            MIN_RADIUS,
            targetSupport - projection,
          );
          supports[ringIndex] = desired[ringIndex][side] + projection;
          slope = (supports[ringIndex] - supports[ringIndex - 1]) / span;
        }
      }
      previousSlope = slope;
    }
  }

  return [
    {
      height: 0,
      centerX: 0,
      centerZ: 0,
      radii: desired[0],
      heightOffsets: heightOffsets[0],
    },
    {
      height: bellyHeight,
      centerX: bellyX,
      centerZ: bellyZ,
      radii: desired[1],
      heightOffsets: heightOffsets[1],
    },
    {
      height: shoulderHeight,
      centerX: shoulderX,
      centerZ: shoulderZ,
      radii: desired[2],
      heightOffsets: heightOffsets[2],
    },
    {
      height: crownHeight,
      centerX: crownX,
      centerZ: crownZ,
      radii: desired[3],
      heightOffsets: heightOffsets[3],
    },
    {
      height: 1,
      centerX: topX,
      centerZ: topZ,
      radii: desired[4],
      heightOffsets: heightOffsets[4],
    },
  ];
}
