import * as THREE from "three";
import {
  createHydrologySample,
  type HydrologySample,
} from "./hydrology/HydrologyField";
import type { TerrainLandform } from "./ecology/TerrainLandformField";
import {
  createEcologySample,
  type WorldEcologySample,
} from "./ecology/WorldEcologyField";

/**
 * Lab stand-in for FluffyGrass's TerrainField.
 *
 * The stone systems sample the ground through this API. The lab has no rivers,
 * paths, or canopy: the ground is a deterministic rolling value-noise field
 * (flat when `rollingHeight` is 0), hydrology is a still optional waterline,
 * and ecology is derived directly from slope and moisture.
 */
export interface LabTerrainOptions {
  seed: number;
  /** Peak-to-trough amplitude of the rolling ground, in metres. */
  rollingHeight: number;
  /** World metres covered by one noise cell. */
  rollingScale: number;
  /** Still water level in metres, or null for a dry world. */
  waterLevel: number | null;
}

export const DEFAULT_LAB_TERRAIN: LabTerrainOptions = {
  seed: 1,
  rollingHeight: 2.4,
  rollingScale: 46,
  waterLevel: null,
};

const NORMAL_STEP = 0.75;
const LANDFORM_STEP = 6;
/** Far-away sentinel used for path distances: the lab has no paths. */
const NO_PATH_DISTANCE = 1e6;

function hashLattice(x: number, z: number, seed: number): number {
  let value = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

function smoothstep(value: number, minimum: number, maximum: number): number {
  if (value <= minimum) return 0;
  if (value >= maximum) return 1;
  const amount = (value - minimum) / (maximum - minimum);
  return amount * amount * (3 - 2 * amount);
}

export class TerrainField {
  private readonly options: LabTerrainOptions;
  private readonly landformScratch: TerrainLandform = {
    convexity: 0,
    slope: 0,
    gradientX: 0,
    gradientZ: 0,
  };
  private readonly hydrologyScratch: HydrologySample = createHydrologySample();
  private readonly pathScratch = new THREE.Vector2();
  private readonly ecologyScratch: WorldEcologySample = createEcologySample();

  public constructor(options: Partial<LabTerrainOptions> = {}) {
    this.options = { ...DEFAULT_LAB_TERRAIN, ...options };
  }

  private valueNoise(x: number, z: number, seed: number): number {
    const cellX = Math.floor(x);
    const cellZ = Math.floor(z);
    const fx = smooth(x - cellX);
    const fz = smooth(z - cellZ);
    const a = hashLattice(cellX, cellZ, seed);
    const b = hashLattice(cellX + 1, cellZ, seed);
    const c = hashLattice(cellX, cellZ + 1, seed);
    const d = hashLattice(cellX + 1, cellZ + 1, seed);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }

  sampleHeight(x: number, z: number): number {
    const { rollingHeight, rollingScale, seed } = this.options;
    if (rollingHeight <= 0) {
      return 0;
    }
    const base = this.valueNoise(x / rollingScale, z / rollingScale, seed);
    const detail = this.valueNoise(
      x / (rollingScale * 0.31),
      z / (rollingScale * 0.31),
      seed ^ 0x51ab,
    );
    return (base - 0.5) * rollingHeight + (detail - 0.5) * rollingHeight * 0.22;
  }

  sampleNormal(x: number, z: number, target: THREE.Vector3): THREE.Vector3 {
    const step = NORMAL_STEP;
    const left = this.sampleHeight(x - step, z);
    const right = this.sampleHeight(x + step, z);
    const down = this.sampleHeight(x, z - step);
    const up = this.sampleHeight(x, z + step);
    return target.set(left - right, step * 2, down - up).normalize();
  }

  sampleHydrology(
    x: number,
    z: number,
    height: number,
    target: HydrologySample,
  ): HydrologySample {
    void x;
    void z;
    target.waterCoverage = 0;
    target.waterProximity = 0;
    target.humidityBoost = 0;
    target.grassMask = 1;
    target.waterLevel = 0;
    target.riverCoverage = 0;
    target.lakeCoverage = 0;
    target.flowX = 0;
    target.flowZ = 0;
    target.riverMorphology = 0;
    target.riverBend = 0;
    target.riverLateral = 0;
    target.lakeNormalizedDistance = 1;
    target.riverDischarge = 0;
    target.riverFallStep = 0;
    target.riverFallFace = 0;
    target.riverFallDrop = 0;
    const waterLevel = this.options.waterLevel;
    if (waterLevel !== null) {
      target.waterLevel = waterLevel;
      const depth = waterLevel - height;
      target.waterCoverage = clamp01(smoothstep(depth, -0.05, 0.25));
      target.lakeCoverage = target.waterCoverage;
      target.waterProximity = clamp01(smoothstep(depth, -2.4, 0.1));
      target.humidityBoost = target.waterProximity * 0.6;
      target.grassMask = 1 - target.waterCoverage;
    }
    return target;
  }

  sampleLandform(x: number, z: number, target: TerrainLandform): TerrainLandform {
    const step = LANDFORM_STEP;
    const center = this.sampleHeight(x, z);
    const east = this.sampleHeight(x + step, z);
    const west = this.sampleHeight(x - step, z);
    const north = this.sampleHeight(x, z + step);
    const south = this.sampleHeight(x, z - step);
    const mean = (east + west + north + south) / 4;
    target.convexity = (center - mean) / step;
    target.gradientX = (east - west) / (2 * step);
    target.gradientZ = (north - south) / (2 * step);
    const gradient = Math.hypot(target.gradientX, target.gradientZ);
    target.slope = 1 - 1 / Math.sqrt(1 + gradient * gradient);
    return target;
  }

  samplePathDistances(x: number, z: number, target: THREE.Vector2): THREE.Vector2 {
    void x;
    void z;
    return target.set(NO_PATH_DISTANCE, NO_PATH_DISTANCE);
  }

  samplePathVisibility(height: number): number {
    void height;
    return 1;
  }

  resolvePathGrassMask(
    distances: THREE.Vector2,
    height: number,
    radius = 0,
    x?: number,
    z?: number,
  ): number {
    void distances;
    void height;
    void radius;
    void x;
    void z;
    return 1;
  }

  resolveEcologyFromLandform(
    x: number,
    z: number,
    height: number,
    landform: TerrainLandform,
    hydrology: HydrologySample,
    pathDistances: THREE.Vector2,
    target: WorldEcologySample,
  ): WorldEcologySample {
    void pathDistances;
    const rockNoise = this.valueNoise(x / 34, z / 34, this.options.seed ^ 0x77cd);
    const slopeRock = smoothstep(landform.slope, 0.14, 0.4);
    const spurRock = clamp01(landform.convexity * 9);
    target.rockiness = clamp01(
      0.42 * slopeRock + 0.3 * spurRock + 0.42 * (rockNoise - 0.35),
    );
    target.moisture = clamp01(
      0.46 * (1 - 0.55 * landform.slope) +
        hydrology.humidityBoost -
        clamp01(landform.convexity * 6) * 0.18 -
        height * 0.004,
    );
    target.fertility = clamp01(0.62 - landform.slope * 0.8 - target.rockiness * 0.3);
    target.exposure = 0.55;
    target.disturbance = 0;
    target.shade = 0;
    return target;
  }

  sampleEcologyAt(x: number, z: number, height: number): WorldEcologySample {
    return this.resolveEcologyFromLandform(
      x,
      z,
      height,
      this.sampleLandform(x, z, this.landformScratch),
      this.sampleHydrology(x, z, height, this.hydrologyScratch),
      this.samplePathDistances(x, z, this.pathScratch),
      this.ecologyScratch,
    );
  }
}
