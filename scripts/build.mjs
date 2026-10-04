import { build } from 'esbuild';
import { mkdirSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
rmSync('www', { recursive: true, force: true });
mkdirSync('www/fonts', { recursive: true });
copyFileSync('src/index.html', 'www/index.html');
copyFileSync('src/styles.css', 'www/styles.css');
copyFileSync('node_modules/leaflet/dist/leaflet.css', 'www/leaflet.css');
mkdirSync('www/geo', { recursive: true });
for (const f of ['geo-phone.json', 'geo-cities.json']) copyFileSync(`apple/Bearings/Resources/${f}`, `www/geo/${f}`);
const fonts = [
  ['geist', [400, 500, 600, 700, 800]],
];
for (const [fam, ws] of fonts) for (const w of ws) {
  const f = `${fam}-latin-${w}-normal.woff2`;
  copyFileSync(`node_modules/@fontsource/${fam}/files/${f}`, `www/fonts/${f}`);
}
await build({ entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'iife', target: ['safari15', 'chrome100'], outfile: 'www/app.js', logLevel: 'warning' });
console.log('built www:', readdirSync('www').join(', '));
// Headless engine for the native Apple apps (runs in JavaScriptCore).
mkdirSync('apple/Bearings/Resources', { recursive: true });
await build({ entryPoints: ['src/engine.js'], bundle: true, minify: true, format: 'iife', target: ['safari17'], outfile: 'apple/Bearings/Resources/engine.js', alias: { jszip: './src/stub-jszip.js' }, logLevel: 'warning' });
console.log('built apple engine');
