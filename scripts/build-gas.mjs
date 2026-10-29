// Collects the Apps Script sources into build/. Writes nothing outside the build folder.
//   node scripts/build-gas.mjs           build/gas/ for clasp push (rootDir in .clasp.json)
//   node scripts/build-gas.mjs --bundle  build/gas-bundle.js, one file to paste into the Apps Script editor
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

// Uploaded name and source.
export const GAS_SOURCES = [
  ['Code.gs', 'gas/Code.gs'],
  ['Live.gs', 'gas/Live.gs'],
  ['Setup.gs', 'gas/Setup.gs']
];
export const GAS_MANIFEST = ['appsscript.json', 'gas/appsscript.json'];

// Apps Script loads every file into one global scope, so a repeated top-level name silently replaces the other.
// All top-level declarations in these sources start at column 0 as `function name(` or `const name =`.
export function topLevelNames(source) {
  const names = [];
  for (const match of source.matchAll(/^(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.push(match[1]);
  return names;
}

export async function readGasSources(root = repoRoot) {
  const files = [];
  for (const [name, source] of GAS_SOURCES) files.push({ name, text: await fs.readFile(path.join(root, source), 'utf8') });
  checkGasSources(files);
  return files;
}

export function checkGasSources(files) {
  const seen = new Map();
  for (const { name, text } of files) {
    if (/^\s*(?:import|export)\s/m.test(text) || /\brequire\s*\(/.test(text)) throw Error(name + ': Apps Script에서 쓸 수 없는 import·export·require가 있습니다.');
    for (const id of topLevelNames(text)) {
      if (seen.has(id)) throw Error('최상위 이름 ' + id + '이(가) ' + seen.get(id) + '와 ' + name + '에 함께 있습니다.');
      seen.set(id, name);
    }
  }
}

// Same inputs give byte-identical output: fixed order, no timestamps.
export function bundleGasSources(files) {
  const header = [
    '// 텀블러 공장 Apps Script 묶음. scripts/build-gas.mjs --bundle이 만든 파일이며 직접 고치지 않습니다.',
    '// 편집기의 코드 파일 하나에 전체를 붙여 넣습니다. 원본: ' + GAS_SOURCES.map(([, source]) => source).join(', ')
  ].join('\n');
  return header + '\n' + files.map(({ name, text }) => '\n// ===== ' + name + ' =====\n' + text.replace(/\s*$/, '\n')).join('');
}

export async function buildGas({ root = repoRoot, buildRoot = path.join(root, 'build'), bundle = false } = {}) {
  const files = await readGasSources(root);
  if (bundle) {
    const out = path.join(buildRoot, 'gas-bundle.js');
    await fs.mkdir(buildRoot, { recursive: true });
    await fs.writeFile(out, bundleGasSources(files));
    return [out];
  }
  const dir = path.join(buildRoot, 'gas');
  // A file removed from the sources must not linger and be pushed again.
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const written = [];
  for (const { name, text } of files) {
    await fs.writeFile(path.join(dir, name), text);
    written.push(path.join(dir, name));
  }
  await fs.copyFile(path.join(root, GAS_MANIFEST[1]), path.join(dir, GAS_MANIFEST[0]));
  written.push(path.join(dir, GAS_MANIFEST[0]));
  return written;
}

async function main() {
  const bundle = process.argv.includes('--bundle');
  const written = await buildGas({ bundle });
  for (const file of written) console.log(path.relative(repoRoot, file));
  if (bundle) console.log('Apps Script 편집기의 코드 파일 하나에 이 파일 전체를 붙여 넣습니다.');
}

// Importing for tests must not write build/; realpath keeps symlinked paths (e.g. /tmp) running.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
