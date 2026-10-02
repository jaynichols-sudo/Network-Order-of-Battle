import { build } from 'esbuild';
import { mkdirSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
rmSync('www', { recursive: true, force: true });
mkdirSync('www/fonts', { recursive: true });
copyFileSync('src/index.html', 'www/index.html');
copyFileSync('src/styles.css', 'www/styles.css');
const fonts = [
  ['chakra-petch', [500, 600, 700]],
  ['ibm-plex-sans', [400, 500, 600]],
  ['ibm-plex-mono', [500]],
];
for (const [fam, ws] of fonts) for (const w of ws) {
  const f = `${fam}-latin-${w}-normal.woff2`;
  copyFileSync(`node_modules/@fontsource/${fam}/files/${f}`, `www/fonts/${f}`);
}
await build({ entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'iife', target: ['safari15', 'chrome100'], outfile: 'www/app.js', logLevel: 'warning' });
console.log('built www:', readdirSync('www').join(', '));
