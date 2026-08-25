/**
 * Lab subset of FluffyGrass's WorldConfig: only the keys the ported stone
 * systems read. Defaults mirror the shipped world.yaml tuning.
 */
export interface WorldConfig {
  seed: number;
  worldSize: number;
  chunkSize: number;
  grassMinAltitude: number;
  grassMaxAltitude: number;
  pathWidth: number;
  pathBranchWidth: number;
  pathEdgeRoughness: number;
  pathGrassClearance: number;
  /** 0 is the rollback flag for every stone system. */
  stonesEnabled: number;
  stoneCellSize: number;
  /** Global macro-formation frequency; lowering it removes whole formations. */
  stoneDensity: number;
  stoneVariantsPerArchetype: number;
  /** Final macro-cluster activation multiplier. */
  stoneClusterChance: number;
  stoneClusterSpacing: number;
  stoneClusterCenterJitter: number;
  stoneClusterRadiusMin: number;
  stoneClusterRadiusMax: number;
  stoneClusterAspectMin: number;
  stoneClusterAspectMax: number;
  stoneClusterBudgetMin: number;
  stoneClusterBudgetMax: number;
  stoneClusterCoreRatio: number;
  stoneClusterShoulderRatio: number;
  stoneClusterHaloRatio: number;
  stoneClusterDensityResponse: number;
  /** Share of eligible anchors that become true detached two-piece formations. */
  stoneFormationChance: number;
  stoneFormationGapRatioMin: number;
  stoneFormationGapRatioMax: number;
  stoneFormationGapMax: number;
  stoneFormationSupportHeightRatio: number;
  stoneFormationSupportHeightMax: number;
  stoneSingletonChance: number;
  stoneGrassClearanceFeather: number;
  stoneRadiusDesktop: number;
  stoneRadiusCompact: number;
  stoneDetailRadius: number;
  stoneDetailRadiusCompact: number;
  /** Terrain chunks grouped per stone render batch axis. */
  stoneRenderBatchChunksPerAxis: number;
  /** Maximum completed stone render batches per frame. */
  stoneChunksPerFrame: number;
  stoneVergeChance: number;
  stoneGrainStrength: number;
  stoneGrainNormalStrength: number;
  stoneGrainSize: number;
  stoneGrainFadeDistance: number;
  stoneGrowthDetailStrength: number;
  stoneGrowthDetailSize: number;
  stoneGrowthDetailFadeDistance: number;
  stoneMossExposureStrength: number;
  stoneMossExposureAzimuthDegrees: number;
  stoneMossExposureElevationDegrees: number;
  stoneMossStreakStrength: number;
}

/** Shipped FluffyGrass tuning, the lab's baseline. */
export function createLabWorldConfig(overrides: Partial<WorldConfig> = {}): WorldConfig {
  return {
    seed: 42017,
    worldSize: 2048,
    chunkSize: 64,
    grassMinAltitude: -20,
    grassMaxAltitude: 118,
    pathWidth: 3,
    pathBranchWidth: 1.7,
    pathEdgeRoughness: 0.5,
    pathGrassClearance: 0.15,
    stonesEnabled: 1,
    stoneCellSize: 16,
    stoneDensity: 0.3,
    stoneVariantsPerArchetype: 10,
    stoneClusterChance: 0.82,
    stoneClusterSpacing: 56,
    stoneClusterCenterJitter: 0.26,
    stoneClusterRadiusMin: 10,
    stoneClusterRadiusMax: 22,
    stoneClusterAspectMin: 0.58,
    stoneClusterAspectMax: 0.92,
    stoneClusterBudgetMin: 4,
    stoneClusterBudgetMax: 8,
    stoneClusterCoreRatio: 0.42,
    stoneClusterShoulderRatio: 0.78,
    stoneClusterHaloRatio: 1.12,
    stoneClusterDensityResponse: 6,
    stoneFormationChance: 0.12,
    stoneFormationGapRatioMin: 0.006,
    stoneFormationGapRatioMax: 0.025,
    stoneFormationGapMax: 0.03,
    stoneFormationSupportHeightRatio: 0.08,
    stoneFormationSupportHeightMax: 0.05,
    stoneSingletonChance: 0.17,
    stoneGrassClearanceFeather: 0.24,
    stoneRadiusDesktop: 6,
    stoneRadiusCompact: 3,
    stoneDetailRadius: 2,
    stoneDetailRadiusCompact: 1,
    stoneRenderBatchChunksPerAxis: 2,
    stoneChunksPerFrame: 1,
    stoneVergeChance: 0.62,
    stoneGrainStrength: 0,
    stoneGrainNormalStrength: 0.05,
    stoneGrainSize: 1.6,
    stoneGrainFadeDistance: 18,
    stoneGrowthDetailStrength: 0.56,
    stoneGrowthDetailSize: 0.32,
    stoneGrowthDetailFadeDistance: 24,
    stoneMossExposureStrength: 0.44,
    stoneMossExposureAzimuthDegrees: 32,
    stoneMossExposureElevationDegrees: 49,
    stoneMossStreakStrength: 0.22,
    ...overrides,
  };
}
