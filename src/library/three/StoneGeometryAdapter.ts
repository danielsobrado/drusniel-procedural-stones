import * as THREE from 'three';
import type { GeneratedStoneAsset } from '../generateStone';
import type { StoneMeshData } from '../../world/stones/StoneGeometry';

function finalizeGeometry(
  geometry: THREE.BufferGeometry,
  indices: Uint16Array
): THREE.BufferGeometry {
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Convert renderer-neutral raw stone mesh data into a Three.js BufferGeometry. */
export function createStoneGeometry(mesh: StoneMeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('stoneTone', new THREE.BufferAttribute(mesh.tones, 1));
  geometry.setAttribute('stoneWear', new THREE.BufferAttribute(mesh.wears, 1));
  geometry.setAttribute('stoneBounce', new THREE.BufferAttribute(mesh.bounces, 1));
  geometry.setAttribute('stoneMoss', new THREE.BufferAttribute(mesh.mosses, 1));
  geometry.setAttribute('stoneMineral', new THREE.BufferAttribute(mesh.minerals, 1));
  geometry.setAttribute('stoneWeathering', new THREE.BufferAttribute(mesh.weatherings, 1));
  geometry.setAttribute('stoneCavity', new THREE.BufferAttribute(mesh.cavities, 1));
  return finalizeGeometry(geometry, mesh.indices);
}

/** Map a generated asset onto the same geometry attributes consumed by the Lab material. */
export function createStoneAssetGeometry(asset: GeneratedStoneAsset): THREE.BufferGeometry {
  const { mesh, surface } = asset;
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
  return finalizeGeometry(geometry, mesh.indices);
}
