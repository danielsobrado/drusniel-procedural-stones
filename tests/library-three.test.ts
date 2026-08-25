import { describe, expect, it } from 'vitest';
import {
  createDefaultStoneAssetRecipe,
  generateStone,
  generateStoneFromAssetRecipe
} from '../src/library/index';
import {
  createStoneAssetGeometry,
  createStoneGeometry
} from '../src/library/three';

describe('Three.js adapter', () => {
  it('maps renderer-neutral raw arrays onto BufferGeometry attributes', () => {
    const { mesh } = generateStone({ archetype: 'block', seed: 733, quality: true });
    const geometry = createStoneGeometry(mesh);

    expect(geometry.getAttribute('position').count).toBe(mesh.metrics.vertexCount);
    expect(geometry.getAttribute('normal').count).toBe(mesh.metrics.vertexCount);
    for (const name of [
      'stoneTone',
      'stoneWear',
      'stoneBounce',
      'stoneMoss',
      'stoneMineral',
      'stoneWeathering',
      'stoneCavity'
    ]) {
      expect(geometry.getAttribute(name).count).toBe(mesh.metrics.vertexCount);
    }
    expect(geometry.getIndex()?.count).toBe(mesh.indices.length);
    expect(geometry.boundingBox).not.toBeNull();
    expect(geometry.boundingSphere).not.toBeNull();
    geometry.dispose();
  });

  it('maps asset surface data onto the Lab-compatible attribute layout', () => {
    const recipe = createDefaultStoneAssetRecipe();
    const asset = generateStoneFromAssetRecipe({
      ...recipe,
      paletteKey: 'graniteGrey',
      valueScale: 0.9
    });
    const alternate = generateStoneFromAssetRecipe({
      ...recipe,
      paletteKey: 'mossy',
      valueScale: 1.1
    });
    expect(Array.from(asset.surface.colors.slice(0, 3))).not.toEqual(
      Array.from(alternate.surface.colors.slice(0, 3))
    );

    const geometry = createStoneAssetGeometry(asset);
    for (const name of [
      'color',
      'stoneWet',
      'stoneBedding',
      'stoneWeathering',
      'stoneMoss',
      'stoneLichen',
      'stoneGrowthSeed',
      'stoneGrowthPosition',
      'stoneMossColor',
      'stoneLichenColor'
    ]) {
      expect(geometry.getAttribute(name).count).toBe(asset.mesh.metrics.vertexCount);
    }
    expect(geometry.getIndex()?.count).toBe(asset.mesh.indices.length);
    geometry.dispose();
  });
});
