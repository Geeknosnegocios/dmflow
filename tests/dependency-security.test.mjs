import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const packageLock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));

test('pins Next.js and PostCSS to the approved security versions in the manifest and lockfile', () => {
  assert.equal(packageJson.dependencies.next, '16.4.3');
  assert.equal(packageJson.devDependencies.postcss, '8.5.23');

  assert.equal(packageLock.packages[''].dependencies.next, '16.4.3');
  assert.equal(packageLock.packages[''].devDependencies.postcss, '8.5.23');
  assert.equal(packageLock.packages['node_modules/next'].version, '16.4.3');
  assert.equal(packageLock.packages['node_modules/postcss'].version, '8.5.23');
  assert.equal(packageLock.packages['node_modules/sharp'].version, '0.35.5');
});
