import { resolveStoneProfile, type StoneProfileRing } from "./StoneProfile";
import { StoneRandom } from "./StoneRandom";

/**
 * Shape grammar for the stylized stone set.
 *
 * Each stone starts from an irregular radial footprint, then grows through a
 * contact, belly, shoulder, crown, and top profile. Broad fracture planes and
 * sparse chips articulate that macro mass without replacing it with noise.
 */

export type StoneArchetypeId =
  "pebble" | "boulder" | "slab" | "block" | "shard" | "outcrop";

export const STONE_ARCHETYPE_IDS: readonly StoneArchetypeId[] = [
  "pebble",
  "boulder",
  "slab",
  "block",
  "shard",
  "outcrop",
];

/** Broad, planar crowns are reserved for a minority of geological bodies. */
export type StoneSilhouetteVariant = "weathered" | "capstone";

const CAPSTONE_CHANCE: Readonly<Record<StoneArchetypeId, number>> = {
  pebble: 0,
  boulder: 0.1,
  slab: 0.2,
  block: 0,
  shard: 0,
  outcrop: 0.24,
};

interface Band {
  readonly min: number;
  readonly max: number;
}

export interface StoneArchetypeSpec {
  readonly id: StoneArchetypeId;
  readonly sideCount: readonly [number, number];
  /** Fractional radius jitter per side, smoothed once around the ring. */
  readonly radiusJitter: Band;
  /** Coherent low-frequency silhouette bias, independent of per-side jitter. */
  readonly silhouetteAsymmetry: Band;
  /** How much narrower the baseline profile gets per unit height. */
  readonly taper: Band;
  /** Top footprint as a fraction of the baseline upper profile. */
  readonly topScale: Band;
  /** Height reserved for the final crown transition. */
  readonly topBevelHeight: Band;
  /** Maximum top-plane slope magnitude. */
  readonly topTiltMax: number;
  /** Ground-contact inset and transition height. */
  readonly contactInset: Band;
  readonly contactBevelHeight: Band;
  /** Horizontal shear per unit height; shard leans are deliberate. */
  readonly lean: Band;
  /** Minimum and maximum structural fracture planes. */
  readonly cutCount: readonly [number, number];
  readonly cutDepth: Band;
  /** Upward component of cut-plane normals. */
  readonly cutNormalY: Band;
  /** Metre aspect ratios applied before placement scale. */
  readonly heightRatio: Band;
  readonly depthRatio: Band;
  /** Corner chips applied at close range only. */
  readonly chipCount: readonly [number, number];
  readonly chipDepth: Band;
  /** Baseline strength of the painted edge-wear accent. */
  readonly edgeWear: number;
  /** Fraction of final height sunk into the terrain at placement. */
  readonly embed: Band;
}

const ARCHETYPES: Record<StoneArchetypeId, StoneArchetypeSpec> = {
  pebble: {
    id: "pebble",
    sideCount: [6, 8],
    radiusJitter: { min: 0.1, max: 0.2 },
    silhouetteAsymmetry: { min: 0.03, max: 0.08 },
    taper: { min: 0.08, max: 0.16 },
    topScale: { min: 0.64, max: 0.82 },
    topBevelHeight: { min: 0.18, max: 0.28 },
    topTiltMax: 0.1,
    contactInset: { min: 0.06, max: 0.11 },
    contactBevelHeight: { min: 0.12, max: 0.18 },
    lean: { min: 0.01, max: 0.06 },
    cutCount: [0, 1],
    cutDepth: { min: 0.04, max: 0.08 },
    cutNormalY: { min: 0.25, max: 0.65 },
    heightRatio: { min: 0.34, max: 0.52 },
    depthRatio: { min: 0.78, max: 1.28 },
    chipCount: [0, 1],
    chipDepth: { min: 0.012, max: 0.035 },
    edgeWear: 0.32,
    embed: { min: 0.08, max: 0.16 },
  },
  boulder: {
    id: "boulder",
    // Broad sectors and a wide crown give the reference's sculpted planes.
    // Normal softening still rounds shallow breaks without turning the mass
    // into the many-sided radial dome produced by the old 10–12-sector body.
    //
    // 8-10 sectors was still a dome. Each sector contributes four ring
    // segments, so ten sides is forty side planes, and forty facets of
    // similar area is what a dome *is*, however much the radii are jittered.
    // The reference reads as five to eight visible faces. Sector count is the
    // only lever that makes an individual face large. Jitter and asymmetry go
    // up because with fewer sectors each one has to carry more of the
    // irregularity the sector count used to supply.
    sideCount: [5, 7],
    radiusJitter: { min: 0.18, max: 0.34 },
    silhouetteAsymmetry: { min: 0.18, max: 0.34 },
    taper: { min: 0.08, max: 0.16 },
    // A broad top. The reference boulder's defining feature is a large flat
    // crown, and a narrow top is what turns the loft into a cone.
    topScale: { min: 0.74, max: 0.94 },
    topBevelHeight: { min: 0.13, max: 0.22 },
    // The reference crown is a tilted plane, not a lid. A level top over a
    // low body is the read that turned into a loaf.
    topTiltMax: 0.38,
    contactInset: { min: 0.05, max: 0.11 },
    contactBevelHeight: { min: 0.09, max: 0.15 },
    // Lean carries the wedge: one end of the mass rides up and the opposite
    // shoulder drops, which is what stops a low body reading as a block.
    lean: { min: 0.14, max: 0.32 },
    cutCount: [0, 2],
    cutDepth: { min: 0.1, max: 0.21 },
    cutNormalY: { min: 0.1, max: 0.62 },
    // Wide and low. Circularity is the term that dominates the silhouette
    // score, and a convex body only escapes a circular outline by being
    // elongated or genuinely few-sided. A tall body reads as a lump from every
    // azimuth; a low one reads as a wedge.
    heightRatio: { min: 0.56, max: 0.86 },
    depthRatio: { min: 0.82, max: 1.38 },
    chipCount: [1, 2],
    chipDepth: { min: 0.015, max: 0.042 },
    edgeWear: 0.42,
    // Deeper. A boulder resting with its full contact polygon on the surface
    // shows a continuous seam all the way round, which is the read of an object
    // placed on the ground rather than one the ground has grown up around.
    embed: { min: 0.24, max: 0.36 },
  },
  slab: {
    id: "slab",
    sideCount: [6, 8],
    radiusJitter: { min: 0.12, max: 0.24 },
    silhouetteAsymmetry: { min: 0.06, max: 0.14 },
    taper: { min: 0.06, max: 0.12 },
    topScale: { min: 0.72, max: 0.9 },
    topBevelHeight: { min: 0.14, max: 0.23 },
    topTiltMax: 0.22,
    contactInset: { min: 0.05, max: 0.1 },
    contactBevelHeight: { min: 0.1, max: 0.15 },
    lean: { min: 0.01, max: 0.08 },
    cutCount: [0, 2],
    cutDepth: { min: 0.08, max: 0.16 },
    cutNormalY: { min: 0.16, max: 0.55 },
    heightRatio: { min: 0.4, max: 0.58 },
    depthRatio: { min: 0.95, max: 1.45 },
    chipCount: [1, 2],
    chipDepth: { min: 0.018, max: 0.045 },
    edgeWear: 0.43,
    embed: { min: 0.22, max: 0.35 },
  },
  block: {
    id: "block",
    sideCount: [5, 6],
    radiusJitter: { min: 0.05, max: 0.12 },
    silhouetteAsymmetry: { min: 0.04, max: 0.1 },
    taper: { min: 0.06, max: 0.13 },
    topScale: { min: 0.66, max: 0.84 },
    topBevelHeight: { min: 0.15, max: 0.24 },
    topTiltMax: 0.14,
    contactInset: { min: 0.04, max: 0.09 },
    contactBevelHeight: { min: 0.08, max: 0.13 },
    lean: { min: 0.03, max: 0.1 },
    cutCount: [1, 3],
    cutDepth: { min: 0.1, max: 0.2 },
    cutNormalY: { min: 0.08, max: 0.5 },
    heightRatio: { min: 0.6, max: 0.86 },
    depthRatio: { min: 0.76, max: 1.18 },
    chipCount: [1, 2],
    chipDepth: { min: 0.02, max: 0.055 },
    edgeWear: 0.46,
    embed: { min: 0.13, max: 0.22 },
  },
  shard: {
    id: "shard",
    sideCount: [4, 5],
    radiusJitter: { min: 0.13, max: 0.26 },
    silhouetteAsymmetry: { min: 0.12, max: 0.22 },
    taper: { min: 0.16, max: 0.28 },
    topScale: { min: 0.26, max: 0.44 },
    topBevelHeight: { min: 0.14, max: 0.22 },
    topTiltMax: 0.46,
    contactInset: { min: 0.03, max: 0.06 },
    contactBevelHeight: { min: 0.06, max: 0.1 },
    lean: { min: 0.14, max: 0.28 },
    cutCount: [2, 4],
    cutDepth: { min: 0.1, max: 0.22 },
    cutNormalY: { min: 0.08, max: 0.48 },
    heightRatio: { min: 0.72, max: 1.05 },
    depthRatio: { min: 0.68, max: 1 },
    chipCount: [1, 3],
    chipDepth: { min: 0.018, max: 0.05 },
    edgeWear: 0.38,
    embed: { min: 0.1, max: 0.18 },
  },
  outcrop: {
    id: "outcrop",
    sideCount: [7, 9],
    radiusJitter: { min: 0.16, max: 0.3 },
    silhouetteAsymmetry: { min: 0.12, max: 0.24 },
    taper: { min: 0.1, max: 0.18 },
    topScale: { min: 0.6, max: 0.82 },
    topBevelHeight: { min: 0.15, max: 0.24 },
    topTiltMax: 0.2,
    contactInset: { min: 0.04, max: 0.08 },
    contactBevelHeight: { min: 0.08, max: 0.13 },
    lean: { min: 0.03, max: 0.14 },
    cutCount: [1, 3],
    cutDepth: { min: 0.11, max: 0.22 },
    cutNormalY: { min: 0.12, max: 0.54 },
    heightRatio: { min: 0.48, max: 0.74 },
    depthRatio: { min: 1.05, max: 1.65 },
    chipCount: [1, 2],
    chipDepth: { min: 0.018, max: 0.048 },
    edgeWear: 0.36,
    embed: { min: 0.3, max: 0.46 },
  },
};

export interface StoneCut {
  /** Unit normal of the clipping half-space. */
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
  /** Fraction of the projected span removed by the cut. */
  readonly depthFraction: number;
}

/**
 * The single break that separates one fragment of a formation from its sibling.
 *
 * A stone body is an intersection of half-spaces, and a plane through a convex
 * body leaves two convex bodies, so a formation needs no CSG: the parent's
 * plane set plus this one half-space *is* the fragment. The sibling carries the
 * same plane negated, which is what makes the two broken faces complementary
 * rather than merely similar. Coordinates are the recipe's own unit body space,
 * before the width/height/depth scale.
 */
/** What part of a body a bounding plane is: shell, break, weathering, bevel. */
export type StonePlaneRole =
  | "bottom"
  | "top"
  | "side"
  | "top-bevel"
  | "contact-bevel"
  | "edge-bevel"
  | "cut"
  | "fracture";

/** A bounding plane in its final resolved position, with the role it plays. */
export interface StoneResolvedPlane {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly constant: number;
  readonly id: string;
  readonly role: StonePlaneRole;
}

/**
 * The parent's entire outer surface, frozen so both halves of a formation wear
 * it identically.
 *
 * Everything a body is clipped by is resolved *relative to that body*: cuts by
 * a depth fraction of its extent, bevels by the length of its edges. Re-running
 * any of it on a half therefore lands somewhere else, and -- worse -- lands
 * somewhere else on each half independently, which cuts the two break outlines
 * back by different amounts until the pieces no longer mate. Freezing the
 * parent's planes makes a fragment exactly what it should be: the parent's own
 * surface, intersected with one more half-space.
 *
 * Near geometry carries extra chips, so both detail levels are frozen; a chip
 * resolved on one half alone would break the mating at exactly the range where
 * it shows.
 */
export interface StoneInheritedSurface {
  readonly coarse: readonly StoneResolvedPlane[];
  readonly detailed: readonly StoneResolvedPlane[];
}

export interface StoneFractureFace {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  /** The fragment keeps the half-space `n . p <= constant`. */
  readonly constant: number;
}

export interface StoneRecipe {
  readonly archetype: StoneArchetypeId;
  readonly seed: number;
  readonly silhouetteVariant: StoneSilhouetteVariant;
  /** Final local dimensions in metres before placement scale. */
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly sideAngles: readonly number[];
  readonly sideRadii: readonly number[];
  /** Layered contact/belly/shoulder/crown/top macro silhouette. */
  readonly profileRings: readonly StoneProfileRing[];
  readonly taper: number;
  readonly topScale: number;
  readonly topBevelHeight: number;
  readonly topTiltX: number;
  readonly topTiltZ: number;
  readonly contactInset: number;
  readonly contactBevelHeight: number;
  readonly leanX: number;
  readonly leanZ: number;
  readonly cuts: readonly StoneCut[];
  /** Shallow corner breaks, applied only to close-range geometry. */
  readonly chips: readonly StoneCut[];
  readonly edgeWear: number;
  readonly embed: number;
  /** Present only on a formation fragment; absent on a whole stone. */
  readonly fracture?: StoneFractureFace;
  /** A fragment's surface, resolved once on the parent and inherited whole. */
  readonly inheritedSurface?: StoneInheritedSurface;
}

const TWO_PI = Math.PI * 2;
const BASE_RADIUS = 0.5;
const SIDE_GAP_JITTER = 0.4;
const CUT_SIMILARITY_LIMIT = 0.96;
const GOLDEN_ANGLE = 2.399963229728653;
const SILHOUETTE_RADIUS_MIN = BASE_RADIUS * 0.55;
const SILHOUETTE_RADIUS_MAX = BASE_RADIUS * 1.5;
const PRIMARY_OPTIONAL_FRACTURE_CHANCE = 0.56;
const SECONDARY_OPTIONAL_FRACTURE_CHANCE = 0.22;

function rangeOf(random: StoneRandom, band: Band): number {
  return random.range(band.min, band.max);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function resolveFractureCount(
  random: StoneRandom,
  range: readonly [number, number],
): number {
  let count = range[0];
  for (let candidate = range[0]; candidate < range[1]; candidate += 1) {
    const chance =
      candidate === 0
        ? PRIMARY_OPTIONAL_FRACTURE_CHANCE
        : SECONDARY_OPTIONAL_FRACTURE_CHANCE;
    if (!random.chance(chance)) break;
    count += 1;
  }
  return count;
}

export function resolveStoneSilhouetteVariant(
  archetypeId: StoneArchetypeId,
  seed: number,
): StoneSilhouetteVariant {
  const roll = StoneRandom.fromSeed(seed)
    .fork(`archetype:${archetypeId}`)
    .fork("silhouette-variant");
  return roll.chance(CAPSTONE_CHANCE[archetypeId]) ? "capstone" : "weathered";
}

export function resolveStoneRecipe(
  archetypeId: StoneArchetypeId,
  seed: number,
  silhouetteVariant = resolveStoneSilhouetteVariant(archetypeId, seed),
): StoneRecipe {
  const spec = ARCHETYPES[archetypeId];
  const root = StoneRandom.fromSeed(seed).fork(`archetype:${archetypeId}`);

  const dimensions = root.fork("dimensions");
  const width = 1;
  const height = rangeOf(dimensions, spec.heightRatio);
  const depth = rangeOf(dimensions, spec.depthRatio);

  const profile = root.fork("profile");
  const sideCount = profile.integer(spec.sideCount[0], spec.sideCount[1]);
  const angleOffset = profile.range(0, TWO_PI / sideCount);
  const jitterAmplitude = rangeOf(profile, spec.radiusJitter);

  const angles = root.fork("side-angles");
  const gaps: number[] = [];
  let gapTotal = 0;
  for (let side = 0; side < sideCount; side += 1) {
    const gap = 1 + angles.signed(SIDE_GAP_JITTER);
    gaps.push(gap);
    gapTotal += gap;
  }
  const sideAngles: number[] = [];
  let cumulative = angleOffset;
  for (let side = 0; side < sideCount; side += 1) {
    sideAngles.push(cumulative);
    cumulative += (gaps[side] / gapTotal) * TWO_PI;
  }

  const radii = root.fork("side-radii");
  const rawRadii: number[] = [];
  for (let side = 0; side < sideCount; side += 1) {
    rawRadii.push(BASE_RADIUS * (1 + radii.signed(jitterAmplitude)));
  }

  const silhouette = root.fork("silhouette");
  const primaryAngle = silhouette.range(0, TWO_PI);
  const secondaryAngle = primaryAngle + silhouette.range(0.9, 1.8);
  const primaryStrength = rangeOf(silhouette, spec.silhouetteAsymmetry);
  const secondaryStrength = primaryStrength * silhouette.range(0.18, 0.42);
  const sideRadii: number[] = [];
  for (let side = 0; side < sideCount; side += 1) {
    const previous = rawRadii[(side + sideCount - 1) % sideCount];
    const next = rawRadii[(side + 1) % sideCount];
    const smoothed = previous * 0.16 + rawRadii[side] * 0.68 + next * 0.16;
    const angle = sideAngles[side];
    const lobe =
      Math.cos(angle - primaryAngle) * primaryStrength +
      Math.cos((angle - secondaryAngle) * 2) * secondaryStrength;
    sideRadii.push(
      clamp(
        smoothed * (1 + lobe),
        SILHOUETTE_RADIUS_MIN,
        SILHOUETTE_RADIUS_MAX,
      ),
    );
  }

  const shape = root.fork("shape");
  const taper = rangeOf(shape, spec.taper);
  let topScale = rangeOf(shape, spec.topScale);
  let topBevelHeight = rangeOf(shape, spec.topBevelHeight);
  if (silhouetteVariant === "capstone") {
    topScale = Math.min(
      0.99,
      Math.max(0.9, topScale + shape.range(0.18, 0.28)),
    );
    topBevelHeight = shape.range(0.1, 0.15);
  }
  const topTiltAngle = shape.range(0, TWO_PI);
  const topTiltStrength =
    shape.range(0.3, 1) *
    spec.topTiltMax *
    (silhouetteVariant === "capstone" ? 0.68 : 1);
  const topTiltX = Math.cos(topTiltAngle) * topTiltStrength;
  const topTiltZ = Math.sin(topTiltAngle) * topTiltStrength;
  const contactInset = rangeOf(shape, spec.contactInset);
  const contactBevelHeight = rangeOf(shape, spec.contactBevelHeight);

  const leanStream = root.fork("lean");
  const leanAngle = leanStream.range(0, TWO_PI);
  const leanStrength = rangeOf(leanStream, spec.lean);
  const leanX = Math.cos(leanAngle) * leanStrength;
  const leanZ = Math.sin(leanAngle) * leanStrength;

  const profileRings = resolveStoneProfile(
    {
      archetype: archetypeId,
      silhouetteVariant,
      seed,
      sideAngles,
      sideRadii,
      taper,
      topScale,
      topBevelHeight,
      contactInset,
      contactBevelHeight,
    },
    root.fork("macro-profile"),
  );

  const cutAxis = root.fork("cut-axis").range(0, TWO_PI);
  const cutsStream = root.fork("cuts");
  const cutCount = resolveFractureCount(cutsStream, spec.cutCount);
  const cuts: StoneCut[] = [];
  for (let index = 0; index < cutCount; index += 1) {
    const cutStream = root.fork(`cut:${index}`);
    const normalY = rangeOf(cutStream, spec.cutNormalY);
    let azimuth = cutAxis + index * GOLDEN_ANGLE + cutStream.signed(0.5);
    const horizontal = Math.sqrt(Math.max(0, 1 - normalY * normalY));
    let attempts = 0;
    let accepted = false;
    while (attempts < 4 && !accepted) {
      const candidateX = Math.cos(azimuth) * horizontal;
      const candidateZ = Math.sin(azimuth) * horizontal;
      accepted = cuts.every(
        (existing) =>
          existing.normalX * candidateX +
            existing.normalY * normalY +
            existing.normalZ * candidateZ <
          CUT_SIMILARITY_LIMIT,
      );
      if (accepted) {
        cuts.push({
          normalX: candidateX,
          normalY,
          normalZ: candidateZ,
          depthFraction: rangeOf(cutStream, spec.cutDepth),
        });
      } else {
        azimuth += GOLDEN_ANGLE;
        attempts += 1;
      }
    }
  }

  const chipStream = root.fork("chips");
  const chipCount = chipStream.integer(spec.chipCount[0], spec.chipCount[1]);
  const chipAxis = root.fork("chip-axis").range(0, TWO_PI);
  const chips: StoneCut[] = [];
  for (let index = 0; index < chipCount; index += 1) {
    const chip = root.fork(`chip:${index}`);
    const normalY = chip.range(0.15, 0.9);
    const azimuth = chipAxis + index * GOLDEN_ANGLE + chip.signed(0.55);
    const horizontal = Math.sqrt(Math.max(0, 1 - normalY * normalY));
    chips.push({
      normalX: Math.cos(azimuth) * horizontal,
      normalY,
      normalZ: Math.sin(azimuth) * horizontal,
      depthFraction: chip.range(spec.chipDepth.min, spec.chipDepth.max),
    });
  }

  const wearStream = root.fork("wear");
  const edgeWear = spec.edgeWear * wearStream.range(0.82, 1.12);
  const embed = rangeOf(wearStream, spec.embed);

  return {
    archetype: archetypeId,
    seed,
    silhouetteVariant,
    width,
    height,
    depth,
    sideAngles,
    sideRadii,
    profileRings,
    taper,
    topScale,
    topBevelHeight,
    topTiltX,
    topTiltZ,
    contactInset,
    contactBevelHeight,
    leanX,
    leanZ,
    cuts,
    chips,
    edgeWear,
    embed,
  };
}
