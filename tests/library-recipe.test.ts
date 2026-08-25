import { describe, expect, it } from 'vitest';
import {
  UnsupportedStoneAssetRecipeVersionError,
  generateStoneFromAssetRecipe,
  normalizeStoneAssetRecipe
} from '../src/library/index';

describe('asset recipes', () => {
  it('round-trips through JSON without changing generated geometry or surface data', () => {
    const recipe = normalizeStoneAssetRecipe({
      version: 1,
      archetype: 'shard',
      seed: 274,
      quality: true,
      paletteKey: 'graniteGrey',
      valueScale: 0.92,
      stages: [
        { kind: 'cuts', enabled: true, params: { extraCuts: 2, depthScale: 1.25 } },
        { kind: 'wetness', enabled: true, params: { waterline: 0.4, strength: 0.8 } }
      ]
    });
    const restored = normalizeStoneAssetRecipe(JSON.parse(JSON.stringify(recipe)));
    const generated = generateStoneFromAssetRecipe(recipe);
    const restoredGenerated = generateStoneFromAssetRecipe(restored);
    expect(restored).toEqual(recipe);
    expect(restoredGenerated.mesh.metrics.fingerprint).toBe(generated.mesh.metrics.fingerprint);
    expect(Array.from(restoredGenerated.surface.colors)).toEqual(Array.from(generated.surface.colors));
    expect(Array.from(restoredGenerated.surface.wetness)).toEqual(
      Array.from(generated.surface.wetness)
    );
  });

  it('rejects unsupported explicit recipe versions', () => {
    expect(() => normalizeStoneAssetRecipe({ version: 99 })).toThrow(
      UnsupportedStoneAssetRecipeVersionError
    );
  });

  it('normalizes malformed V1 data to finite safe defaults', () => {
    const recipe = normalizeStoneAssetRecipe({
      version: 1,
      archetype: 'invalid',
      seed: Number.NaN,
      paletteKey: 'invalid',
      valueScale: Number.POSITIVE_INFINITY,
      stages: [
        { kind: 'shape', enabled: false, params: { heightScale: 999 } },
        { kind: 'cuts', enabled: 'yes', params: { extraCuts: 999 } }
      ]
    });
    expect(recipe.version).toBe(1);
    expect(recipe.archetype).toBe('boulder');
    expect(recipe.paletteKey).toBe('meadowSage');
    expect(recipe.stages.find((stage) => stage.kind === 'shape')?.enabled).toBe(true);
    expect(recipe.stages.find((stage) => stage.kind === 'shape')?.params.heightScale).toBe(2.2);
    expect(recipe.stages.find((stage) => stage.kind === 'cuts')?.params.extraCuts).toBe(4);
    expect(generateStoneFromAssetRecipe(recipe).mesh.metrics.vertexCount).toBeGreaterThan(0);
  });
});
