// Tests for Northfix for AI tools (mcp/server.mjs): spawns the server the way Claude
// Desktop does, talks MCP over stdio, and reads the sample network saved in the app's
// own file format. Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sampleNetwork } from '../src/core.js';

const SERVER = path.resolve('mcp/server.mjs');
let root;

/** Saves the sample network the way the Apple apps do: network.json, edits.json, targets.json, pursuits.json. */
function writeSample(dir, {pro} = {}){
  fs.mkdirSync(dir, {recursive: true});
  const s = sampleNetwork();
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(dir, 'network.json'), JSON.stringify({meta: Object.assign({lastImport: today, n: 1}, s.meta || {}), rows: s.rows}));
  fs.writeFileSync(path.join(dir, 'edits.json'), JSON.stringify({edits: s.edits || {}, rev: Date.now()}));
  fs.writeFileSync(path.join(dir, 'targets.json'), JSON.stringify({targets: [{name: 'DISA', added: today}, {name: 'NAVFAC', added: today}]}));
  const disa = s.rows.find(r => /Defense Information Systems Agency/.test(r.c || ''));
  fs.writeFileSync(path.join(dir, 'pursuits.json'), JSON.stringify({pursuits: [{id: 'ptest', name: 'DISA zero trust gateway', agency: 'DISA', due: '', value: '$2M', stage: 'Pursuing',
    roles: {'Program manager': [disa.k || `${disa.f} ${disa.l}`]}, note: 'Industry day in November.', created: today}]}));
  if (pro != null) fs.writeFileSync(path.join(dir, 'ai-access.json'), JSON.stringify({pro, until: pro ? '2099-01-01T00:00:00Z' : null, written: new Date().toISOString()}));
}

/** A running server with a request helper. */
function start(env){
  const p = spawn(process.execPath, [SERVER], {env: Object.assign({}, process.env, env), stdio: ['pipe', 'pipe', 'pipe']});
  const waiting = new Map();
  let buf = '', next = 1;
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', c => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0){
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      const w = waiting.get(m.id); if (w){ waiting.delete(m.id); w(m); }
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    const t = setTimeout(() => reject(new Error(`timed out on ${method}`)), 15000);
    waiting.set(id, m => { clearTimeout(t); resolve(m); });
    p.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n');
  });
  const notify = (method, params) => p.stdin.write(JSON.stringify({jsonrpc: '2.0', method, params}) + '\n');
  const tool = async (name, args) => { const m = await request('tools/call', {name, arguments: args || {}}); assert.ok(m.result, JSON.stringify(m)); return m.result; };
  const stop = () => { p.stdin.end(); p.kill(); };
  return {request, notify, tool, stop};
}
const text = r => r.content.map(c => c.text).join('\n');

before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'northfix-mcp-')); });
after(() => { fs.rmSync(root, {recursive: true, force: true}); });

test('initialize, tools/list and ping follow MCP', async () => {
  const dir = path.join(root, 'basic'); writeSample(dir, {pro: true});
  const s = start({NORTHFIX_DATA: dir, NORTHFIX_STATE: path.join(root, 'state-basic')});
  try {
    const init = await s.request('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'test', version: '1'}});
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'northfix');
    assert.ok(init.result.capabilities.tools);
    s.notify('notifications/initialized');
    const older = await s.request('initialize', {protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'old', version: '1'}});
    assert.equal(older.result.protocolVersion, '2024-11-05');
    const future = await s.request('initialize', {protocolVersion: '2099-01-01', capabilities: {}, clientInfo: {name: 'new', version: '1'}});
    assert.equal(future.result.protocolVersion, '2025-06-18');
    assert.deepEqual((await s.request('ping')).result, {});
    const list = (await s.request('tools/list')).result.tools;
    const names = list.map(t => t.name).sort();
    assert.deepEqual(names, ['agency_coverage', 'network_summary', 'person', 'pursuit', 'pursuits', 'search_people', 'waiting_on_me', 'ways_in', 'weekly_five', 'who_changed_jobs']);
    for (const t of list){
      assert.match(t.name, /^[a-z_]+$/);
      assert.ok(t.description.length > 40, t.name);
      assert.equal(t.inputSchema.type, 'object');
      assert.equal(t.annotations.readOnlyHint, true);
    }
    const bad = await s.request('no/such/method');
    assert.equal(bad.error.code, -32601);
  } finally { s.stop(); }
});

test('tools answer from the saved network (Pro)', async () => {
  const dir = path.join(root, 'pro'); writeSample(dir, {pro: true});
  const s = start({NORTHFIX_DATA: dir, NORTHFIX_STATE: path.join(root, 'state-pro')});
  try {
    await s.request('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'test', version: '1'}});
    const sum = await s.tool('network_summary');
    assert.ok(sum.structuredContent.people > 500, text(sum));
    assert.match(text(sum), /people across/);
    assert.ok(sum.structuredContent.watchlist.some(t => t.name === 'DISA'));

    const ways = await s.tool('ways_in', {company_or_agency: 'DISA'});
    assert.match(text(ways), /best ways into/i);
    assert.ok(ways.structuredContent.best.length >= 1);
    assert.ok(ways.structuredContent.worksThereNow.count > 0);

    const found = await s.tool('search_people', {query: 'who do I know at DISA'});
    assert.ok(found.structuredContent.people.length > 0, text(found));

    const first = found.structuredContent.people[0];
    const prof = await s.tool('person', {name_or_key: first.name.replace(/^(Col|Lt Col|Maj|Capt|Gen|CAPT|CDR|LCDR|LT|Brig Gen|Maj Gen|Lt Gen) /, '')});
    assert.equal(prof.structuredContent.key, first.key, text(prof));
    assert.match(text(prof), /Closeness:/);
    const byKey = await s.tool('person', {name_or_key: first.key});
    assert.equal(byKey.structuredContent.name, first.name);
    const nobody = await s.tool('person', {name_or_key: 'Zebulon Quixote'});
    assert.equal(nobody.structuredContent.found, false);

    const waiting = await s.tool('waiting_on_me');
    assert.ok(waiting.structuredContent.count > 0, text(waiting));
    const five = await s.tool('weekly_five');
    assert.ok(five.structuredContent.people.length > 0 && five.structuredContent.people.length <= 5);
    const jobs = await s.tool('who_changed_jobs', {days: 365});
    assert.ok(jobs.structuredContent.count > 0, text(jobs));

    const fed = await s.tool('agency_coverage');
    assert.match(text(fed), /Federal map: \d+ of \d+ agencies covered/);
    const def = await s.tool('agency_coverage', {filter: 'DISA'});
    assert.ok(def.structuredContent.agencies.length >= 1);

    const ps = await s.tool('pursuits');
    assert.equal(ps.structuredContent.pursuits.length, 1);
    const p = await s.tool('pursuit', {name: 'zero trust'});
    assert.equal(p.structuredContent.name, 'DISA zero trust gateway');
    assert.equal(p.structuredContent.seats.length, 6);
    assert.match(text(p), /Program manager/);
    assert.ok(!/free plan/.test(text(p)), 'Pro answers carry no free-plan note');
  } finally { s.stop(); }
});

test('free plan: network_summary always, plus 3 other questions a day', async () => {
  const dir = path.join(root, 'free'); writeSample(dir, {pro: false});
  const s = start({NORTHFIX_DATA: dir, NORTHFIX_STATE: path.join(root, 'state-free')});
  try {
    await s.request('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'test', version: '1'}});
    for (let i = 0; i < 3; i++){
      const r = await s.tool('ways_in', {company_or_agency: 'DISA'});
      assert.equal(r.structuredContent.ok, true);
      assert.match(text(r), new RegExp(`${2 - i} of 3 questions left today`));
    }
    const blocked = await s.tool('weekly_five');
    assert.equal(blocked.structuredContent.reason, 'free_limit');
    assert.match(text(blocked), /Northfix Pro/);
    const sum = await s.tool('network_summary');
    assert.equal(sum.structuredContent.ok, true);
    // Pro written by the app later lifts the limit straight away
    fs.writeFileSync(path.join(dir, 'ai-access.json'), JSON.stringify({pro: true, until: '2099-01-01T00:00:00Z', written: new Date().toISOString()}));
    const now = await s.tool('weekly_five');
    assert.equal(now.structuredContent.ok, true);
    // an expired Pro counts as free
    fs.writeFileSync(path.join(dir, 'ai-access.json'), JSON.stringify({pro: true, until: '2001-01-01T00:00:00Z', written: new Date().toISOString()}));
    assert.equal((await s.tool('weekly_five')).structuredContent.reason, 'free_limit');
  } finally { s.stop(); }
});

test('no data: a clear message, and it picks up the network once the app saves it', async () => {
  const dir = path.join(root, 'empty'); fs.mkdirSync(dir, {recursive: true});
  const s = start({NORTHFIX_DATA: dir, NORTHFIX_STATE: path.join(root, 'state-empty')});
  try {
    await s.request('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'test', version: '1'}});
    const r = await s.tool('network_summary');
    assert.equal(r.structuredContent.ok, false);
    assert.match(text(r), /no Northfix network/i);
    writeSample(dir, {pro: true});
    const ok = await s.tool('network_summary');
    assert.equal(ok.structuredContent.ok, true);
    // edits saved by the app show up on the next call
    const people = (await s.tool('search_people', {query: 'DISA', limit: 1})).structuredContent.people;
    const k = people[0].key;
    const edits = JSON.parse(fs.readFileSync(path.join(dir, 'edits.json'), 'utf8'));
    edits.edits[k] = Object.assign({}, edits.edits[k], {note: 'Met at TechNet, wants a demo.'});
    fs.writeFileSync(path.join(dir, 'edits.json'), JSON.stringify(edits));
    const fresh = new Date(Date.now() + 5000); fs.utimesSync(path.join(dir, 'edits.json'), fresh, fresh);
    const prof = await s.tool('person', {name_or_key: k});
    assert.match(text(prof), /wants a demo/);
  } finally { s.stop(); }
});

test('the server never writes to the network folder', async () => {
  const dir = path.join(root, 'ro'); writeSample(dir, {pro: false});
  const before = fs.readdirSync(dir).sort().map(f => [f, fs.statSync(path.join(dir, f)).mtimeMs]);
  const s = start({NORTHFIX_DATA: dir, NORTHFIX_STATE: path.join(root, 'state-ro')});
  try {
    await s.request('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'test', version: '1'}});
    await s.tool('ways_in', {company_or_agency: 'NAVFAC'});
    await s.tool('network_summary');
  } finally { s.stop(); }
  assert.deepEqual(fs.readdirSync(dir).sort().map(f => [f, fs.statSync(path.join(dir, f)).mtimeMs]), before);
});
