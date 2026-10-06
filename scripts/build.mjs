import { build } from 'esbuild';
import { mkdirSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
// Android (and browser) app: src/android/* on top of the shared engine.
rmSync('www', { recursive: true, force: true });
mkdirSync('www/fonts', { recursive: true });
copyFileSync('src/android/index.html', 'www/index.html');
copyFileSync('src/android/styles.css', 'www/styles.css');
copyFileSync('node_modules/leaflet/dist/leaflet.css', 'www/leaflet.css');
mkdirSync('www/geo', { recursive: true });
for (const f of ['geo-phone.json', 'geo-cities.json']) copyFileSync(`apple/Bearings/Resources/${f}`, `www/geo/${f}`);
// the same Geist files the iPhone app ships
for (const f of ['Geist-Regular.ttf', 'Geist-Medium.ttf', 'Geist-SemiBold.ttf', 'Geist-Bold.ttf', 'GeistMono-Medium.ttf', 'GeistMono-SemiBold.ttf', 'Geist-OFL.txt']) copyFileSync(`apple/Bearings/Fonts/${f}`, `www/fonts/${f}`);
await build({ entryPoints: ['src/android/main.js'], bundle: true, minify: true, format: 'iife', target: ['chrome100', 'safari16'], outfile: 'www/app.js', logLevel: 'warning', define: { __LINKEDIN_CONNECT_URL__: JSON.stringify(process.env.LINKEDIN_CONNECT_URL || '') } });
console.log('built www:', readdirSync('www').join(', '));
// Headless engine for the native Apple apps (runs in JavaScriptCore).
mkdirSync('apple/Bearings/Resources', { recursive: true });
await build({ entryPoints: ['src/engine.js'], bundle: true, minify: true, format: 'iife', target: ['safari17'], outfile: 'apple/Bearings/Resources/engine.js', alias: { jszip: './src/stub-jszip.js' }, logLevel: 'warning' });
console.log('built apple engine');
