import { readFile, writeFile } from 'node:fs/promises';

const bundlePath = 'dist/server.mjs';
const bundle = await readFile(bundlePath, 'utf8');
const normalizedBundle = bundle.replace(/[\t ]+$/gm, '');

if (normalizedBundle !== bundle) {
  await writeFile(bundlePath, normalizedBundle);
}
