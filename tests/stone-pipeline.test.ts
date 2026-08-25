import { describe, expect, it } from 'vitest';
import { resolveStoneRecipe } from '../src/world/stones/StoneRecipe';
import { generateStoneMesh } from '../src/world/stones/StoneGeometry';
import { resolveQualityStoneRecipe } from '../src/world/stones/StoneShapeQuality';
import { applyStagesToRecipe, resolveLabRecipe } from '../src/stones/StonePipeline';
import { createDefaultStages } from '../src/stones/StoneStages';
import { normalizeProject } from '../src/app/ProjectState';

function finite(array: ArrayLike<number>): boolean {
  for (let index = 0; index < array.length; index += 1) {
    if (!Number.isFinite(array[index])) {
      return false;
    }
  }
  return true;
}

describe('stone generation', () => {
  it('resolves the same recipe for the same seed', () => {
    const a = resolveStoneRecipe('boulder', 5);
    const b = resolveStoneRecipe('boulder', 5);
    expect(a.sideRadii.length).toBe(b.sideRadii.length);
    expect(a.height).toBe(b.height);
    expect(a.cuts.length).toBe(b.cuts.length);
    expect(a.profileRings.length).toBe(b.profileRings.length);
  });

  it('builds a closed mesh with finite positions and normals', () => {
    const recipe = resolveQualityStoneRecipe('boulder', 5);
    const mesh = generateStoneMesh(recipe, true);
    expect(mesh.metrics.triangleCount).toBeGreaterThan(8);
    expect(mesh.indices.length).toBe(mesh.metrics.triangleCount * 3);
    expect(finite(mesh.positions)).toBe(true);
    expect(finite(mesh.normals)).toBe(true);
  });

  it('disables cuts when the cuts stage is off', () => {
    const stages = createDefaultStages();
    const cuts = stages.find((stage) => stage.kind === 'cuts');
    if (cuts === undefined) {
      throw new Error('cuts stage missing');
    }
    cuts.enabled = false;
    const recipe = applyStagesToRecipe(resolveStoneRecipe('block', 733), stages);
    expect(recipe.cuts).toEqual([]);
  });

  it('maps lab stages onto a quality recipe', () => {
    const stages = createDefaultStages();
    const recipe = resolveLabRecipe({
      archetype: 'shard',
      seed: 274,
      quality: true,
      stages,
      paletteKey: 'graniteGrey',
      valueScale: 1
    });
    expect(recipe.archetype).toBe('shard');
    expect(recipe.height).toBeGreaterThan(0);
  });
});

describe('project files', () => {
  it('falls back to defaults for garbage JSON', () => {
    const project = normalizeProject({ version: 9, mode: 'nope', seed: 'x' });
    expect(project.version).toBe(1);
    expect(project.mode).toBe('single');
    expect(project.archetype).toBe('boulder');
  });

  it('keeps a known archetype and stage override', () => {
    const project = normalizeProject({
      archetype: 'pebble',
      seed: 12,
      stages: [{ kind: 'cuts', enabled: false, params: { extraCuts: 0, depthScale: 1 } }]
    });
    expect(project.archetype).toBe('pebble');
    expect(project.seed).toBe(12);
    expect(project.stages.find((stage) => stage.kind === 'cuts')?.enabled).toBe(false);
  });

  it('clamps imported values and preserves project invariants', () => {
    const project = normalizeProject({
      seed: 12.9,
      scale: 999,
      valueScale: -999,
      selectedStageKind: null,
      stages: [{ kind: 'shape', enabled: false, params: { heightScale: 999 } }],
      cluster: { budget: 999 },
      field: { radiusChunks: 999 }
    });
    expect(project.seed).toBe(12);
    expect(project.scale).toBe(4);
    expect(project.valueScale).toBe(0.7);
    expect(project.selectedStageKind).toBeNull();
    expect(project.stages.find((stage) => stage.kind === 'shape')).toMatchObject({
      enabled: true,
      params: { heightScale: 2.2 }
    });
    expect(project.cluster.budget).toBe(14);
    expect(project.field.radiusChunks).toBe(8);
  });

  it('loads the keyed stage format written by preset files', () => {
    const project = normalizeProject({
      format: 'psl-preset',
      version: 1,
      archetype: 'shard',
      stages: {
        cuts: { enabled: false, params: { depthScale: 1.4 } },
        wetness: { enabled: true, params: { strength: 0.75 } }
      }
    });
    expect(project.archetype).toBe('shard');
    expect(project.stages.find((stage) => stage.kind === 'cuts')).toMatchObject({
      enabled: false,
      params: { depthScale: 1.4 }
    });
    expect(project.stages.find((stage) => stage.kind === 'wetness')).toMatchObject({
      enabled: true,
      params: { strength: 0.75 }
    });
  });
});
