# Procedural Stone Lab

Realtime authoring lab for the convex-clipping stone pipeline.

## Run

```bash
npm install
npm run dev
```

Then open the printed localhost URL. `npm run build` typechecks and produces `dist/`. `npm test` runs deterministic generation checks.

## Install the library

The Lab and the reusable engine live in one repository, but publish as a deliberately small package API:

```bash
npm install @drusniel/procedural-stone
```

Generate renderer-neutral typed arrays without browser globals or Three.js. Quality generation is enabled by default and can be disabled explicitly for cheaper generation:

```ts
import { generateStone } from '@drusniel/procedural-stone';

const stone = generateStone({
  archetype: 'boulder',
  seed: 913
});

console.log(stone.mesh.metrics.fingerprint);
```

Recipes exported by the Lab are versioned and normalized defensively before generation. Explicit unknown recipe versions are rejected instead of being silently interpreted as V1:

```ts
import {
  generateStoneFromAssetRecipe,
  normalizeStoneAssetRecipe
} from '@drusniel/procedural-stone';

const recipe = normalizeStoneAssetRecipe(JSON.parse(savedRecipeJson));
const stone = generateStoneFromAssetRecipe(recipe);
console.log(stone.surface.colors);
```

Three.js support is isolated behind an optional adapter. Raw generation maps the renderer-neutral geometry channels directly:

```ts
import * as THREE from 'three';
import { generateStone } from '@drusniel/procedural-stone';
import { createStoneGeometry } from '@drusniel/procedural-stone/three';

const stone = generateStone({ archetype: 'shard', seed: 274 });
const mesh = new THREE.Mesh(createStoneGeometry(stone.mesh), material);
scene.add(mesh);
```

For a Lab asset recipe, `createStoneAssetGeometry` maps the palette, value scale, wetness, weathering, moss, lichen, bedding, and growth attributes onto the same geometry attribute layout used by the Lab:

```ts
import * as THREE from 'three';
import { generateStoneFromAssetRecipe } from '@drusniel/procedural-stone';
import { createStoneAssetGeometry } from '@drusniel/procedural-stone/three';

const stone = generateStoneFromAssetRecipe(savedRecipe);
const geometry = createStoneAssetGeometry(stone);
const material = new THREE.MeshLambertMaterial({ vertexColors: true });
scene.add(new THREE.Mesh(geometry, material));
```

The package does not yet expose the Lab's GLSL growth material. Moss, lichen, wetness sheen, and grain-specific shading need the future WebGPU/TSL material for visual parity, but the renderer-neutral asset output already contains the same surface attributes the Lab consumes.

Preset recipes are available from the root API or the `@drusniel/procedural-stone/presets` subpath.

For the same package version, archetype, seed, quality setting, and recipe stages, generation is deterministic. `StoneMeshMetrics.fingerprint` is intended for geometry regression checks. Serialized asset recipes start at version `1`; future incompatible recipe changes must use an explicit migration or a new supported version.

Use `npm run build:app` for the Lab, `npm run build:lib` for `package-dist/`, and `npm run pack:check` to run the full verification plus an actual installed-tarball JavaScript and TypeScript consumer check before publishing. `npm run release:npm` publishes the prerelease under the `next` tag.

## What you can do

- **Stone** mode: one body with a fixed-order pipeline (Shape → Cuts → Chips → Indent → Relief → Weathering → Moss → Wetness → Grain). Toggle stages in the bottom dock; inspect parameters on the right.
- **Cluster** mode: an anchor / secondary / debris family composed with the world cluster grammar.
- **Field** mode: streamed chunk batches over rolling ground, with the same LOD split the world uses.

Library presets cover meadow boulders, river moss, granite shards, desert slabs, and quarry blocks. Open / Save writes `procedural-stone-lab.json`. Export GLB keeps vertex colours; the GLSL moss/grain shading is a Lambert approximation in the file. PNG snapshots the viewport.

Autosave lives in `localStorage` under `procedural-stone-lab.project.v1`. Undo / redo coalesces slider drags. `R` rerolls the seed; `W` toggles wireframe.

## Architecture

- UI and state: `src/ui/*`, `src/app/AppState.ts` (pub/sub, history, autosave)
- Public npm boundary: `src/library/*` (core, recipes, presets, Three adapter)
- Lab mapping: `src/stones/StoneStages.ts`, `StoneGeneration.ts`, `StoneSurface.ts`, `StonePipeline.ts`, `StonePreview.ts`
- Generation / shading: `src/world/stones/*` (ported from FluffyGrass)
- Controls: `config/lab.yaml`

License: MIT. See `LICENSE`.
