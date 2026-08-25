import * as THREE from 'three';
import type { ClusterSettings, ProjectState } from '../app/ProjectState';
import { createLabWorldConfig, type WorldConfig } from '../world/WorldConfig';
import {
  resolveStoneFormationGap,
  resolveStoneFormationOffset,
  resolveStoneFragmentRecipe,
  stoneFormationSplits,
  type StoneFragmentId
} from '../world/stones/StoneFormation';
import { StoneClusterComposition } from '../world/stones/StoneClusterComposition';
import type { StoneClusterDescriptor } from '../world/stones/StoneClusterField';
import { clusterLocalToWorld } from '../world/stones/StoneClusterTuning';
import { hashStoneCell } from '../world/stones/StoneRandom';
import {
  buildStone,
  buildStoneGeometry,
  generateLabStoneMesh,
  resolveLabRecipe,
  type StoneBuildSettings
} from './StonePipeline';
import { createStoneMaterial, stoneShaderConfig } from './StoneMaterial';

export function settingsFromProject(state: ProjectState): StoneBuildSettings {
  return {
    archetype: state.archetype,
    seed: state.seed,
    quality: state.quality,
    stages: state.stages,
    paletteKey: state.paletteKey,
    valueScale: state.valueScale
  };
}

export function fieldWorldConfig(state: ProjectState): WorldConfig {
  const grain = stoneShaderConfig(state.stages);
  return createLabWorldConfig({
    seed: Math.trunc(state.field.seed),
    stoneDensity: state.field.density,
    stoneClusterChance: state.field.clusterChance,
    stoneClusterSpacing: state.field.clusterSpacing,
    stoneSingletonChance: state.field.singletonChance,
    stoneFormationChance: state.field.formationChance,
    stoneRadiusDesktop: Math.round(state.field.radiusChunks),
    stoneRadiusCompact: Math.max(2, Math.round(state.field.radiusChunks) - 1),
    stoneDetailRadius: Math.round(state.field.detailRadiusChunks),
    stoneDetailRadiusCompact: Math.max(1, Math.round(state.field.detailRadiusChunks) - 1),
    stoneChunksPerFrame: 2,
    stoneGrainStrength: grain.stoneGrainStrength,
    stoneGrainNormalStrength: grain.stoneGrainNormalStrength,
    stoneGrainSize: grain.stoneGrainSize,
    stoneGrowthDetailStrength: grain.stoneGrowthDetailStrength,
    stoneGrainFadeDistance: 48,
    stoneGrowthDetailFadeDistance: 64
  });
}

export interface PreviewBounds {
  radius: number;
  height: number;
}

export interface StonePreviewResult {
  meshes: THREE.Mesh[];
  bounds: PreviewBounds;
}

function sinkY(height: number, embed: number, scale: number): number {
  return -embed * height * scale * 0.5;
}

function placeMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  z: number,
  yaw: number,
  scale: number,
  height: number,
  embed: number
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(scale);
  mesh.rotation.y = yaw;
  mesh.position.set(x, sinkY(height, embed, scale), z);
  return mesh;
}

function formationMeshes(
  settings: StoneBuildSettings,
  parentRecipe: ReturnType<typeof resolveLabRecipe>,
  material: THREE.Material,
  originX: number,
  originZ: number,
  yaw: number,
  scale: number,
  gapRoll: number,
  config: WorldConfig
): { meshes: THREE.Mesh[]; height: number; radius: number } {
  const fragments: readonly StoneFragmentId[] = ['a', 'b'];
  const bodies = fragments.map((fragment) =>
    generateLabStoneMesh(resolveStoneFragmentRecipe(parentRecipe, fragment), settings)
  );
  const major = bodies[0];
  const minor = bodies[1];
  const gap = resolveStoneFormationGap(
    major.metrics,
    minor.metrics,
    scale,
    gapRoll,
    config.stoneFormationGapRatioMin,
    config.stoneFormationGapRatioMax,
    config.stoneFormationGapMax
  );
  const parted = resolveStoneFormationOffset(major.metrics, minor.metrics, scale, gap);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const meshes = bodies.map((meshData, piece) => {
    const offsetX = piece === 1 && parted !== undefined ? parted.x : 0;
    const offsetZ = piece === 1 && parted !== undefined ? parted.z : 0;
    return placeMesh(
      buildStoneGeometry(meshData, settings),
      material,
      originX + offsetX * cos + offsetZ * sin,
      originZ - offsetX * sin + offsetZ * cos,
      yaw,
      scale,
      meshData.metrics.height,
      meshData.metrics.embed
    );
  });
  const height = Math.max(...bodies.map((body) => body.metrics.height)) * scale;
  const radius =
    Math.max(...bodies.map((body) => body.metrics.footprintRadius)) * scale +
    (parted !== undefined ? Math.hypot(parted.x, parted.z) : 0);
  return { meshes, height, radius };
}

/** One stone, optionally shown as its mated formation pair. */
export function buildSinglePreview(
  state: ProjectState,
  material: THREE.MeshLambertMaterial
): StonePreviewResult {
  const settings = settingsFromProject(state);
  const parent = resolveLabRecipe(settings);
  const scale = state.scale;
  const config = createLabWorldConfig();

  if (state.formationPair && stoneFormationSplits(parent)) {
    const formed = formationMeshes(settings, parent, material, 0, 0, 0, scale, 0.35, config);
    return {
      meshes: formed.meshes,
      bounds: { radius: Math.max(formed.radius, 0.8), height: formed.height }
    };
  }

  const built = buildStone(settings);
  return {
    meshes: [
      placeMesh(
        built.geometry,
        material,
        0,
        0,
        0,
        scale,
        built.meshData.metrics.height,
        built.meshData.metrics.embed
      )
    ],
    bounds: {
      radius: Math.max(built.meshData.metrics.footprintRadius * scale, 0.6),
      height: built.meshData.metrics.height * scale
    }
  };
}

function labClusterDescriptor(
  cluster: ClusterSettings,
  paletteKey: ProjectState['paletteKey']
): StoneClusterDescriptor {
  const radius = cluster.radius;
  const minor = radius * cluster.aspect;
  return {
    gridX: 0,
    gridZ: 0,
    seed: Math.trunc(cluster.seed),
    centerX: 0,
    centerZ: 0,
    height: 0,
    geologyPotential: 0.72,
    moisture: 0.42,
    fertility: 0.4,
    exposure: 0.52,
    disturbance: 0,
    surfaceRockiness: 0.58,
    landformSlope: 0.1,
    landformConvexity: 0.08,
    landformGradientX: 0,
    landformGradientZ: 0.04,
    suitability: 0.46,
    rawActive: true,
    priority: 1,
    process: 'compact',
    strike: 0.35,
    direction: 0.55,
    majorRadius: radius,
    minorRadius: minor,
    influenceRadius: radius * 1.12,
    budget: Math.round(cluster.budget),
    biomeIndex: 0,
    paletteKey,
    valueBase: 1,
    mossBase: 0.4,
    mossBias: 0,
    active: true
  };
}

export function buildClusterPreview(
  state: ProjectState,
  material: THREE.MeshLambertMaterial
): StonePreviewResult {
  const descriptor = labClusterDescriptor(state.cluster, state.paletteKey);
  const config = createLabWorldConfig({
    stoneFormationChance: state.cluster.formationChance,
    stoneClusterBudgetMin: descriptor.budget,
    stoneClusterBudgetMax: descriptor.budget
  });
  const members = new StoneClusterComposition(config).compose(descriptor);
  const meshes: THREE.Mesh[] = [];
  let maxRadius = descriptor.majorRadius;
  let maxHeight = 1;

  for (const spec of members) {
    const seed = hashStoneCell(descriptor.seed, spec.index, spec.variantIndex) >>> 0;
    const settings: StoneBuildSettings = {
      archetype: spec.archetype,
      seed,
      quality: state.quality,
      stages: state.stages,
      paletteKey: descriptor.paletteKey,
      valueScale: state.valueScale * spec.valueScale
    };
    const parent = resolveLabRecipe(settings);
    const world = clusterLocalToWorld(
      0,
      0,
      descriptor.direction,
      descriptor.majorRadius,
      descriptor.minorRadius,
      spec.localU,
      spec.localV
    );
    const scale = spec.scale;

    if (spec.splitEligible && stoneFormationSplits(parent)) {
      const formed = formationMeshes(
        settings,
        parent,
        material,
        world.x,
        world.z,
        spec.rotationY,
        scale,
        0.4,
        config
      );
      meshes.push(...formed.meshes);
      maxHeight = Math.max(maxHeight, formed.height);
      maxRadius = Math.max(maxRadius, Math.hypot(world.x, world.z) + formed.radius);
    } else {
      const built = buildStone(settings);
      meshes.push(
        placeMesh(
          built.geometry,
          material,
          world.x,
          world.z,
          spec.rotationY,
          scale,
          built.meshData.metrics.height,
          built.meshData.metrics.embed
        )
      );
      maxHeight = Math.max(maxHeight, built.meshData.metrics.height * scale);
      maxRadius = Math.max(
        maxRadius,
        Math.hypot(world.x, world.z) + built.meshData.metrics.footprintRadius * scale
      );
    }
  }

  return { meshes, bounds: { radius: maxRadius, height: maxHeight } };
}

export { createStoneMaterial };
