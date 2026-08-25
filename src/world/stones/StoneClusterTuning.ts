import { ECOLOGY_ROCK_SLOPE_START } from "../ecology/WorldEcologyTuning";
import { STONE_ARCHETYPE_IDS, type StoneArchetypeId } from "./StoneRecipe";

/**
 * Algorithm constants for macro stone geology.
 *
 * Production art knobs live in YAML. This file is the closed set of named
 * thresholds, family tables, and reach math the placement algorithm is allowed
 * to depend on. If a process is consistently wrong, change it here and cover
 * it with a deterministic test rather than adding another config slider.
 */

export type StoneClusterProcess = "compact" | "ridge" | "scree" | "fan";
export type StoneClusterRole = "anchor" | "secondary" | "debris";

export const STONE_CLUSTER_DOMAIN = 0x434c5354;
export const STONE_CELL_DOMAIN = 0x570e5;
export const STONE_ROCK_SEED_XOR = 0x51f0e5;
export const STONE_STRIKE_SEED_XOR = 0x5bd1e995;
export const STONE_GEOLOGY_FINE_SEED_XOR = 0x9e3779b9;

/** Metres per cell of the geological strike field. */
export const STRIKE_PERIOD = 130;

export const STONE_CLUSTER_RIDGE_CONVEXITY = 0.25;
export const STONE_CLUSTER_FAN_CONCAVITY = -0.25;
export const STONE_CLUSTER_FAN_MIN_SLOPE = 0.08;

export const STONE_CLUSTER_MEMBER_JITTER = 0.035;
export const STONE_CLUSTER_FAN_MAX_LATERAL = 0.68;

export const STONE_CLUSTER_DESCRIPTOR_CACHE_LIMIT = 512;
export const STONE_CLUSTER_RESOLVED_CACHE_LIMIT = 256;
export const STONE_CLUSTER_CACHE_KEEP_RATIO = 0.6;
export const STONE_CELL_MACRO_QUERY_COUNT = 9;
export const STONE_CELL_SOURCE_MARGIN = 1;
/** Packed lattice keys stay unique for indices in ±16383. */
export const LATTICE_KEY_OFFSET = 16384;
export const LATTICE_KEY_STRIDE = 32768;
export const RAW_CANDIDATE_CACHE_LIMIT = 512;
export const DESCRIPTOR_CACHE_LIMIT = 512;
export const CLUSTER_MIN_SPACING_RATIO = 0.68;
export const CLUSTER_INFLUENCE_SEPARATION_RATIO = 0.88;
export const CLUSTER_PRIORITY_RANDOM_SHARE = 0.18;
export const GOLDEN_ANGLE = 2.399963229728653;
export const CONFLICT_NEIGHBOR_COUNT = 8;
export const DOWNHILL_GRADIENT_EPSILON = 0.02;
export const RIDGE_CONVEXITY_MIN = STONE_CLUSTER_RIDGE_CONVEXITY;
export const FAN_CONVEXITY_MAX = STONE_CLUSTER_FAN_CONCAVITY;
export const FAN_SLOPE_MIN = STONE_CLUSTER_FAN_MIN_SLOPE;

export const MEMBER_LABELS = [
  "member:0",
  "member:1",
  "member:2",
  "member:3",
  "member:4",
  "member:5",
  "member:6",
  "member:7",
  "member:8",
  "member:9",
  "member:10",
  "member:11",
] as const;

export const ANCHOR_BIOME_MULTIPLIERS: readonly (readonly number[])[] = [
  [0.0, 1.2, 1.15, 0.65, 0.15, 0.75],
  [0.0, 1.0, 1.15, 1.05, 0.75, 0.95],
  [0.0, 0.85, 1.0, 1.1, 1.2, 1.25],
];

export const SPLIT_CORE_OFFSET_FACTOR = 0.6;

export const OVERLAP_FOOTPRINT_FACTOR = 0.78;
export const OVERLAP_PADDING = 0.12;
export const OVERLAP_PUSH_EXTRA = 0.04;
export const OVERLAP_COINCIDENT_EPSILON = 1e-6;
export const CLUSTER_INFLUENCE_EPSILON = 1e-6;

export const ROLE_YAW_EXTRA: Readonly<Record<StoneClusterRole, number>> = {
  anchor: 0,
  secondary: 0.1,
  debris: 0.28,
};

export const COMPACT_DIRECTION_SPREAD = 0.35;
export const COMPACT_ASPECT_BLEND = 0.55;
export const SCREE_ASPECT_BLEND = 0.45;
export const FAN_ASPECT_BLEND = 0.45;

export type ClusterFamilyWeights = Readonly<
  Partial<Record<StoneArchetypeId, number>>
>;

export const SECONDARY_FAMILY: Readonly<
  Record<StoneArchetypeId, ClusterFamilyWeights>
> = {
  pebble: { pebble: 1 },
  boulder: { boulder: 0.55, slab: 0.2, block: 0.15, shard: 0.1 },
  slab: { slab: 0.5, block: 0.2, boulder: 0.2, shard: 0.1 },
  block: { block: 0.5, shard: 0.2, boulder: 0.2, slab: 0.1 },
  outcrop: { block: 0.35, shard: 0.3, slab: 0.2, boulder: 0.15 },
  shard: { shard: 0.5, block: 0.25, boulder: 0.15, slab: 0.1 },
};

export const DEBRIS_FAMILY: Readonly<
  Record<StoneArchetypeId, ClusterFamilyWeights>
> = {
  pebble: { pebble: 1 },
  boulder: { pebble: 0.7, boulder: 0.3 },
  slab: { pebble: 0.55, slab: 0.25, shard: 0.2 },
  block: { pebble: 0.45, block: 0.3, shard: 0.25 },
  outcrop: { pebble: 0.35, shard: 0.35, block: 0.3 },
  shard: { pebble: 0.45, shard: 0.55 },
};

export function clamp(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

export function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

export function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

export function smoothstep(
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (value <= minimum) {
    return 0;
  }
  if (value >= maximum) {
    return 1;
  }
  const amount = (value - minimum) / (maximum - minimum);
  return amount * amount * (3 - 2 * amount);
}

/**
 * Fan/scree authored offsets can exceed the circular influence used for the
 * 3x3 broad phase. Production influence stays `major * halo`; this helper is
 * only for tests that need the unclamped ellipse envelope.
 */
export function maxNormalizedReach(halo: number): number {
  return Math.hypot(
    halo + STONE_CLUSTER_MEMBER_JITTER,
    halo * STONE_CLUSTER_FAN_MAX_LATERAL + STONE_CLUSTER_MEMBER_JITTER,
  );
}

export function clusterCacheKeepCount(limit: number): number {
  return Math.floor(limit * STONE_CLUSTER_CACHE_KEEP_RATIO);
}

export function trimOldestCacheEntries<K, V>(
  cache: Map<K, V>,
  keep: number,
): void {
  for (const key of cache.keys()) {
    if (cache.size <= keep) {
      return;
    }
    cache.delete(key);
  }
}

export function clusterGridKey(gridX: number, gridZ: number): string {
  return `${gridX}:${gridZ}`;
}

export function packLatticeKey(x: number, z: number): number {
  return (
    (z + LATTICE_KEY_OFFSET) * LATTICE_KEY_STRIDE + (x + LATTICE_KEY_OFFSET)
  );
}

export function stoneSourceCellCacheLimit(
  radiusChunks: number,
  chunkSize: number,
  cellSize: number,
  margin: number = STONE_CELL_SOURCE_MARGIN,
): number {
  const ringChunks = 2 * radiusChunks + 1;
  const cellsPerChunkAxis = chunkSize / cellSize;
  const cellsAxis = ringChunks * cellsPerChunkAxis + 2 * margin;
  return cellsAxis * cellsAxis;
}

export function classifyStoneClusterProcess(
  slope: number,
  convexity: number,
): StoneClusterProcess {
  if (slope >= ECOLOGY_ROCK_SLOPE_START) {
    return "scree";
  }
  if (convexity >= STONE_CLUSTER_RIDGE_CONVEXITY) {
    return "ridge";
  }
  if (
    convexity <= STONE_CLUSTER_FAN_CONCAVITY &&
    slope >= STONE_CLUSTER_FAN_MIN_SLOPE
  ) {
    return "fan";
  }
  return "compact";
}

/**
 * Upland bedrock exposure, shared by every stone population.
 *
 * Thin soil and stripped slopes put more rock at the surface with altitude, and
 * the shipped world had no altitude term anywhere: stones landed at index
 * 0.82-0.89 through the p50-p90 height bands, slightly rarer on the hills than
 * on the flats. Knees sit low in the normalised range because the grass
 * altitude span covers ground far higher than ordinary rolling country — at
 * 0.16..0.62 an average hilltop earned almost none of the boost.
 */
export function uplandGeologyBoost(
  height: number,
  grassMinAltitude: number,
  grassMaxAltitude: number,
): number {
  const span = Math.max(1, grassMaxAltitude - grassMinAltitude);
  const altitude = clamp01((height - grassMinAltitude) / span);
  return 1 + 0.85 * smoothstep(altitude, 0.12, 0.4);
}

export function singletonProbability(
  geologyPotential: number,
  surfaceRockiness: number,
  singletonChance: number,
  uplandBoost = 1,
): number {
  const suitability = geologyPotential * (0.25 + 0.75 * surfaceRockiness);
  return singletonChance * lerp(0.35, 1, clamp01(suitability)) * uplandBoost;
}

export function clusterRoleCounts(budget: number): {
  secondaryCount: number;
  debrisCount: number;
} {
  const secondaryCount = clamp(Math.floor((budget - 1) * 0.35), 1, 2);
  return {
    secondaryCount,
    debrisCount: budget - 1 - secondaryCount,
  };
}

/** Shortest signed difference on a π-period axis, not a 2π heading. */
export function axisDelta(from: number, to: number): number {
  const period = Math.PI;
  const half = period * 0.5;
  return ((((to - from + half) % period) + period) % period) - half;
}

export function axisLerp(from: number, to: number, amount: number): number {
  return from + axisDelta(from, to) * amount;
}

export interface StoneMacroCoord {
  gridX: number;
  gridZ: number;
}

export function fillStoneCellMacroCoordinates(
  cellX: number,
  cellZ: number,
  cellSize: number,
  spacing: number,
  out: StoneMacroCoord[],
): number {
  const cellCenterX = (cellX + 0.5) * cellSize;
  const cellCenterZ = (cellZ + 0.5) * cellSize;
  const macroX = Math.floor(cellCenterX / spacing);
  const macroZ = Math.floor(cellCenterZ / spacing);
  let index = 0;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const slot = out[index] ?? (out[index] = { gridX: 0, gridZ: 0 });
      slot.gridX = macroX + dx;
      slot.gridZ = macroZ + dz;
      index += 1;
    }
  }
  return STONE_CELL_MACRO_QUERY_COUNT;
}

export function clusterInfluenceIntersectsAabb(
  centerX: number,
  centerZ: number,
  influenceRadius: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): boolean {
  const dx = Math.max(minX - centerX, 0, centerX - maxX);
  const dz = Math.max(minZ - centerZ, 0, centerZ - maxZ);
  return dx * dx + dz * dz <= influenceRadius * influenceRadius;
}

export function clusterPointInsideInfluence(
  centerX: number,
  centerZ: number,
  influenceRadius: number,
  x: number,
  z: number,
): boolean {
  const offsetX = x - centerX;
  const offsetZ = z - centerZ;
  return (
    offsetX * offsetX + offsetZ * offsetZ <= influenceRadius * influenceRadius
  );
}

export function clampClusterLocalToInfluence(
  localU: number,
  localV: number,
  majorRadius: number,
  minorRadius: number,
  influenceRadius: number,
): { u: number; v: number } {
  const worldU = localU * majorRadius;
  const worldV = localV * minorRadius;
  const reach = Math.hypot(worldU, worldV);
  const limit = Math.max(0, influenceRadius * (1 - CLUSTER_INFLUENCE_EPSILON));
  if (!(reach > limit) || limit <= 0) {
    return { u: localU, v: localV };
  }
  const scale = limit / reach;
  return { u: localU * scale, v: localV * scale };
}

export function stoneClusterMemberLabel(index: number): string {
  return MEMBER_LABELS[index] ?? `member:${index}`;
}

export function clusterLocalToWorld(
  centerX: number,
  centerZ: number,
  direction: number,
  majorRadius: number,
  minorRadius: number,
  localU: number,
  localV: number,
): { x: number; z: number } {
  const dirX = Math.cos(direction);
  const dirZ = Math.sin(direction);
  const perpX = -dirZ;
  const perpZ = dirX;
  return {
    x: centerX + dirX * (localU * majorRadius) + perpX * (localV * minorRadius),
    z: centerZ + dirZ * (localU * majorRadius) + perpZ * (localV * minorRadius),
  };
}

export function clusterRadialWorld(
  direction: number,
  majorRadius: number,
  minorRadius: number,
  localU: number,
  localV: number,
): { x: number; z: number } {
  const dirX = Math.cos(direction);
  const dirZ = Math.sin(direction);
  const perpX = -dirZ;
  const perpZ = dirX;
  return {
    x: dirX * (localU * majorRadius) + perpX * (localV * minorRadius),
    z: dirZ * (localU * majorRadius) + perpZ * (localV * minorRadius),
  };
}

export function archetypeBiomeMultiplier(
  archetype: StoneArchetypeId,
  biomeIndex: number,
): number {
  const row =
    ANCHOR_BIOME_MULTIPLIERS[biomeIndex] ?? ANCHOR_BIOME_MULTIPLIERS[0];
  const index = STONE_ARCHETYPE_IDS.indexOf(archetype);
  return index >= 0 ? row[index] : 1;
}

export function clusterMinimumSeparation(
  spacing: number,
  influenceA: number,
  influenceB: number,
): number {
  return Math.max(
    spacing * CLUSTER_MIN_SPACING_RATIO,
    (influenceA + influenceB) * CLUSTER_INFLUENCE_SEPARATION_RATIO,
  );
}

export function clusterWinsConflict(
  priority: number,
  gridX: number,
  gridZ: number,
  otherPriority: number,
  otherGridX: number,
  otherGridZ: number,
): boolean {
  if (priority !== otherPriority) {
    return priority > otherPriority;
  }
  if (gridX !== otherGridX) {
    return gridX < otherGridX;
  }
  return gridZ < otherGridZ;
}

export function fillClusterConflictNeighbors(
  gridX: number,
  gridZ: number,
  out: StoneMacroCoord[],
): number {
  let index = 0;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dz === 0) {
        continue;
      }
      const slot = out[index] ?? (out[index] = { gridX: 0, gridZ: 0 });
      slot.gridX = gridX + dx;
      slot.gridZ = gridZ + dz;
      index += 1;
    }
  }
  return CONFLICT_NEIGHBOR_COUNT;
}

export function clusterEnvironmentMossBase(
  height: number,
  moisture: number,
  exposure: number,
  rockiness: number,
  grassMinAltitude: number,
  grassMaxAltitude: number,
): number {
  const altitudeFade =
    smoothstep(height, grassMinAltitude - 4, grassMinAltitude + 10) *
    (1 - smoothstep(height, grassMaxAltitude - 45, grassMaxAltitude + 5));
  return clamp01(
    smoothstep(moisture, 0.16, 0.72) *
      lerp(1.12, 0.78, exposure) *
      lerp(1.0, 0.72, rockiness) *
      altitudeFade,
  );
}

export function resolveOverlapPush(
  x: number,
  z: number,
  existingX: number,
  existingZ: number,
  candidateFootprint: number,
  existingFootprint: number,
  radialX: number,
  radialZ: number,
  fallbackX: number,
  fallbackZ: number,
): { x: number; z: number } | undefined {
  let pushX = x - existingX;
  let pushZ = z - existingZ;
  let length = Math.hypot(pushX, pushZ);
  if (length < OVERLAP_COINCIDENT_EPSILON) {
    pushX = radialX;
    pushZ = radialZ;
    length = Math.hypot(pushX, pushZ);
    if (length < OVERLAP_COINCIDENT_EPSILON) {
      pushX = fallbackX;
      pushZ = fallbackZ;
      length = Math.hypot(pushX, pushZ);
      if (length < OVERLAP_COINCIDENT_EPSILON) {
        return undefined;
      }
    }
  }
  const minimum =
    OVERLAP_FOOTPRINT_FACTOR * (candidateFootprint + existingFootprint) +
    OVERLAP_PADDING;
  const current = Math.hypot(x - existingX, z - existingZ);
  const needed = minimum - current + OVERLAP_PUSH_EXTRA;
  if (!(needed > 0) || !(length > 0)) {
    return undefined;
  }
  const inv = 1 / length;
  return {
    x: x + pushX * inv * needed,
    z: z + pushZ * inv * needed,
  };
}
