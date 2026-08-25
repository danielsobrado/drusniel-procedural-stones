import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const declarationsRoot = resolve(repositoryRoot, 'package-dist/types');
const entrypoints = [
  resolve(declarationsRoot, 'library/index.d.ts'),
  resolve(declarationsRoot, 'library/presets.d.ts'),
  resolve(declarationsRoot, 'library/three/index.d.ts')
];
const specifierPattern = /(?:from\s+|import\s*\()(['"])([^'"]+)\1/g;

async function listDeclarations(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...await listDeclarations(path));
    } else if (entry.name.endsWith('.d.ts')) {
      result.push(path);
    }
  }
  return result;
}

async function resolveDeclaration(fromFile, specifier, declarations) {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  const target = resolve(dirname(fromFile), specifier);
  const candidates = extname(target) === '.ts'
    ? [target]
    : [`${target}.d.ts`, resolve(target, 'index.d.ts')];
  return candidates.find((candidate) => declarations.has(candidate));
}

function runtimeDeclarationSpecifier(specifier) {
  if (!specifier.startsWith('.') || extname(specifier) !== '') {
    return specifier;
  }
  return `${specifier}.js`;
}

const allDeclarations = await listDeclarations(declarationsRoot);
const allDeclarationSet = new Set(allDeclarations);
const retained = new Set();
const pending = [...entrypoints];

while (pending.length > 0) {
  const declaration = pending.pop();
  if (declaration === undefined || retained.has(declaration)) {
    continue;
  }
  if (!allDeclarationSet.has(declaration)) {
    throw new Error(`Missing declaration entrypoint: ${declaration}`);
  }
  retained.add(declaration);
  const source = await readFile(declaration, 'utf8');
  for (const match of source.matchAll(specifierPattern)) {
    const dependency = await resolveDeclaration(declaration, match[2], allDeclarationSet);
    if (dependency !== undefined && !retained.has(dependency)) {
      pending.push(dependency);
    }
  }
}

for (const declaration of allDeclarations) {
  if (!retained.has(declaration)) {
    await rm(declaration);
    continue;
  }
  const source = await readFile(declaration, 'utf8');
  const rewritten = source.replace(
    specifierPattern,
    (match, quote, specifier) => {
      const runtimeSpecifier = runtimeDeclarationSpecifier(specifier);
      return runtimeSpecifier === specifier
        ? match
        : match.replace(`${quote}${specifier}${quote}`, `${quote}${runtimeSpecifier}${quote}`);
    }
  );
  if (rewritten !== source) {
    await writeFile(declaration, rewritten, 'utf8');
  }
}
