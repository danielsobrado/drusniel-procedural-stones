import * as THREE from 'three';
import type { StoneMeshData } from '../world/stones/StoneGeometry';
import {
  generateLabStoneMesh,
  resolveLabRecipe,
  type StoneBuildSettings
} from './StoneGeneration';
import { buildStoneSurfaceData } from './StoneSurface';

export {
  applyStagesToRecipe,
  findStage,
  generateLabStoneMesh,
  resolveLabRecipe,
  resolveStageMeshOptions
} from './StoneGeneration';
export type { StoneBuildSettings } from './StoneGeneration';

export interface BuiltStone {
  readonly geometry: THREE.BufferGeometry;
  readonly meshData: StoneMeshData;
}

/** Assemble the Lab's renderable BufferGeometry from generated mesh data. */
export function buildStoneGeometry(
  mesh: StoneMeshData,
  settings: StoneBuildSettings
): THREE.BufferGeometry {
  const surface = buildStoneSurfaceData(mesh, settings);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(surface.colors, 3));
  geometry.setAttribute('stoneWet', new THREE.BufferAttribute(surface.wetness, 1));
  geometry.setAttribute('stoneBedding', new THREE.BufferAttribute(surface.bedding, 1));
  geometry.setAttribute('stoneWeathering', new THREE.BufferAttribute(surface.weathering, 1));
  geometry.setAttribute('stoneMoss', new THREE.BufferAttribute(surface.moss, 1));
  geometry.setAttribute('stoneLichen', new THREE.BufferAttribute(surface.lichen, 1));
  geometry.setAttribute('stoneGrowthSeed', new THREE.BufferAttribute(surface.growthSeed, 1));
  geometry.setAttribute(
    'stoneGrowthPosition',
    new THREE.BufferAttribute(surface.growthPosition, 3)
  );
  geometry.setAttribute('stoneMossColor', new THREE.BufferAttribute(surface.mossColor, 3));
  geometry.setAttribute('stoneLichenColor', new THREE.BufferAttribute(surface.lichenColor, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return geometry;
}

export function buildStone(settings: StoneBuildSettings): BuiltStone {
  const recipe = resolveLabRecipe(settings);
  const meshData = generateLabStoneMesh(recipe, settings);
  return { geometry: buildStoneGeometry(meshData, settings), meshData };
}
