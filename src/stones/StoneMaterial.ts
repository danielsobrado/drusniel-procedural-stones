import * as THREE from 'three';
import { createLabWorldConfig, type WorldConfig } from '../world/WorldConfig';
import { applyStoneSurfaceShader } from '../world/stones/StoneGrowthShader';
import { stageParam, type StoneStage } from './StoneStages';
import { findStage } from './StonePipeline';

/** Grain/growth uniforms are baked at compile time, so this keys rebuilds. */
export function stoneMaterialSignature(stages: readonly StoneStage[]): string {
  const grain = findStage(stages, 'grain');
  const enabled = grain?.enabled ?? false;
  return [
    enabled ? 1 : 0,
    enabled ? stageParam(grain, 'strength', 'grain') : 0,
    enabled ? stageParam(grain, 'normalStrength', 'grain') : 0,
    enabled ? stageParam(grain, 'size', 'grain') : 0,
    enabled ? stageParam(grain, 'growthDetail', 'grain') : 0
  ].join(':');
}

export function stoneShaderConfig(stages: readonly StoneStage[]): WorldConfig {
  const grain = findStage(stages, 'grain');
  const enabled = grain?.enabled ?? false;
  return createLabWorldConfig({
    stoneGrainStrength: enabled ? stageParam(grain, 'strength', 'grain') : 0,
    stoneGrainNormalStrength: enabled
      ? stageParam(grain, 'normalStrength', 'grain')
      : 0,
    stoneGrainSize: enabled ? stageParam(grain, 'size', 'grain') : 1.6,
    stoneGrowthDetailStrength: enabled
      ? stageParam(grain, 'growthDetail', 'grain')
      : 0,
    // Preview distances: keep detail alive across the whole lab viewport.
    stoneGrainFadeDistance: 60,
    stoneGrowthDetailFadeDistance: 80
  });
}

let sharedGrainTexture: THREE.Texture | null = null;

export function labGrainTexture(): THREE.Texture {
  if (sharedGrainTexture === null) {
    const texture = new THREE.TextureLoader().load('./perlinnoise.webp');
    texture.name = 'stone-lab-grain';
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    sharedGrainTexture = texture;
  }
  return sharedGrainTexture;
}

export function createStoneMaterial(
  stages: readonly StoneStage[]
): THREE.MeshLambertMaterial {
  const config = stoneShaderConfig(stages);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.name = 'stone-lab-detail-material';
  material.dithering = true;
  const needsGrain =
    config.stoneGrainStrength > 0 || config.stoneGrainNormalStrength > 0;
  applyStoneSurfaceShader(material, config, needsGrain ? labGrainTexture() : undefined);
  return material;
}
