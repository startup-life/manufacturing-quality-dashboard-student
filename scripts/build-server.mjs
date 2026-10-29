// The last step of npm run build, after tsc has written dist/*.js.
// The root package.json says "type": "module", so Node would read tsc's CommonJS output as ES modules;
// dist/package.json says "type": "commonjs" for that folder. tsc never deletes it, but after a first build with
// `npx tsc` alone it is missing and `node dist/main.js` stops with "exports is not defined in ES module scope":
// build with npm run build (npm start does it first).
import fs from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(new URL('package.json', dist), JSON.stringify({ type: 'commonjs' }) + '\n');
