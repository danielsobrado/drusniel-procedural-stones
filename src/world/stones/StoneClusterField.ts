import * as THREE from "three";
import {
  createGrassBiomeSample,
  pickGrassBiomeIndex,
  sampleGrassBiome,
} from "../grass/WorldBiomeField";
import {
  createTerrainLandform,
  type TerrainLandform,
} from "../ecology/TerrainLandformField";
import {
  createEcologySample,
  type WorldEcologySample,
} from "../ecology/WorldEcologyField";
import {
  createHydrologySample,
  type HydrologySample,
} from "../hydrology/HydrologyField";
import type { TerrainField } from "../TerrainField";
import type { WorldConfig } from "../WorldConfig";
import type { StonePaletteKey } from "./StonePalette";
import { hashStoneCell, StoneRandom } from "./StoneRandom";
import { BIOME_PALETTE } from "./StonePlacementProfile";
import {
  classifyStoneClusterProcess,
  clamp,
  clamp01,
  CLUSTER_PRIORITY_RANDOM_SHARE,
  clusterCacheKeepCount,
  clusterEnvironmentMossBase,
  clusterMinimumSeparation,
  clusterWinsConflict,
  COMPACT_ASPECT_BLEND,
  COMPACT_DIRECTION_SPREAD,
  DESCRIPTOR_CACHE_LIMIT,
  DOWNHILL_GRADIENT_EPSILON,
  FAN_ASPECT_BLEND,
  fillClusterConflictNeighbors,
  lerp,
  packLatticeKey,
  RAW_CANDIDATE_CACHE_LIMIT,
  SCREE_ASPECT_BLEND,
  smoothstep,
  STONE_CLUSTER_DOMAIN,
  STONE_GEOLOGY_FINE_SEED_XOR,
  STONE_ROCK_SEED_XOR,
  STONE_STRIKE_SEED_XOR,
  STRIKE_PERIOD,
  trimOldestCacheEntries,
  uplandGeologyBoost,
  type StoneClusterProcess,
  type StoneMacroCoord,
} from "./StoneClusterTuning";

/**
 * Response knees for macro activation, calibrated against the suitability the
 * shipped world actually produces (p50 0.00, p90 0.17, p99 0.43, max 0.90).
 *
 * The original 0.14..0.72 band was written for a suitability that reaches its
 * top knee, but `surfaceVisibility` floors at 0.18 wherever ecology rockiness
 * is zero — half the world — so real suitability never approaches 0.72 and the
 * smoothstep returned ~0 for nine sites in ten. That left 4 live formations in
 * 841 macro cells: one per 654 m, which reads as a world with no geology at
 * all. These knees sit inside the observed range, so the ranking by geology and
 * rockiness is unchanged and only the mapping onto it is honest.
 */
const STONE_CLUSTER_SUITABILITY_KNEE_LOW = 0.02;
const STONE_CLUSTER_SUITABILITY_KNEE_HIGH = 0.24;

/**
 * Member budget knees, calibrated the same way and for the same reason. The
 * original 0.25..0.80 band sat above almost every live cluster's suitability,
 * so `budgetT` was 0 and every formation in the world resolved to exactly
 * `stoneClusterBudgetMin` members — four, always. A world where each outcrop
 * has the same part count reads generated rather than authored, which is the
 * opposite of what the size-hierarchy goal asks for. These knees span the
 * suitability that surviving clusters actually hold, so budget varies across
 * the configured 4..8 range again.
 */
const STONE_CLUSTER_BUDGET_KNEE_LOW = 0.08;
const STONE_CLUSTER_BUDGET_KNEE_HIGH = 0.45;

/**
 * How much a walking way suppresses macro formations around it.
 *
 * At the original 0.9 the disturbance field left a hole in the geology roughly
 * 40 m either side of every path: measured against the ground available, stones
 * landed at index 0.38 in the 6-15 m band and 0.17 in the 15-40 m band, while
 * the kicked-aside verge sat at 18.1. A trail therefore read as a tidy kerb of
 * pebbles inside an unnaturally clean corridor. Paths should sweep their own
 * surface clear — which the separate clearance and verge passes already do —
 * not sterilise the country they cross.
 */
const STONE_CLUSTER_PATH_SUPPRESSION = 0.55;


export interface StoneClusterCandidate {
  readonly gridX: number;
  readonly gridZ: number;
  readonly seed: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly height: number;
  readonly geologyPotential: number;
  readonly moisture: number;
  readonly fertility: number;
  readonly exposure: number;
  readonly disturbance: number;
  readonly surfaceRockiness: number;
  readonly landformSlope: number;
  readonly landformConvexity: number;
  readonly landformGradientX: number;
  readonly landformGradientZ: number;
  readonly suitability: number;
  readonly rawActive: boolean;
  readonly priority: number;
  readonly process: StoneClusterProcess;
  readonly strike: number;
  readonly direction: number;
  readonly majorRadius: number;
  readonly minorRadius: number;
  readonly influenceRadius: number;
  readonly budget: number;
  readonly biomeIndex: number;
  readonly paletteKey: StonePaletteKey;
  readonly valueBase: number;
  readonly mossBase: number;
  readonly mossBias: number;
}

export interface StoneClusterDescriptor extends StoneClusterCandidate {
  readonly active: boolean;
}

/**
 * Macro geological lattice for world stones.
 *
 * Raw candidates are independent of neighbors. Final descriptors apply
 * eight-neighbor conflict suppression. Terrain and ecology are sampled once
 * per uncached raw candidate at the jittered center.
 */
export class StoneClusterField {
  private readonly rawCandidates = new Map<number, StoneClusterCandidate>();
  private readonly descriptors = new Map<number, StoneClusterDescriptor>();
  private readonly rockSeed: number;
  private readonly landformScratch: TerrainLandform = createTerrainLandform();
  private readonly hydrologyScratch: HydrologySample = createHydrologySample();
  private readonly pathScratch = new THREE.Vector2();
  private readonly ecologyScratch: WorldEcologySample = createEcologySample();
  private readonly biomeScratch = createGrassBiomeSample();
  private readonly conflictScratch: StoneMacroCoord[] = [];
  private fullTerrainSamples = 0;

  constructor(
    private readonly field: TerrainField,
    private readonly config: WorldConfig,
  ) {
    this.rockSeed = (config.seed ^ STONE_ROCK_SEED_XOR) >>> 0;
  }

  getRawCandidate(gridX: number, gridZ: number): StoneClusterCandidate {
    const key = packLatticeKey(gridX, gridZ);
    const cached = this.rawCandidates.get(key);
    if (cached) {
      return cached;
    }
    const candidate = this.createRawCandidate(gridX, gridZ);
    if (this.rawCandidates.size >= RAW_CANDIDATE_CACHE_LIMIT) {
      trimOldestCacheEntries(
        this.rawCandidates,
        clusterCacheKeepCount(RAW_CANDIDATE_CACHE_LIMIT),
      );
    }
    this.rawCandidates.set(key, candidate);
    return candidate;
  }

  getDescriptor(gridX: number, gridZ: number): StoneClusterDescriptor {
    const key = packLatticeKey(gridX, gridZ);
    const cached = this.descriptors.get(key);
    if (cached) {
      return cached;
    }
    const raw = this.getRawCandidate(gridX, gridZ);
    const descriptor: StoneClusterDescriptor = {
      ...raw,
      active: raw.rawActive && this.winsConflict(raw),
    };
    if (this.descriptors.size >= DESCRIPTOR_CACHE_LIMIT) {
      trimOldestCacheEntries(
        this.descriptors,
        clusterCacheKeepCount(DESCRIPTOR_CACHE_LIMIT),
      );
    }
    this.descriptors.set(key, descriptor);
    return descriptor;
  }

  getFullTerrainSampleCount(): number {
    return this.fullTerrainSamples;
  }

  sampleGeologyPotential(x: number, z: number): number {
    const coarse = this.valueNoise(x / 240, z / 240, this.rockSeed);
    const fine = this.valueNoise(
      (x * 2.7) / 240,
      (z * 2.7) / 240,
      this.rockSeed ^ STONE_GEOLOGY_FINE_SEED_XOR,
    );
    const field = (coarse + fine * 0.4) / 1.4;
    return smoothstep(field, 0.52, 0.78);
  }

  sampleStrike(x: number, z: number): number {
    return (
      this.valueNoise(
        x / STRIKE_PERIOD,
        z / STRIKE_PERIOD,
        this.rockSeed ^ STONE_STRIKE_SEED_XOR,
      ) * Math.PI
    );
  }

  private winsConflict(raw: StoneClusterCandidate): boolean {
    const count = fillClusterConflictNeighbors(
      raw.gridX,
      raw.gridZ,
      this.conflictScratch,
    );
    const spacing = this.config.stoneClusterSpacing;
    for (let index = 0; index < count; index += 1) {
      const slot = this.conflictScratch[index];
      const neighbor = this.getRawCandidate(slot.gridX, slot.gridZ);
      if (!neighbor.rawActive) {
        continue;
      }
      const distance = Math.hypot(
        raw.centerX - neighbor.centerX,
        raw.centerZ - neighbor.centerZ,
      );
      const minimum = clusterMinimumSeparation(
        spacing,
        raw.influenceRadius,
        neighbor.influenceRadius,
      );
      if (distance >= minimum) {
        continue;
      }
      if (
        !clusterWinsConflict(
          raw.priority,
          raw.gridX,
          raw.gridZ,
          neighbor.priority,
          neighbor.gridX,
          neighbor.gridZ,
        )
      ) {
        return false;
      }
    }
    return true;
  }

  private createRawCandidate(
    gridX: number,
    gridZ: number,
  ): StoneClusterCandidate {
    const spacing = this.config.stoneClusterSpacing;
    const seed = hashStoneCell(
      gridX,
      gridZ,
      (this.config.seed ^ STONE_CLUSTER_DOMAIN) >>> 0,
    );
    const rng = StoneRandom.fromSeed(seed);
    const jitter = this.config.stoneClusterCenterJitter;
    const centerX =
      (gridX + 0.5 + rng.fork("center-x").signed(jitter)) * spacing;
    const centerZ =
      (gridZ + 0.5 + rng.fork("center-z").signed(jitter)) * spacing;
    const geologyPotential = this.sampleGeologyPotential(centerX, centerZ);
    if (
      !(geologyPotential > 0) ||
      this.config.stoneDensity <= 0 ||
      this.config.stoneClusterChance <= 0
    ) {
      return quietCandidate(
        gridX,
        gridZ,
        seed,
        centerX,
        centerZ,
        geologyPotential,
      );
    }

    this.fullTerrainSamples += 1;
    const height = this.field.sampleHeight(centerX, centerZ);
    // Hydrology must run before landform. `sampleHeight` leaves a same-point
    // carve cache that `sampleHydrology` consumes; landform lattice misses
    // call `sampleHeight` at other points and would make moisture depend on
    // whether those lattice cells were already memoized.
    const hydrology = this.field.sampleHydrology(
      centerX,
      centerZ,
      height,
      this.hydrologyScratch,
    );
    const pathDistances = this.field.samplePathDistances(
      centerX,
      centerZ,
      this.pathScratch,
    );
    const landform = this.field.sampleLandform(
      centerX,
      centerZ,
      this.landformScratch,
    );
    const landformSnapshot: TerrainLandform = {
      convexity: landform.convexity,
      slope: landform.slope,
      gradientX: landform.gradientX,
      gradientZ: landform.gradientZ,
    };
    const ecology = this.field.resolveEcologyFromLandform(
      centerX,
      centerZ,
      height,
      landformSnapshot,
      hydrology,
      pathDistances,
      this.ecologyScratch,
    );
    const moisture = ecology.moisture;
    const fertility = ecology.fertility;
    const exposure = ecology.exposure;
    const disturbance = ecology.disturbance;
    const surfaceRockiness = ecology.rockiness;
    const suitability = clamp01(
      geologyPotential *
        (0.18 + 0.82 * surfaceRockiness) *
        (1 - STONE_CLUSTER_PATH_SUPPRESSION * disturbance) *
        uplandGeologyBoost(
          height,
          this.config.grassMinAltitude,
          this.config.grassMaxAltitude,
        ),
    );
    const densityResponse =
      1 -
      Math.exp(
        -this.config.stoneClusterDensityResponse * this.config.stoneDensity,
      );
    const suitabilityResponse = smoothstep(
      suitability,
      STONE_CLUSTER_SUITABILITY_KNEE_LOW,
      STONE_CLUSTER_SUITABILITY_KNEE_HIGH,
    );
    const rawActive = rng
      .fork("activation")
      .chance(
        clamp01(
          this.config.stoneClusterChance * densityResponse * suitabilityResponse,
        ),
      );
    const process = classifyStoneClusterProcess(
      landformSnapshot.slope,
      landformSnapshot.convexity,
    );
    if (!rawActive) {
      return {
        ...quietCandidate(
          gridX,
          gridZ,
          seed,
          centerX,
          centerZ,
          geologyPotential,
        ),
        height,
        moisture,
        fertility,
        exposure,
        disturbance,
        surfaceRockiness,
        landformSlope: landformSnapshot.slope,
        landformConvexity: landformSnapshot.convexity,
        landformGradientX: landformSnapshot.gradientX,
        landformGradientZ: landformSnapshot.gradientZ,
        suitability,
        process,
      };
    }

    const biome = sampleGrassBiome(centerX, centerZ, this.biomeScratch);
    const biomeIndex = pickGrassBiomeIndex(centerX, centerZ, biome);
    const priority =
      suitability * (1 - CLUSTER_PRIORITY_RANDOM_SHARE) +
      rng.fork("priority").next() * CLUSTER_PRIORITY_RANDOM_SHARE;
    const strike = this.sampleStrike(centerX, centerZ);
    const gradientLength = Math.hypot(
      landformSnapshot.gradientX,
      landformSnapshot.gradientZ,
    );
    const downhillAngle =
      gradientLength >= DOWNHILL_GRADIENT_EPSILON
        ? Math.atan2(-landformSnapshot.gradientZ, -landformSnapshot.gradientX)
        : strike;
    const directionJitter = rng.fork("direction").signed(COMPACT_DIRECTION_SPREAD);
    let direction: number;
    if (process === "compact") {
      direction = strike + directionJitter;
    } else if (process === "ridge") {
      direction = strike;
    } else {
      direction = downhillAngle;
    }

    const radiusT = smoothstep(suitability, 0.2, 0.85);
    const baseRadius = lerp(
      this.config.stoneClusterRadiusMin,
      this.config.stoneClusterRadiusMax,
      radiusT,
    );
    const majorRadius = clamp(
      baseRadius * rng.fork("radius").range(0.9, 1.1),
      this.config.stoneClusterRadiusMin,
      this.config.stoneClusterRadiusMax,
    );
    let aspect = rng
      .fork("aspect")
      .range(this.config.stoneClusterAspectMin, this.config.stoneClusterAspectMax);
    if (process === "compact") {
      aspect = lerp(aspect, 0.95, COMPACT_ASPECT_BLEND);
    } else if (process === "scree") {
      aspect = lerp(aspect, this.config.stoneClusterAspectMin, SCREE_ASPECT_BLEND);
    } else if (process === "fan") {
      aspect = lerp(aspect, 0.88, FAN_ASPECT_BLEND);
    }
    const minorRadius = majorRadius * aspect;
    const influenceRadius = majorRadius * this.config.stoneClusterHaloRatio;
    const budgetT = smoothstep(
      suitability,
      STONE_CLUSTER_BUDGET_KNEE_LOW,
      STONE_CLUSTER_BUDGET_KNEE_HIGH,
    );
    const budget = clamp(
      Math.round(
        lerp(
          this.config.stoneClusterBudgetMin,
          this.config.stoneClusterBudgetMax,
          budgetT,
        ),
      ),
      this.config.stoneClusterBudgetMin,
      this.config.stoneClusterBudgetMax,
    );
    const valueBase = rng.fork("value-base").range(0.97, 1.03);
    const mossBias = rng.fork("moss-bias").range(0.9, 1.1);
    const mossyHit = rng
      .fork("mossy-palette")
      .chance(clamp01(0.1 + moisture * 0.22 - exposure * 0.08));
    let paletteKey = BIOME_PALETTE[biomeIndex] ?? BIOME_PALETTE[0];
    if (paletteKey === "meadowSage" && moisture >= 0.42 && mossyHit) {
      paletteKey = "mossy";
    }

    return {
      gridX,
      gridZ,
      seed,
      centerX,
      centerZ,
      height,
      geologyPotential,
      moisture,
      fertility,
      exposure,
      disturbance,
      surfaceRockiness,
      landformSlope: landformSnapshot.slope,
      landformConvexity: landformSnapshot.convexity,
      landformGradientX: landformSnapshot.gradientX,
      landformGradientZ: landformSnapshot.gradientZ,
      suitability,
      rawActive,
      priority,
      process,
      strike,
      direction,
      majorRadius,
      minorRadius,
      influenceRadius,
      budget,
      biomeIndex,
      paletteKey,
      valueBase,
      mossBase: clusterEnvironmentMossBase(
        height,
        moisture,
        exposure,
        surfaceRockiness,
        this.config.grassMinAltitude,
        this.config.grassMaxAltitude,
      ),
      mossBias,
    };
  }

  private valueNoise(x: number, z: number, seed: number): number {
    const cellX = Math.floor(x);
    const cellZ = Math.floor(z);
    const fractionX = x - cellX;
    const fractionZ = z - cellZ;
    const weightX = fractionX * fractionX * (3 - 2 * fractionX);
    const weightZ = fractionZ * fractionZ * (3 - 2 * fractionZ);
    const corner00 = hashStoneCell(cellX, cellZ, seed) / 4294967296;
    const corner10 = hashStoneCell(cellX + 1, cellZ, seed) / 4294967296;
    const corner01 = hashStoneCell(cellX, cellZ + 1, seed) / 4294967296;
    const corner11 = hashStoneCell(cellX + 1, cellZ + 1, seed) / 4294967296;
    const lower = corner00 + (corner10 - corner00) * weightX;
    const upper = corner01 + (corner11 - corner01) * weightX;
    return lower + (upper - lower) * weightZ;
  }
}

function quietCandidate(
  gridX: number,
  gridZ: number,
  seed: number,
  centerX: number,
  centerZ: number,
  geologyPotential: number,
): StoneClusterCandidate {
  return {
    gridX,
    gridZ,
    seed,
    centerX,
    centerZ,
    height: 0,
    geologyPotential,
    moisture: 0,
    fertility: 0,
    exposure: 0,
    disturbance: 0,
    surfaceRockiness: 0,
    landformSlope: 0,
    landformConvexity: 0,
    landformGradientX: 0,
    landformGradientZ: 0,
    suitability: 0,
    rawActive: false,
    priority: 0,
    process: "compact",
    strike: 0,
    direction: 0,
    majorRadius: 0,
    minorRadius: 0,
    influenceRadius: 0,
    budget: 0,
    biomeIndex: 0,
    paletteKey: BIOME_PALETTE[0],
    valueBase: 1,
    mossBase: 0,
    mossBias: 1,
  };
}
