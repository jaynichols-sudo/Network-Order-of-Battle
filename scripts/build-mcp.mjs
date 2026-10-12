// Builds Northfix for AI tools:
//   dist-mcp/northfix-mcp.mjs  one file, engine inlined, runs with plain `node`
//   dist-mcp/northfix.mcpb     a Claude Desktop extension (a zip with manifest.json)
// Run with: npm run build:mcp
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import JSZip from 'jszip';

const OUT = 'dist-mcp';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The same engine bundle the Apple apps ship (JavaScriptCore), as text the server evaluates.
const engine = await build({ entryPoints: ['src/engine.js'], bundle: true, minify: true, format: 'iife', target: ['node18'], write: false, alias: { jszip: './src/stub-jszip.js' }, logLevel: 'warning' });
const engineText = engine.outputFiles[0].text;

await build({
  entryPoints: ['mcp/server.mjs'], bundle: true, platform: 'node', format: 'esm', target: ['node18'], outfile: `${OUT}/northfix-mcp.mjs`,
  define: { __NORTHFIX_ENGINE__: JSON.stringify(engineText) }, logLevel: 'warning',
  banner: { js: '#!/usr/bin/env node\n// Northfix for AI tools. Answers questions about your own network, on your Mac. https://northfix.app/ai.html' },
});
// esbuild keeps the source's shebang too; only the first line may carry one
const bundled = readFileSync(`${OUT}/northfix-mcp.mjs`, 'utf8').split('\n');
writeFileSync(`${OUT}/northfix-mcp.mjs`, [bundled[0], ...bundled.slice(1).filter(l => !l.startsWith('#!'))].join('\n'));
chmodSync(`${OUT}/northfix-mcp.mjs`, 0o755);

// Tool names and descriptions come straight from the server, so the install dialog matches.
const { TOOLS, VERSION } = await import('../mcp/server.mjs');
const manifest = {
  manifest_version: '0.2',
  name: 'northfix',
  display_name: 'Northfix',
  version: VERSION,
  description: 'Ask your AI about your own network: who you know at an agency, your warmest way in, who is waiting on you. Answered on your Mac.',
  long_description: 'Northfix for AI tools lets Claude answer questions about your own professional network, from the Northfix app’s files in your iCloud Drive. It runs on your Mac and reads your files read-only. Nothing goes to Northfix. Your AI app sees only the answers to the questions you ask. Northfix Pro answers without limits; on the free plan you get a network summary any time and three other questions a day.',
  author: { name: 'Jay Nichols', url: 'https://northfix.app' },
  homepage: 'https://northfix.app/ai.html',
  support: 'https://northfix.app/support.html',
  privacy_policies: ['https://northfix.app/privacy.html'],
  icon: 'icon.png',
  server: {
    type: 'node',
    entry_point: 'server/index.mjs',
    mcp_config: { command: 'node', args: ['${__dirname}/server/index.mjs'], env: { NORTHFIX_DATA: '${user_config.data_folder}' } },
  },
  tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
  tools_generated: false,
  keywords: ['linkedin', 'network', 'contacts', 'crm', 'federal', 'sales'],
  license: 'Proprietary',
  user_config: {
    data_folder: {
      type: 'directory', title: 'Northfix folder (optional)', required: false,
      description: 'Leave empty to use the Northfix app’s folder in your iCloud Drive. Set it only if your network files are somewhere else.',
    },
  },
  compatibility: { platforms: ['darwin'], runtimes: { node: '>=18.0.0' } },
};
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');

const zip = new JSZip();
zip.file('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
zip.file('server/index.mjs', readFileSync(`${OUT}/northfix-mcp.mjs`), { unixPermissions: 0o755 });
zip.file('icon.png', readFileSync('brand/northfix-icon-1024.png'));
const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX' });
writeFileSync(`${OUT}/northfix.mcpb`, bytes);
console.log(`built ${OUT}/northfix-mcp.mjs (${Math.round(readFileSync(`${OUT}/northfix-mcp.mjs`).length / 1024)} KB) and ${OUT}/northfix.mcpb (${Math.round(bytes.length / 1024)} KB)`);
