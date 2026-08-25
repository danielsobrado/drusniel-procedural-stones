import { describe, expect, it } from 'vitest';
import {
  createStoneRecipeFromPreset,
  generateStoneFromAssetRecipe,
  listStonePresets
} from '../src/library/index';

describe('public presets', () => {
  it('generates every shipped preset', () => {
    const presets = listStonePresets();
    expect(presets.length).toBeGreaterThan(0);
    for (const preset of presets) {
      const generated = generateStoneFromAssetRecipe(createStoneRecipeFromPreset(preset.id));
      expect(generated.mesh.metrics.vertexCount).toBeGreaterThan(0);
      expect(Number.isFinite(generated.mesh.metrics.fingerprint)).toBe(true);
    }
  });

  it('returns copies instead of exposing mutable internal preset data', () => {
    const first = listStonePresets();
    const originalTagCount = first[0].tags.length;
    (first[0].tags as string[]).push('consumer-mutation');
    expect(listStonePresets()[0].tags).toHaveLength(originalTagCount);
  });

  it('supports deterministic recipe overrides', () => {
    const recipe = createStoneRecipeFromPreset('mossy-river-boulder', { seed: 99 });
    expect(recipe.seed).toBe(99);
    expect(generateStoneFromAssetRecipe(recipe).assetRecipe).toEqual(recipe);
  });
});
