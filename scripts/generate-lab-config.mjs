import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const sourcePath = resolve(repositoryRoot, 'config/lab.yaml');
const outputPath = resolve(repositoryRoot, 'src/config/lab.generated.json');
const checkOnly = process.argv.includes('--check');

const source = await readFile(sourcePath, 'utf8');
const config = parse(source);

if (typeof config !== 'object' || config === null) {
  throw new Error('config/lab.yaml must contain an object.');
}

const expected = `${JSON.stringify(config, null, 2)}\n`;
if (checkOnly) {
  let actual;
  try {
    actual = await readFile(outputPath, 'utf8');
  } catch {
    throw new Error('Generated Lab configuration is missing. Run npm run generate:config.');
  }
  if (actual !== expected) {
    throw new Error('Generated Lab configuration is stale. Run npm run generate:config and commit the result.');
  }
} else {
  await writeFile(outputPath, expected, 'utf8');
}
