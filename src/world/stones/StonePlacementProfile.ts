import type { StonePaletteKey } from "./StonePalette";
import {
  STONE_ARCHETYPE_IDS,
  type StoneArchetypeId,
} from "./StoneRecipe";
import { StoneRandom } from "./StoneRandom";
import {
  clamp01,
  smoothstep,
  type ClusterFamilyWeights,
} from "./StoneClusterTuning";

/**
 * Shared stone-placement tables.
 *
 * Cluster composition and leftover singleton/verge paths must read the same
 * archetype, scale, palette, and moss numbers. Keeping them here stops those
 * tables from forking the next time one caller needs a local tweak.
 */

export interface ArchetypeWeights {
  readonly ids: readonly StoneArchetypeId[];
  readonly weights: readonly number[];
}

export const LEVEL_WEIGHTS: readonly ArchetypeWeights[] = [
  // meadow: weathered boulders dominate; slab/block masonry reads are uncommon.
  {
    ids: STONE_ARCHETYPE_IDS,
    weights: [0.28, 0.44, 0.1, 0.05, 0.02, 0.11],
  },
  // dry steppe
  {
    ids: STONE_ARCHETYPE_IDS,
    weights: [0.22, 0.3, 0.18, 0.15, 0.05, 0.1],
  },
  // alpine
  {
    ids: STONE_ARCHETYPE_IDS,
    weights: [0.16, 0.28, 0.13, 0.15, 0.14, 0.14],
  },
];

export const SLOPE_WEIGHTS: ArchetypeWeights = {
  ids: STONE_ARCHETYPE_IDS,
  weights: [0.12, 0.2, 0.08, 0.2, 0.14, 0.26],
};

/** Moss by biome: damp meadow, dry steppe, thin alpine. */
export const BIOME_MOSS = [1, 0.3, 0.55];
export const BIOME_PALETTE: readonly StonePaletteKey[] = [
  "meadowSage",
  "steppeTan",
  "graniteGrey",
];

export const SCALE_BANDS: Record<StoneArchetypeId, readonly [number, number]> = {
  pebble: [0.4, 0.85],
  boulder: [0.8, 2.2],
  slab: [1.1, 2.6],
  block: [0.85, 2],
  shard: [1.3, 2.8],
  outcrop: [1.5, 3.4],
};

export function pickWeightedArchetype(
  weights: ArchetypeWeights,
  random: StoneRandom,
): StoneArchetypeId {
  let total = 0;
  for (const weight of weights.weights) {
    total += weight;
  }
  if (total <= 0) {
    return weights.ids[weights.ids.length - 1];
  }
  let roll = random.next() * total;
  for (let index = 0; index < weights.ids.length; index += 1) {
    roll -= weights.weights[index];
    if (roll <= 0) {
      return weights.ids[index];
    }
  }
  return weights.ids[weights.ids.length - 1];
}

export function pickFamilyArchetype(
  family: ClusterFamilyWeights,
  random: StoneRandom,
): StoneArchetypeId {
  const ids = STONE_ARCHETYPE_IDS.filter((id) => (family[id] ?? 0) > 0);
  const weights = ids.map((id) => family[id] ?? 0);
  return pickWeightedArchetype({ ids, weights }, random);
}

export function withoutPebble(weights: ArchetypeWeights): ArchetypeWeights {
  return {
    ids: weights.ids,
    weights: weights.ids.map((id, index) =>
      id === "pebble" ? 0 : weights.weights[index],
    ),
  };
}

export function scaleArchetypeWeight(
  weights: ArchetypeWeights,
  archetype: StoneArchetypeId,
  factor: number,
): ArchetypeWeights {
  return {
    ids: weights.ids,
    weights: weights.ids.map((id, index) =>
      id === archetype ? weights.weights[index] * factor : weights.weights[index],
    ),
  };
}

/**
 * Deterministic moss opportunity at a height, before cluster or member noise.
 *
 * The large independent 0.55–1.15 multiplier is gone so a family can share
 * weathering and still keep a little per-stone breakup.
 */
export function stoneMossBase(
  height: number,
  biomeIndex: number,
  surfaceRockiness: number,
  grassMinAltitude: number,
  grassMaxAltitude: number,
): number {
  const altitudeFade =
    smoothstep(height, grassMinAltitude - 4, grassMinAltitude + 10) *
    (1 - smoothstep(height, grassMaxAltitude - 45, grassMaxAltitude + 5));
  return clamp01(
    BIOME_MOSS[biomeIndex] * altitudeFade * (1 - 0.35 * surfaceRockiness),
  );
}
