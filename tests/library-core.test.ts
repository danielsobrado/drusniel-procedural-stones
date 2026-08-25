import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STONE_QUALITY,
  STONE_ARCHETYPE_IDS,
  generateStone
} from '../src/library/index';
import { generateStoneMesh } from '../src/world/stones/StoneGeometry';
import { resolveQualityStoneRecipe } from '../src/world/stones/StoneShapeQuality';

function finite(array: ArrayLike<number>): boolean {
  for (let index = 0; index < array.length; index += 1) {
    if (!Number.isFinite(array[index])) {
      return false;
    }
  }
  return true;
}

describe('public core API', () => {
  it('preserves the existing deterministic generator fingerprint', () => {
    const generated = generateStone({ archetype: 'boulder', seed: 5, quality: true });
    const baseline = generateStoneMesh(resolveQualityStoneRecipe('boulder', 5), true);
    expect(generated.mesh.metrics.fingerprint).toBe(baseline.metrics.fingerprint);
    expect(
      generateStone({ archetype: 'boulder', seed: 5, quality: true }).mesh.metrics.fingerprint
    ).toBe(generated.mesh.metrics.fingerprint);
  });

  it('defaults to quality generation', () => {
    expect(DEFAULT_STONE_QUALITY).toBe(true);
    expect(generateStone({ archetype: 'boulder', seed: 5 }).mesh.metrics.fingerprint).toBe(
      generateStone({ archetype: 'boulder', seed: 5, quality: true }).mesh.metrics.fingerprint
    );
  });

  it.each(STONE_ARCHETYPE_IDS)('generates finite %s geometry', (archetype) => {
    const generated = generateStone({ archetype, seed: 48123, quality: false });
    expect(generated.mesh.metrics.vertexCount).toBeGreaterThan(0);
    expect(generated.mesh.indices.length).toBe(generated.mesh.metrics.triangleCount * 3);
    expect(finite(generated.mesh.positions)).toBe(true);
    expect(finite(generated.mesh.normals)).toBe(true);
  });

  it('runs without browser globals', () => {
    expect(globalThis.document).toBeUndefined();
    expect(generateStone({ archetype: 'pebble', seed: 12 }).mesh.positions).toBeInstanceOf(
      Float32Array
    );
  });
});
