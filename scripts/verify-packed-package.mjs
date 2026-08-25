import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const npmCommand = process.platform === 'win32'
  ? (process.env.ComSpec ?? 'cmd.exe')
  : 'npm';
const npmCommandPrefix = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm.cmd']
  : [];
const temporaryRoot = await mkdtemp(join(tmpdir(), 'procedural-stone-package-'));

async function run(command, args, cwd) {
  try {
    return await execFileAsync(command, args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    });
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    const details = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(`Command failed: ${command} ${args.join(' ')}${details ? `\n${details}` : ''}`);
  }
}

function runNpm(args, cwd) {
  return run(npmCommand, [...npmCommandPrefix, ...args], cwd);
}

try {
  const packDirectory = join(temporaryRoot, 'pack');
  const consumerDirectory = join(temporaryRoot, 'consumer');
  await mkdir(packDirectory, { recursive: true });
  await mkdir(consumerDirectory, { recursive: true });

  const packed = await runNpm(
    ['pack', '--json', '--pack-destination', packDirectory],
    repositoryRoot
  );
  const packResult = JSON.parse(packed.stdout);
  const filename = packResult?.[0]?.filename;
  if (typeof filename !== 'string') {
    throw new Error('npm pack did not return a package filename.');
  }

  const tarball = join(packDirectory, filename);
  await writeFile(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
    'utf8'
  );
  await runNpm(
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', tarball],
    consumerDirectory
  );

  const consumerNodeModules = join(consumerDirectory, 'node_modules');
  const consumerThree = join(consumerNodeModules, 'three');
  await rm(consumerThree, { recursive: true, force: true });
  await cp(resolve(repositoryRoot, 'node_modules/three'), consumerThree, {
    recursive: true
  });

  const sourceTypes = resolve(repositoryRoot, 'node_modules/@types');
  const consumerTypes = join(consumerNodeModules, '@types');
  try {
    await readFile(resolve(sourceTypes, 'three/package.json'), 'utf8');
    await rm(consumerTypes, { recursive: true, force: true });
    await cp(sourceTypes, consumerTypes, {
      recursive: true
    });
  } catch {
    throw new Error('Local @types dependencies are required for the packed TypeScript consumer check.');
  }

  const smokeSource = `
import {
  createDefaultStoneAssetRecipe,
  generateStone,
  generateStoneFromAssetRecipe
} from '@drusniel/procedural-stone';
import {
  createStoneAssetGeometry,
  createStoneGeometry
} from '@drusniel/procedural-stone/three';

const generated = generateStone({ archetype: 'boulder', seed: 5 });
if (generated.mesh.metrics.vertexCount <= 0) throw new Error('Core package generation failed.');
const asset = generateStoneFromAssetRecipe(createDefaultStoneAssetRecipe());
if (asset.surface.colors.length !== asset.mesh.metrics.vertexCount * 3) {
  throw new Error('Asset surface data is incomplete.');
}
const coreGeometry = createStoneGeometry(generated.mesh);
const assetGeometry = createStoneAssetGeometry(asset);
if (!assetGeometry.getAttribute('color')) throw new Error('Three asset geometry is missing color.');
coreGeometry.dispose();
assetGeometry.dispose();
`;
  await writeFile(join(consumerDirectory, 'smoke.mjs'), smokeSource.trimStart(), 'utf8');
  await run(process.execPath, [join(consumerDirectory, 'smoke.mjs')], consumerDirectory);

  const typeSource = `
import {
  createDefaultStoneAssetRecipe,
  generateStone,
  generateStoneFromAssetRecipe,
  type StoneSurfaceData
} from '@drusniel/procedural-stone';
import {
  createStoneAssetGeometry,
  createStoneGeometry
} from '@drusniel/procedural-stone/three';

const generated = generateStone({ archetype: 'shard', seed: 274 });
createStoneGeometry(generated.mesh);
const asset = generateStoneFromAssetRecipe(createDefaultStoneAssetRecipe());
const surface: StoneSurfaceData = asset.surface;
createStoneAssetGeometry(asset);
void surface;
`;
  await writeFile(join(consumerDirectory, 'consumer.ts'), typeSource.trimStart(), 'utf8');
  await writeFile(
    join(consumerDirectory, 'tsconfig.json'),
    `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: false
      },
      include: ['consumer.ts']
    }, null, 2)}\n`,
    'utf8'
  );
  await run(
    process.execPath,
    [resolve(repositoryRoot, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
    consumerDirectory
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
