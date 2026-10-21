#!/usr/bin/env node
// Northfix for AI tools: a local MCP server that answers questions about your own
// network, on your own Mac. It reads the files the Northfix app saves in your iCloud
// Drive and runs the same engine the apps use. Nothing about your network is sent anywhere:
// the only way out is the stdio pipe to the AI app that started it. Recompetes and teaming
// partners ask USASpending.gov for public contract data, sending only agency names. The only
// write is ai-inbox.json, where log_note, log_call, update_pursuit_stage and draft_follow_up
// (the last three only with confirm: true) leave changes for the app to file.
//
// Zero dependencies. MCP over stdio: JSON-RPC 2.0, one message per line.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = '1.2.0';
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const FREE_DAILY = 3;
const FREE_TOOLS = new Set(['network_summary']);
const FILES = ['network', 'edits', 'review', 'targets', 'industries', 'team', 'prospects', 'pursuits', 'history', 'social'];
// Notes logged from an AI app wait here until Northfix opens and files them. It's the only file
// this tool writes in the network folder; the app deletes it once the notes are filed.
const INBOX = 'ai-inbox.json';

/* ---------- the engine ---------- */
// The build inlines the engine as text (__NORTHFIX_ENGINE__). From the repo, it's the
// same bundle the Apple apps ship. Evaluated fresh each day, because the engine works
// out "today" when it starts.
/* global __NORTHFIX_ENGINE__ */
const HERE = path.dirname(fileURLToPath(import.meta.url));
let engineSource = null;
function source(){
  if (engineSource) return engineSource;
  if (typeof __NORTHFIX_ENGINE__ !== 'undefined') engineSource = __NORTHFIX_ENGINE__;
  else engineSource = fs.readFileSync(path.join(HERE, '..', 'apple', 'Northfix', 'Resources', 'engine.js'), 'utf8');
  return engineSource;
}
let engineDay = '';
function startEngine(){
  new Function(source())();
  engineDay = localDay();
}
function call(name, ...args){
  const r = JSON.parse(globalThis.Bearings.call(name, JSON.stringify(args)));
  if (r.error) throw new Error(r.error);
  return r.ok;
}

/* ---------- where the app keeps its files ---------- */
function argData(argv){
  for (let i = 0; i < argv.length; i++){
    if (argv[i] === '--data' && argv[i + 1]) return argv[i + 1];
    if (argv[i].startsWith('--data=')) return argv[i].slice(7);
  }
  return '';
}
const expand = p => p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
// An unfilled Claude Desktop setting arrives as the literal placeholder.
const usable = v => !!v && !/^\$\{.*\}$/.test(v.trim());
export function candidates(env = process.env, argv = process.argv.slice(2)){
  const override = argData(argv) || env.NORTHFIX_DATA || '';
  if (usable(override)) return [{dir: path.resolve(expand(override.trim())), kind: 'custom'}];
  const home = os.homedir();
  return [
    {dir: path.join(home, 'Library', 'Mobile Documents', 'iCloud~com~jaynichols~networkoob', 'Documents'), kind: 'icloud'},
    {dir: path.join(home, 'Library', 'Containers', 'com.jaynichols.networkoob', 'Data', 'Library', 'Application Support', 'NetworkOOB'), kind: 'local'},
  ];
}
const exists = p => { try { fs.statSync(p); return true; } catch { return false; } };
/** The folder with the user's network in it, or why there isn't one. */
function findData(){
  const list = candidates();
  for (const c of list) if (exists(path.join(c.dir, 'network.json'))) return {dir: c.dir, kind: c.kind};
  for (const c of list) if (exists(path.join(c.dir, '.network.json.icloud'))) return {problem: 'evicted', dir: c.dir};
  return {problem: list[0].kind === 'custom' ? 'custom' : 'missing', dir: list[0].dir};
}
function noDataText(f){
  if (f.problem === 'evicted') return 'Your Northfix network is in iCloud Drive but not downloaded to this Mac yet. Open Northfix on this Mac once and leave it open for a minute, then ask again.';
  if (f.problem === 'custom') return `There’s no Northfix network in ${f.dir}. Check the folder (it should contain network.json), or remove the NORTHFIX_DATA setting to use the Northfix app’s own folder.`;
  return 'I can’t find your Northfix network on this Mac yet. To fix it: install Northfix on this Mac, open it once, and make sure iCloud Drive is on (System Settings, your name, iCloud, iCloud Drive). Northfix saves your network there, and this tool reads it from there. Then ask again.';
}

/* ---------- loading, and reloading when the app saves ---------- */
const state = {dir: '', sig: '', loaded: false, info: null, people: new Map(), loadError: ''};
function signature(dir){
  return FILES.map(n => { try { const s = fs.statSync(path.join(dir, n + '.json')); return `${n}:${s.mtimeMs}:${s.size}`; } catch { return `${n}:-`; } }).join('|');
}
const readText = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
/** Makes sure the engine holds the latest saved network. Returns null, or text explaining what's wrong. */
function ensureLoaded(){
  const f = findData();
  if (f.problem){ state.loaded = false; state.dir = ''; return noDataText(f); }
  const sig = signature(f.dir);
  if (state.loaded && state.dir === f.dir && state.sig === sig && engineDay === localDay()) return null;
  if (engineDay !== localDay() || !globalThis.Bearings) startEngine();
  const texts = {};
  for (const n of FILES){ const t = readText(path.join(f.dir, n + '.json')); if (t != null) texts[n] = t; }
  try {
    const info = call('loadFiles', texts, null);
    if (info.empty){ state.loaded = false; return 'Your Northfix network file is there but empty or unreadable. Open Northfix on this Mac so it can save it again, then ask again.'; }
    state.info = info;
    state.people = new Map(call('people').map(p => [p.k, p]));
    state.dir = f.dir; state.sig = sig; state.loaded = true; state.loadError = '';
    return null;
  } catch (e) {
    state.loaded = false;
    return `Your Northfix files didn’t load (${e.message}). Open Northfix on this Mac once, then ask again.`;
  }
}

/* ---------- Pro, and the free daily allowance ---------- */
function localDay(d = new Date()){ return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
/** The app writes ai-access.json next to your network when you have Northfix Pro. */
function isPro(){
  if (!state.dir) return false;
  try {
    const a = JSON.parse(fs.readFileSync(path.join(state.dir, 'ai-access.json'), 'utf8'));
    if (a.pro !== true) return false;
    // a subscription renews while the app is closed; a week's grace covers the gap until it next opens
    if (a.until && Date.parse(a.until) + 7 * 864e5 < Date.now()) return false;
    return true;
  } catch { return false; }
}
// The count of free questions lives on this Mac, outside your network folder.
function stateFile(){
  const custom = process.env.NORTHFIX_STATE;
  const dir = usable(custom) ? expand(custom) : process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Northfix AI') : path.join(os.homedir(), '.northfix-ai');
  return path.join(dir, 'usage.json');
}
function usage(){
  try { const u = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); if (u.day === localDay()) return u; } catch { /* first use */ }
  return {day: localDay(), used: 0};
}
function spend(){
  const u = usage(); u.used++;
  try { fs.mkdirSync(path.dirname(stateFile()), {recursive: true}); fs.writeFileSync(stateFile(), JSON.stringify(u)); } catch { /* counting is best effort */ }
  return u.used;
}
const LIMIT_TEXT = `That’s today’s ${FREE_DAILY} free questions from Northfix in your AI tools. Northfix Pro answers as many as you like. To upgrade, open Northfix and go to You, then Northfix Pro. Your free questions come back tomorrow, and network_summary is always free.`;

/* ---------- formatting ---------- */
const BAND = {strong: 'close', warm: 'warm', light: 'light touch', none: 'no real contact'};
const nice = d => { if (!d) return ''; const t = Date.parse(d.length === 7 ? d + '-01' : d); return isNaN(t) ? d : new Date(t).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'}); };
const roleLine = p => [p.p, p.c].filter(Boolean).join(' at ');
function brief(k, why){
  const p = state.people.get(k); if (!p) return null;
  const o = {key: k, name: p.name, title: p.p || '', company: p.c || '', closeness: BAND[p.band || 'none']};
  if (why) o.why = why;
  return o;
}
const line = b => `- ${b.name}${b.title || b.company ? ` (${[b.title, b.company].filter(Boolean).join(', ')})` : ''}${b.why ? `: ${b.why}` : ''}`;
const listText = (head, items) => [head, ...items.map(line)].join('\n');
const n = v => Number(v || 0).toLocaleString('en-US');
// lowercase the first letter only, so SES and DoD keep their capitals
const lower = s => s ? s[0].toLowerCase() + s.slice(1) : '';

/* ---------- tools ---------- */
const str = (description, extra) => Object.assign({type: 'string', description}, extra || {});
const RO = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};
// Recompetes and teaming partners ask USASpending.gov (public data, agency names only). Logging a
// note is the one write, and it only adds a file the app picks up (see INBOX below).
const WRITE = {readOnlyHint: false, idempotentHint: false};
const ANNOTATIONS = {recompetes: {openWorldHint: true}, teaming_partners: {openWorldHint: true}, log_note: WRITE, log_call: WRITE, update_pursuit_stage: WRITE, draft_follow_up: WRITE};
export const WRITE_TOOLS = new Set(['log_note', 'log_call', 'update_pursuit_stage', 'draft_follow_up']);
const confirmProp = {type: 'boolean', description: 'Must be true to save. Leave it false first to show the user exactly what will be saved, and only set it to true after the user says yes.'};
export const TOOLS = [
  {name: 'search_people', title: 'Search your network',
    description: 'Find people in the user’s own LinkedIn network with a plain-English question or keywords, for example “colonels at Fort Liberty”, “who do I know at Duke Energy”, “contracting officers at NAVFAC”, “who used to be at Leidos”. Returns up to 25 matching people with title, company and how close the user is to each.',
    inputSchema: {type: 'object', properties: {query: str('What to look for, in plain English or keywords.'), limit: {type: 'integer', minimum: 1, maximum: 25, description: 'How many people to return (default 12).'}}, required: ['query']}},
  {name: 'person', title: 'One person’s profile',
    description: 'A profile summary for one person in the user’s network: current role, where they worked before, how close the user is to them, the last message, the user’s own notes and follow-ups. Pass a name (“Dana Whitfield”) or a key returned by another tool.',
    inputSchema: {type: 'object', properties: {name_or_key: str('A person’s name, or the key from another tool’s result.')}, required: ['name_or_key']}},
  {name: 'ways_in', title: 'Ways in',
    description: 'The user’s best paths into a company, agency or command: who works there now, who used to, and close contacts in the same sector who likely know people there, ranked warmest first. Includes teammates’ contacts when the user is on a Northfix Team.',
    inputSchema: {type: 'object', properties: {company_or_agency: str('A company, agency or command, for example “DISA”, “USACE”, “Duke Energy”.')}, required: ['company_or_agency']}},
  {name: 'waiting_on_me', title: 'Waiting on me',
    description: 'People who messaged or emailed the user last and are still waiting on a reply.',
    inputSchema: {type: 'object', properties: {}}},
  {name: 'weekly_five', title: 'This week’s five',
    description: 'Five people worth reaching out to this week, each with one plain reason: waiting on a reply, overdue follow-ups, new jobs, relationships going cold, anniversaries.',
    inputSchema: {type: 'object', properties: {}}},
  {name: 'who_changed_jobs', title: 'Who changed jobs',
    description: 'People in the user’s network who started a new role recently, with their new and previous role.',
    inputSchema: {type: 'object', properties: {days: {type: 'integer', minimum: 1, maximum: 730, description: 'How far back to look, in days (default 90).'}}}},
  {name: 'agency_coverage', title: 'Federal coverage map',
    description: 'How well the user’s network covers about 160 federal departments, agencies and military commands: covered (someone senior and someone warm), thin, or no one yet, by department. Optionally filter to one department or agency name.',
    inputSchema: {type: 'object', properties: {filter: str('Optional: a department (“Defense”, “Energy”) or agency (“DISA”, “NAVFAC”) to focus on.')}}},
  {name: 'pursuits', title: 'Pursuits',
    description: 'The user’s pursuits (bids and deals they track in Northfix): stage, due date, value, and how many decision-maker seats they know someone in.',
    inputSchema: {type: 'object', properties: {}}},
  {name: 'pursuit', title: 'One pursuit',
    description: 'One pursuit in detail: each decision-maker seat (executive sponsor, program manager, contracting officer, mission owner, security lead, technical lead) and industry seat (incumbent, teaming partner), who fills it, who owns it on the team, which seats are going cold, suggestions for empty seats, the win chance and the warmest ways in.',
    inputSchema: {type: 'object', properties: {name: str('The pursuit’s name, or part of it.')}, required: ['name']}},
  {name: 'pipeline', title: 'Pipeline',
    description: 'The user’s pursuits as a pipeline: open value and value weighted by win chance, by stage, what is due this quarter, and won and lost history with the win rate. Optionally includes teammates’ shared pursuits.',
    inputSchema: {type: 'object', properties: {include_team: {type: 'boolean', description: 'Include pursuits shared by teammates on a Northfix Team (default false).'}}}},
  {name: 'cold_seats', title: 'Cold seats',
    description: 'Decision-maker seats on open pursuits due soon where the user has not been in touch with the person in the seat for 60 days or more.',
    inputSchema: {type: 'object', properties: {}}},
  {name: 'call_plan', title: 'Call plan',
    description: 'Facts for a short plan before talking to someone: their role, closeness, last contact, notes, recent changes, and their seat on a pursuit, plus a simple plan (goal, opener, questions, next step). Use the facts to write a better plan if asked.',
    inputSchema: {type: 'object', properties: {name_or_key: str('A person’s name, or the key from another tool’s result.'), pursuit: str('Optional: the pursuit this call is about.')}, required: ['name_or_key']}},
  {name: 'recompetes', title: 'Recompetes',
    description: 'Federal contracts ending soon at the agencies the user works (their watchlist and pursuits, or the agencies named), from USASpending.gov public data: the incumbent, value, end date, and who the user knows at the agency and at the incumbent. Only agency names are sent to USASpending.gov.',
    inputSchema: {type: 'object', properties: {agencies: {type: 'array', items: {type: 'string'}, description: 'Optional: agencies or commands to look at, for example ["DISA", "NAVFAC"]. Defaults to the watchlist and open pursuits.'},
      months: {type: 'integer', minimum: 3, maximum: 36, description: 'How far ahead to look, in months (default 24).'}}}},
  {name: 'teaming_partners', title: 'Teaming partners',
    description: 'Companies that win contracts at an agency, from USASpending.gov public data, biggest first, with who the user and their team know at each. Only the agency name is sent to USASpending.gov.',
    inputSchema: {type: 'object', properties: {agency: str('An agency or command, for example “DISA”.')}, required: ['agency']}},
  {name: 'log_note', title: 'Log a note',
    description: 'Adds a dated note to one person in the user’s Northfix network, for example after a call. Northfix files it the next time the app opens on this Mac. Only use when the user asks to save a note.',
    inputSchema: {type: 'object', properties: {name_or_key: str('A person’s name, or the key from another tool’s result.'), note: str('The note, in plain words. Up to 480 characters.')}, required: ['name_or_key', 'note']}},
  {name: 'bid_decision', title: 'Bid or no bid',
    description: 'The bid/no-bid scorecard for one pursuit: eight standard capture questions (customer relationships, decision makers, incumbent, teaming partner, eligibility, time, cost, past performance), the user’s answers or Northfix’s suggestions from their data with the reason, a score out of 100, and a recommendation: bid, bid with conditions, or no bid.',
    inputSchema: {type: 'object', properties: {pursuit: str('The pursuit’s name, or part of it.')}, required: ['pursuit']}},
  {name: 'capture_digest', title: 'Weekly capture digest',
    description: 'A short weekly summary across all open pursuits: key dates in the next two weeks (industry days, questions due, RFPs, proposals, orals), seats going cold, empty decision-maker seats, bid decisions to look at, and the open and weighted pipeline. Good for a Monday capture meeting.',
    inputSchema: {type: 'object', properties: {}}},
  {name: 'log_call', title: 'Log a call',
    description: 'Records a call with one person in the user’s Northfix network: a dated “Call:” note, marks them as contacted today, and optionally sets a follow-up. With confirm false (or missing) it only previews and saves nothing; set confirm true only after the user approves the preview. Northfix files it the next time the app opens on this Mac.',
    inputSchema: {type: 'object', properties: {name_or_key: str('A person’s name, or the key from another tool’s result.'), summary: str('What was discussed, in plain words. Up to 470 characters.'),
      follow_up_days: {type: 'integer', minimum: 1, maximum: 365, description: 'Optional: follow up in this many days.'}, confirm: confirmProp}, required: ['name_or_key', 'summary', 'confirm']}},
  {name: 'update_pursuit_stage', title: 'Move a pursuit to a new stage',
    description: 'Moves one pursuit to a new stage: Tracking, Pursuing, Proposal, Submitted, Won or Lost. With confirm false (or missing) it only previews; set confirm true only after the user approves. Northfix applies it the next time the app opens on this Mac.',
    inputSchema: {type: 'object', properties: {pursuit: str('The pursuit’s name, or part of it.'), stage: str('The new stage.', {enum: ['Tracking', 'Pursuing', 'Proposal', 'Submitted', 'Won', 'Lost']}), confirm: confirmProp}, required: ['pursuit', 'stage', 'confirm']}},
  {name: 'draft_follow_up', title: 'Draft a follow-up',
    description: 'Drafts a short follow-up message to one person from what Northfix knows (last conversation, notes, pursuit), for the user to send themselves. Northfix never sends it. Optionally saves a follow-up date and the purpose as a note, only with confirm true after the user approves.',
    inputSchema: {type: 'object', properties: {name_or_key: str('A person’s name, or the key from another tool’s result.'), purpose: str('Optional: what the follow-up is for, like “send the zero trust brief”.'),
      follow_up_on: str('Optional: a follow-up date, YYYY-MM-DD, to save with confirm true.'), confirm: confirmProp}, required: ['name_or_key', 'confirm']}},
  {name: 'network_summary', title: 'Network summary',
    description: 'A short overview of the user’s network: how many people, companies and industries, who’s senior, how many are waiting on a reply or changed jobs, and the watchlist. Always free.',
    inputSchema: {type: 'object', properties: {}}},
].map(t => Object.assign(t, {annotations: Object.assign({title: t.title}, RO, ANNOTATIONS[t.name] || {})}));

function findPerson(q){
  const s = String(q || '').trim();
  if (!s) throw new Error('Say who: a name or a key.');
  if (state.people.has(s)) return {k: s};
  const want = s.toLowerCase().replace(/\s+/g, ' ');
  const all = [...state.people.values()].filter(p => !p.x);
  const exact = all.filter(p => `${p.f} ${p.l}`.toLowerCase() === want || p.name.toLowerCase() === want);
  if (exact.length === 1) return {k: exact[0].k};
  const pool = exact.length ? exact : all.filter(p => want.split(' ').every(t => `${p.f} ${p.l}`.toLowerCase().includes(t)));
  if (pool.length === 1) return {k: pool[0].k};
  if (pool.length) return {choices: pool.slice(0, 10).map(p => brief(p.k))};
  return {choices: []};
}

/** Runs the engine's USASpending searches from this Mac. Only agency names leave it. */
async function fetchAwards(names, months){
  const reqs = call('awardRequests', names, months);
  const ok = [], errors = [];
  await Promise.all(reqs.map(async r => {
    try {
      // NORTHFIX_USASPENDING_URL points tests at a local stand-in
      const url = usable(process.env.NORTHFIX_USASPENDING_URL) ? process.env.NORTHFIX_USASPENDING_URL : r.url;
      const res = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify(r.body), signal: AbortSignal.timeout(20000)});
      const page = call('awardPage', await res.text(), res.status);
      if (page.error) errors.push(page.error); else ok.push({agencyId: r.agencyId, items: page.items});
    } catch { errors.push('USASpending.gov didn’t answer. Check the internet connection and try again.'); }
  }));
  return {ok, errors: [...new Set(errors)], asked: reqs.map(r => r.short)};
}

/** One pursuit by name, part of a name, agency or id: {id}, or {answer} saying why not. */
function pickPursuit(name){
  const q = String(name || '').trim().toLowerCase();
  if (!q) throw new Error('Say which pursuit.');
  const ps = call('pursuits');
  const hit = ps.find(p => p.id === name) || ps.find(p => p.name.toLowerCase() === q) || ps.filter(p => p.name.toLowerCase().includes(q) || (p.agency || '').toLowerCase().includes(q));
  const list = Array.isArray(hit) ? hit : hit ? [hit] : [];
  if (!list.length) return {answer: {text: ps.length ? `No pursuit called “${name}”. Your pursuits: ${ps.map(p => p.name).join(', ')}.` : 'No pursuits yet. Add one in Northfix (Pursuits).', data: {found: false, pursuits: ps.map(p => p.name)}}};
  if (list.length > 1) return {answer: {text: `Several pursuits match: ${list.map(p => p.name).join(', ')}. Which one?`, data: {found: false, pursuits: list.map(p => p.name)}}};
  return {id: list[0].id};
}

/* ---------- the inbox the app files ---------- */
// Every write goes to ai-inbox.json next to the network files; the app files it when it opens.
// Never overwrites entries it can't read, and always writes whole files.
function appendInbox(entry){
  const file = path.join(state.dir, INBOX);
  let list = [];
  if (fs.existsSync(path.join(state.dir, '.' + INBOX + '.icloud'))) throw new Error('Earlier notes from Claude are still downloading from iCloud. Open Northfix on this Mac, then try again.');
  if (fs.existsSync(file)){
    const raw = fs.readFileSync(file, 'utf8');
    // a file being written or in an iCloud conflict: never overwrite notes not filed yet
    let j; try { j = raw.trim() ? JSON.parse(raw) : {notes: []}; } catch { throw new Error('Notes from Claude waiting for Northfix couldn’t be read. Open Northfix on this Mac to file them, then try again.'); }
    if (j && Array.isArray(j.notes)) list = j.notes;
  }
  list.push(entry);
  // write a temporary file and rename it, so the app never reads half a file
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({kind: 'northfix-ai-inbox', v: 1, notes: list.slice(-200)}));
  fs.renameSync(tmp, file);
  return list;
}
const preview = (what, data) => ({text: `${what}\nNothing is saved yet. If the user agrees, call again with confirm: true.`, data: Object.assign({saved: false, needsConfirm: true}, data)});
const whoIs = (f, q) => !f.k ? (!f.choices.length ? {text: `No one called “${q}” in your network. Nothing saved.`, data: {saved: false, choices: []}}
  : {text: listText(`Several people match “${q}”. Which one? Nothing saved yet.`, f.choices), data: {saved: false, choices: f.choices}}) : null;

const handlers = {
  search_people({query, limit}){
    const q = String(query || '').trim();
    if (!q) throw new Error('Ask a question or give some keywords.');
    const max = Math.min(25, Math.max(1, +limit || 12));
    let a = call('ask', q);
    if (a.kind === 'city' || a.kind === 'none'){ const s = call('search', {text: q, filters: {}, sort: 'warm'}); a = {kind: 'search', answer: `${n(s.count)} ${s.count === 1 ? 'match' : 'matches'}.`, people: s.keys.map(k => ({k, why: ''}))}; }
    let ps = a.people;
    if (a.kind === 'search' && ps.length < max){ const s = call('search', {text: q, filters: {}, sort: 'warm'}); ps = s.keys.map(k => ({k, why: ''})); }
    // a plain search's "why" is just title and company, which each person already carries
    const people = ps.slice(0, max).map(x => brief(x.k, a.kind === 'search' ? '' : x.why)).filter(Boolean);
    const head = a.answer || `${n(people.length)} people.`;
    return {text: people.length ? listText(head, people) : `${head} Try different words, a company or agency name, or a title.`, data: {query: q, answer: head, kind: a.kind, people}};
  },
  person({name_or_key}){
    const f = findPerson(name_or_key);
    if (!f.k){
      if (!f.choices.length) return {text: `No one called “${name_or_key}” in your network.`, data: {found: false, choices: []}};
      return {text: listText(`Several people match “${name_or_key}”. Which one?`, f.choices), data: {found: false, choices: f.choices}};
    }
    const p = call('person', f.k), m = call('memory', f.k);
    const ed = p.ed || {};
    const out = {key: p.k, name: p.name, title: p.p || '', company: p.c || '', agency: p.cl.agency || '', industry: p.cl.ind || '', seniority: p.cl.sen || '',
      branch: p.cl.branch || '', rank: p.cl.rank || '', status: p.cl.status || '', connected: p.d || '', closeness: BAND[p.band || 'none'], email: p.e || '',
      linkedin: (p.links && p.links.profile) || p.u || '', previous: (p.pv || []).map(v => ({title: v.p || '', company: v.c || '', until: v.until || ''})),
      lastMessage: p.rx && p.rx.t ? {date: p.rx.t, from: p.rx.dir === 'o' ? 'you' : 'them', count: p.rx.m || 0, text: p.rx.s ? String(p.rx.s).slice(0, 300) : ''} : null,
      waitingOnYou: !!(p.waiting || (m && m.waiting)), starred: !!ed.star, followUp: ed.due || '', circle: ed.circle || '', tags: ed.tags || [],
      notes: ed.note || '', summary: (m && m.line) || ''};
    const t = [`${out.name}${out.title || out.company ? ', ' + [out.title, out.company].filter(Boolean).join(' at ') : ''}`];
    if (out.agency && out.agency !== out.company) t.push(`Organization: ${out.agency}`);
    if (out.branch || out.rank) t.push(`Service: ${[out.rank, out.branch, out.status].filter(Boolean).join(', ')}`);
    t.push(`Closeness: ${out.closeness}${out.connected ? `. Connected ${nice(out.connected)}` : ''}.`);
    if (out.previous.length) t.push(`Before: ${out.previous.slice(0, 3).map(v => [v.title, v.company].filter(Boolean).join(' at ')).join('; ')}`);
    if (out.lastMessage) t.push(`Last message: ${nice(out.lastMessage.date)}, from ${out.lastMessage.from}${out.lastMessage.text ? `: “${out.lastMessage.text}”` : ''}`);
    if (out.waitingOnYou) t.push('They’re waiting on your reply.');
    if (out.followUp) t.push(`Follow up: ${nice(out.followUp)}`);
    if (out.starred) t.push('Starred.');
    if (out.tags.length) t.push(`Tags: ${out.tags.join(', ')}`);
    if (out.email) t.push(`Email: ${out.email}`);
    if (out.linkedin) t.push(`LinkedIn: ${out.linkedin}`);
    if (out.notes) t.push(`Your notes:\n${out.notes}`);
    else if (out.summary) t.push(out.summary);
    return {text: t.join('\n'), data: out};
  },
  ways_in({company_or_agency}){
    const q = String(company_or_agency || '').trim();
    if (q.length < 2) throw new Error('Name a company or agency.');
    const w = call('introPaths', q);
    const best = w.best.map(b => brief(b.k, b.why)).filter(Boolean);
    const now = w.now.slice(0, 15).map(k => brief(k)).filter(Boolean);
    const alumni = w.alumni.slice(0, 10).map(a => brief(a.k, `used to be there${a.was ? ' as ' + a.was : ''}`)).filter(Boolean);
    const team = (w.team || []).slice(0, 10).map(x => ({teammate: x.owner, name: x.name, title: x.p || '', company: x.c || '', closeness: BAND[x.b || 'none']}));
    const data = {company: w.company, industry: w.ind, best, worksThereNow: {count: w.now.length, people: now}, usedToWorkThere: {count: w.alumni.length, people: alumni}, teammates: team};
    if (!best.length && !team.length) return {text: `No clear way into ${q} yet. No one you know works there or used to. Try a parent organization, or ask your team.`, data};
    const t = [`Your best ways into ${w.company}:`, ...best.map(line)];
    t.push(`You know ${n(w.now.length)} ${w.now.length === 1 ? 'person' : 'people'} there now and ${n(w.alumni.length)} who used to work there.`);
    if (team.length) t.push(`Through your team:`, ...team.slice(0, 5).map(x => `- ${x.name} (${[x.title, x.company].filter(Boolean).join(', ')}), ${x.closeness} with ${x.teammate}`));
    return {text: t.join('\n'), data};
  },
  waiting_on_me(){
    const a = call('ask', 'who is waiting on my reply');
    const people = a.people.map(x => brief(x.k, x.why)).filter(Boolean);
    return {text: people.length ? listText(a.answer, people) : a.answer, data: {count: people.length, people}};
  },
  weekly_five(){
    const w = call('weekly', []);
    const people = w.map(x => Object.assign(brief(x.k, x.why) || {}, {reason: x.kind})).filter(x => x.key);
    return {text: people.length ? listText('This week’s five:', people) : 'Nothing pressing this week. A quiet week is a good time to check in with someone you haven’t talked to in a while.', data: {people}};
  },
  who_changed_jobs({days}){
    const d = Math.min(730, Math.max(1, +days || 90));
    const since = new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
    const rs = [...state.people.values()].filter(p => !p.x && p.jc && p.jc >= since).sort((a, b) => b.jc.localeCompare(a.jc));
    const people = rs.slice(0, 40).map(p => { const was = (p.pv || [])[0]; return Object.assign(brief(p.k, `now ${roleLine(p) || 'in a new role'}${was ? `, was ${[was.p, was.c].filter(Boolean).join(' at ')}` : ''} (${nice(p.jc)})`), {changed: p.jc}); });
    const head = `${n(rs.length)} ${rs.length === 1 ? 'person' : 'people'} changed jobs in the last ${d} days${rs.length > 40 ? ' (latest 40 shown)' : ''}.`;
    return {text: people.length ? [head, ...people.map(b => `- ${b.name}: ${b.why}`)].join('\n') : `No job changes in the last ${d} days. Northfix spots them when you refresh your LinkedIn data in the app.`, data: {days: d, count: rs.length, people}};
  },
  agency_coverage({filter}){
    const c = call('agencyCoverage', false);
    const f = String(filter || '').trim().toLowerCase();
    let rows = c.rows;
    if (f) rows = rows.filter(r => r.dept.toLowerCase().includes(f) || r.name.toLowerCase().includes(f) || (r.short || '').toLowerCase() === f || (r.short || '').toLowerCase().includes(f));
    const row = r => ({agency: r.name, short: r.short, department: r.dept, status: r.status, known: r.known, senior: r.senior, warm: r.warm, gap: r.gap, watched: r.watched,
      best: r.best.map(k => brief(k)).filter(Boolean)});
    if (f){
      if (!rows.length) return {text: `No federal agency or department matches “${filter}”.`, data: {filter, agencies: []}};
      const out = rows.slice(0, 40).map(row);
      const t = [`${out.length} ${out.length === 1 ? 'agency' : 'agencies'} matching “${filter}”:`, ...out.map(r => `- ${r.short || r.agency}: ${r.status === 'none' ? 'no one yet' : `${r.status}, ${r.known} known (${r.senior} senior, ${r.warm} warm)`}${r.gap && r.status !== 'none' ? `. ${r.gap}` : ''}${r.best.length ? `. Best: ${r.best.map(b => b.name).join(', ')}` : ''}`)];
      return {text: t.join('\n'), data: {filter, agencies: out}};
    }
    const T = c.totals;
    const t = [`Federal map: ${T.covered} of ${T.agencies} agencies covered, ${T.thin} thin, ${T.none} with no one yet.`, 'By department:',
      ...c.depts.filter(d => d.covered || d.thin).map(d => `- ${d.name}: ${d.covered} covered, ${d.thin} thin, ${d.none} none (of ${d.agencies})`)];
    const watched = c.rows.filter(r => r.watched).map(row);
    if (watched.length) t.push('On your watchlist:', ...watched.map(r => `- ${r.short || r.agency}: ${r.status}${r.gap ? ` (${lower(r.gap)})` : ''}`));
    const thin = c.rows.filter(r => r.status === 'thin').sort((a, b) => b.known - a.known).slice(0, 8).map(row);
    if (thin.length) t.push('Thin, worth strengthening:', ...thin.map(r => `- ${r.short || r.agency}: ${r.known} known. ${r.gap}`));
    return {text: t.join('\n'), data: {totals: T, departments: c.depts, watched, thin}};
  },
  pursuits(){
    const ps = call('pursuits');
    const out = ps.map(p => ({id: p.id, name: p.name, agency: p.agency, stage: p.stage, due: p.due, daysLeft: p.days, value: p.value, seatsFilled: p.filled, seats: p.roles, peopleKnown: p.people, warm: p.warm}));
    if (!out.length) return {text: 'No pursuits yet. Add one in Northfix (Pursuits) to track a bid and its decision-makers.', data: {pursuits: []}};
    return {text: [`${out.length} ${out.length === 1 ? 'pursuit' : 'pursuits'}:`, ...out.map(p => `- ${p.name}${p.agency ? ` (${p.agency})` : ''}: ${p.stage}${p.due ? `, due ${nice(p.due)}` : ''}${p.value ? `, ${p.value}` : ''}. ${p.seatsFilled} of ${p.seats} seats filled.`)].join('\n'), data: {pursuits: out}};
  },
  pursuit({name}){
    const pick = pickPursuit(name);
    if (pick.answer) return pick.answer;
    const p = call('pursuit', pick.id);
    const seats = p.roleList.map(r => ({role: r.role, side: r.side, people: r.people.map(x => brief(x.k)).filter(Boolean), suggestions: r.suggest.map(x => brief(x.k)).filter(Boolean),
      companies: r.companies || [], owner: r.owner || '', cold: !!r.cold}));
    const best = (p.best || []).map(b => brief(b.k, b.why)).filter(Boolean);
    const data = {name: p.name, agency: p.agency, stage: p.stage, due: p.due, daysLeft: p.days, value: p.value, winChance: p.pwin, incumbent: p.incumbent || '', partners: p.partners || [],
      note: p.note || '', knownAtAgency: p.known, seats, bestWaysIn: best};
    const t = [`${p.name}${p.agency ? ` at ${p.agency}` : ''}: ${p.stage}${p.due ? `, due ${nice(p.due)}${p.days != null ? ` (${p.days >= 0 ? p.days + ' days left' : -p.days + ' days ago'})` : ''}` : ''}${p.value ? `, ${p.value}` : ''}.`,
      `Seats filled: ${p.filled} of ${p.roles}. You know ${n(p.known)} ${p.known === 1 ? 'person' : 'people'} at ${p.agency || 'the agency'}.`];
    t.push(`Win chance: ${p.pwin}%.${data.incumbent ? ` Incumbent: ${data.incumbent}.` : ''}${data.partners.length ? ` Teaming partners: ${data.partners.join(', ')}.` : ''}`);
    for (const s of seats) t.push(`- ${s.role}: ${s.people.length ? s.people.map(b => b.name + (b.title ? ` (${b.title})` : '')).join(', ') + (s.cold ? ' (going cold)' : '') : s.suggestions.length ? `empty. Could be ${s.suggestions.map(b => b.name + (b.title ? ` (${b.title})` : '')).join(', ')}` : 'empty'}${s.owner ? `. Owner: ${s.owner}` : ''}`);
    if (best.length) t.push('Warmest ways in:', ...best.map(line));
    if (data.note) t.push(`Your note: ${data.note}`);
    return {text: t.join('\n'), data};
  },
  pipeline({include_team}){
    const pl = call('pipeline', !!include_team);
    const data = {open: pl.open, won: pl.won, lost: pl.lost, winRate: pl.winRate, dueThisQuarter: pl.dueThisQuarter,
      stages: pl.stages.map(x => ({stage: x.stage, count: x.count, value: x.value, weighted: x.weighted})), unpriced: pl.unpriced, includesTeam: pl.withTeam,
      pursuits: pl.rows.map(r => ({name: r.name, owner: r.owner, agency: r.agency, stage: r.stage, due: r.due, value: r.value, winChance: r.pwin, weighted: r.weighted}))};
    if (!pl.rows.length) return {text: 'No pursuits yet. Add one in Northfix (Pursuits) to build a pipeline.', data};
    const t = [`Open pipeline: ${pl.open.count} ${pl.open.count === 1 ? 'pursuit' : 'pursuits'}, ${pl.open.valueText} (${pl.open.weightedText} weighted by win chance).`,
      ...pl.stages.filter(x => x.count && x.stage !== 'Won' && x.stage !== 'Lost').map(x => `- ${x.stage}: ${x.count}, ${x.valueText} (${x.weightedText} weighted)`),
      `Due in the next 90 days: ${pl.dueThisQuarter.count}, ${pl.dueThisQuarter.weightedText} weighted.`,
      `Won ${pl.won.count} (${pl.won.valueText}), lost ${pl.lost.count} (${pl.lost.valueText})${pl.winRate != null ? `. Win rate ${pl.winRate}%` : ''}.`];
    if (pl.unpriced) t.push(`${pl.unpriced} ${pl.unpriced === 1 ? 'pursuit has' : 'pursuits have'} no value set, so ${pl.unpriced === 1 ? 'it isn’t' : 'they aren’t'} counted.`);
    return {text: t.join('\n'), data};
  },
  cold_seats(){
    const cs = call('coldSeats');
    const data = {count: cs.length, seats: cs.map(c => Object.assign(brief(c.k) || {name: c.name}, {pursuit: c.pursuit, seat: c.role, dueInDays: c.daysLeft, daysSinceContact: c.days}))};
    if (!cs.length) return {text: 'No cold seats. Everyone seated on an open pursuit due soon has heard from the user in the last 60 days.', data};
    return {text: [`${cs.length} ${cs.length === 1 ? 'seat is' : 'seats are'} going cold:`, ...cs.map(c => `- ${c.name}, ${c.role.toLowerCase()} on ${c.pursuit}${c.daysLeft != null ? ` (due in ${c.daysLeft} days)` : ''}: ${c.days == null ? 'never in touch' : 'last in touch ' + c.days + ' days ago'}`)].join('\n'), data};
  },
  call_plan({name_or_key, pursuit}){
    const f = findPerson(name_or_key);
    if (!f.k){
      if (!f.choices.length) return {text: `No one called “${name_or_key}” in your network.`, data: {found: false, choices: []}};
      return {text: listText(`Several people match “${name_or_key}”. Which one?`, f.choices), data: {found: false, choices: f.choices}};
    }
    let pid = null;
    if (pursuit){ const q = String(pursuit).toLowerCase(); const hit = call('pursuits').find(p => p.id === pursuit || p.name.toLowerCase().includes(q)); if (hit) pid = hit.id; }
    const cp = call('callPlan', f.k, pid);
    return {text: [`Call plan for ${cp.name}${cp.pursuit ? ` (${cp.pursuit}${cp.seat ? ', ' + cp.seat.toLowerCase() : ''})` : ''}:`, cp.plan, '', 'Facts:', ...cp.facts.map(x => `- ${x}`)].join('\n'),
      data: {name: cp.name, pursuit: cp.pursuit, seat: cp.seat, facts: cp.facts, plan: cp.plan}};
  },
  async recompetes({agencies, months}){
    const m = Math.min(36, Math.max(3, +months || 24));
    const pages = await fetchAwards(Array.isArray(agencies) ? agencies : [], m);
    const rc = call('recompetes', pages.ok, {months: m, limit: 25});
    const items = rc.items.map(x => ({title: x.title, agency: x.agency, office: x.office, incumbent: x.incumbent, value: x.amountText, ends: x.end, daysLeft: x.days,
      knownAtAgency: x.known, knownAtIncumbent: x.incumbentKnown, people: x.people.map(p => brief(p.k)).filter(Boolean), incumbentPeople: x.incumbentPeople.map(p => brief(p.k)).filter(Boolean), link: x.link}));
    const data = {months: m, count: rc.total, value: rc.valueText, recompetes: items, agencies: pages.asked, errors: pages.errors};
    if (!pages.asked.length) return {text: 'Name an agency, or add agencies to the watchlist or pursuits in Northfix first.', data};
    if (!items.length) return {text: `No contracts ending in the next ${m} months at ${pages.asked.join(', ')}${pages.errors.length ? `. ${pages.errors[0]}` : ''}.`, data};
    return {text: [`${rc.total} ${rc.total === 1 ? 'contract ends' : 'contracts end'} in the next ${m} months at ${pages.asked.join(', ')} (${rc.valueText} in all). Top ${items.length}:`,
      ...items.map(x => `- ${x.title} (${x.agency}): ${x.incumbent || 'unknown incumbent'}, ${x.value}, ends ${nice(x.ends)}. You know ${x.knownAtAgency} at ${x.agency} and ${x.knownAtIncumbent} at the incumbent.`),
      ...(pages.errors.length ? [pages.errors[0]] : []), 'Source: USASpending.gov.'].join('\n'), data};
  },
  async teaming_partners({agency}){
    const a = String(agency || '').trim();
    if (a.length < 2) throw new Error('Name an agency or command.');
    const pages = await fetchAwards([a], 24);
    const tp = call('teamingPartners', pages.ok, {agency: a, limit: 20});
    const items = tp.items.map(x => ({company: x.name, awards: x.awards, value: x.amountText, endingThisYear: x.ending, known: x.known, warm: x.warm,
      people: x.people.map(p => brief(p.k)).filter(Boolean), teammates: x.team.map(t => ({teammate: t.owner, name: t.name, title: t.p, closeness: BAND[t.b || 'none']}))}));
    const data = {agency: tp.agency, partners: items, errors: pages.errors};
    if (!tp.agency) return {text: `“${a}” isn’t on the federal map. Try its short name, like DISA or NAVFAC.`, data};
    if (!items.length) return {text: `No contract data came back for ${tp.agency.short}${pages.errors.length ? `. ${pages.errors[0]}` : ''}.`, data};
    return {text: [`Companies winning at ${tp.agency.short}, with who you know:`, ...items.map(x => `- ${x.company}: ${x.awards} ${x.awards === 1 ? 'award' : 'awards'}, ${x.value}. ${x.known ? `You know ${x.known}${x.people[0] ? ', like ' + x.people[0].name : ''}` : x.teammates.length ? `${x.teammates[0].teammate} knows ${x.teammates[0].name}` : 'No one yet'}.`),
      'Source: USASpending.gov.'].join('\n'), data};
  },
  log_note({name_or_key, note}){
    const text = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 480);
    if (!text) throw new Error('Say what the note should say.');
    const f = findPerson(name_or_key);
    if (!f.k){
      if (!f.choices.length) return {text: `No one called “${name_or_key}” in your network. Nothing saved.`, data: {saved: false, choices: []}};
      return {text: listText(`Several people match “${name_or_key}”. Which one? Nothing saved yet.`, f.choices), data: {saved: false, choices: f.choices}};
    }
    const list = appendInbox({k: f.k, text, at: new Date().toISOString()});
    const who = state.people.get(f.k);
    return {text: `Saved for ${who ? who.name : 'them'}. Northfix files the note the next time it opens on this Mac.`, data: {saved: true, key: f.k, pending: list.length}};
  },
  log_call({name_or_key, summary, follow_up_days, confirm}){
    const text = String(summary || '').replace(/\s+/g, ' ').trim().slice(0, 470);
    if (!text) throw new Error('Say what the call was about.');
    const f = findPerson(name_or_key);
    const miss = whoIs(f, name_or_key); if (miss) return miss;
    const who = state.people.get(f.k), name = who ? who.name : 'them';
    const days = +follow_up_days > 0 ? Math.min(365, Math.round(+follow_up_days)) : 0;
    const what = `Log a call with ${name}: “${text}”, mark them as contacted today${days ? `, and follow up in ${days} days` : ''}.`;
    if (confirm !== true) return preview(what, {key: f.k, summary: text, followUpDays: days || null});
    const list = appendInbox({kind: 'call', k: f.k, text, followUpDays: days || undefined, at: new Date().toISOString()});
    return {text: `Saved the call with ${name}. Northfix files it the next time it opens on this Mac.`, data: {saved: true, key: f.k, pending: list.length}};
  },
  update_pursuit_stage({pursuit, stage, confirm}){
    const STAGES = ['Tracking', 'Pursuing', 'Proposal', 'Submitted', 'Won', 'Lost'];
    const want = STAGES.find(x => x.toLowerCase() === String(stage || '').trim().toLowerCase());
    if (!want) throw new Error(`Pick a stage: ${STAGES.join(', ')}.`);
    const pick = pickPursuit(pursuit);
    if (pick.answer) return {text: pick.answer.text + ' Nothing saved.', data: Object.assign({saved: false}, pick.answer.data)};
    const p = call('pursuit', pick.id);
    if (p.stage === want) return {text: `${p.name} is already at ${want}. Nothing to change.`, data: {saved: false, pursuit: p.name, stage: want}};
    const what = `Move ${p.name} from ${p.stage} to ${want}.`;
    if (confirm !== true) return preview(what, {pursuit: p.name, from: p.stage, to: want});
    const list = appendInbox({kind: 'stage', pursuit: pick.id, name: p.name, stage: want, at: new Date().toISOString()});
    return {text: `Saved: ${p.name} moves to ${want} the next time Northfix opens on this Mac.`, data: {saved: true, pursuit: p.name, from: p.stage, to: want, pending: list.length}};
  },
  draft_follow_up({name_or_key, purpose, follow_up_on, confirm}){
    const f = findPerson(name_or_key);
    const miss = whoIs(f, name_or_key); if (miss) return miss;
    const cp = call('callPlan', f.k, null);
    const first = String(cp.name || '').replace(/^(?:[A-Z]{2,5}|[A-Z][a-z]{1,3}\.?)\s+(?=[A-Z])/, '').split(' ')[0] || 'there';
    const why = String(purpose || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const draft = [`Hi ${first},`, '', why ? `Following up on ${why.replace(/[.]$/, '')}.` : 'Following up on our last conversation.',
      cp.pursuit ? `I’d value your view on ${cp.pursuit} as it moves forward.` : 'I’d love to hear what you’re focused on over the next few months.',
      'Would a short call next week work?'].join('\n');
    const due = String(follow_up_on || '').trim();
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Give the follow-up date as YYYY-MM-DD.');
    const data = {key: f.k, name: cp.name, draft, facts: cp.facts, followUpOn: due || null};
    const head = `Draft for ${cp.name} (Northfix never sends it; copy it into your email or LinkedIn):\n\n${draft}\n\nWhat it’s based on:\n${cp.facts.map(x => '- ' + x).join('\n')}`;
    if (!due) return {text: head, data: Object.assign({saved: false}, data)};
    if (confirm !== true) return {text: `${head}\n\nSave a follow-up with ${cp.name} on ${nice(due)}${why ? ` (“${why}”)` : ''}? Nothing is saved yet. If the user agrees, call again with confirm: true.`, data: Object.assign({saved: false, needsConfirm: true}, data)};
    const list = appendInbox({kind: 'followup', k: f.k, due, text: why ? `Follow-up drafted: ${why}` : '', at: new Date().toISOString()});
    return {text: `${head}\n\nSaved a follow-up on ${nice(due)}. Northfix files it the next time it opens on this Mac.`, data: Object.assign({saved: true, pending: list.length}, data)};
  },
  bid_decision({pursuit}){
    const pick = pickPursuit(pursuit);
    if (pick.answer) return pick.answer;
    const b = call('bidDecision', pick.id);
    const label = {yes: 'Yes', maybe: 'Maybe', no: 'No'};
    const data = {pursuit: b.name, recommendation: b.call, reason: b.why, score: b.score, answered: b.answered,
      questions: b.questions.map(q => ({question: q.text, answer: q.answer || 'not answered', from: q.mine ? 'user' : q.suggested ? 'Northfix suggestion' : '', why: q.why}))};
    const t = [`${b.name}: ${b.call}${b.score != null ? ` (${b.score} of 100)` : ''}. ${b.why}`,
      ...b.questions.map(q => `- ${q.text} ${q.answer ? label[q.answer] : 'Not answered'}${q.mine ? '' : q.suggested ? ` (suggested: ${q.why})` : ''}`),
      'The user can change any answer on the pursuit in Northfix.'];
    return {text: t.join('\n'), data};
  },
  capture_digest(){
    const d = call('captureDigest', {});
    return {text: d.text, data: {date: d.date, summary: d.head, sections: d.sections}};
  },
  network_summary(){
    const info = call('info'), pay = call('payoff'), h = call('home', {});
    const stat = id => (h.stats.find(s => s.id === id) || {}).value || 0;
    const targets = call('targets').map(t => ({name: t.name, known: t.count, coverage: t.score, gap: t.gap}));
    const data = {people: info.count, companies: pay.companies, executives: pay.execs, directors: pay.dirs, industries: pay.industries,
      topIndustries: pay.top.map(([name, count]) => ({name, count})), waitingOnYou: stat('wait'), changedJobs: stat('jc'), starred: stat('star'), followUpsDue: stat('due'),
      lastRefresh: info.lastImport || '', watchlist: targets, federalLens: !!info.lens};
    const t = [`${n(data.people)} people across ${n(data.companies)} companies and ${n(data.industries)} industries. ${n(data.executives)} executives and ${n(data.directors)} directors.`,
      `Biggest industries: ${data.topIndustries.slice(0, 5).map(i => `${i.name} (${n(i.count)})`).join(', ')}.`,
      `Waiting on your reply: ${n(data.waitingOnYou)}. Changed jobs: ${n(data.changedJobs)}. Follow-ups due: ${n(data.followUpsDue)}. Starred: ${n(data.starred)}.`];
    if (targets.length) t.push(`Watchlist: ${targets.map(x => `${x.name} (${x.known} known${x.gap && x.gap !== 'Covered at every level' ? ', ' + lower(x.gap) : ''})`).join('; ')}.`);
    if (data.lastRefresh) t.push(`LinkedIn data last refreshed ${nice(data.lastRefresh)}.`);
    return {text: t.join('\n'), data};
  },
};

export async function runTool(name, args){
  if (!handlers[name]) return {isError: true, content: [{type: 'text', text: `Unknown tool ${name}.`}]};
  const problem = ensureLoaded();
  if (problem) return {isError: true, content: [{type: 'text', text: problem}], structuredContent: {ok: false, reason: problem}};
  if (!FREE_TOOLS.has(name) && !isPro()){
    if (usage().used >= FREE_DAILY) return {content: [{type: 'text', text: LIMIT_TEXT}], structuredContent: {ok: false, reason: 'free_limit', freeDaily: FREE_DAILY}};
  }
  try {
    const r = await handlers[name](args || {});
    let text = r.text;
    if (!FREE_TOOLS.has(name) && !isPro()){
      const used = spend(), left = Math.max(0, FREE_DAILY - used);
      text += `\n\n(Northfix free plan: ${left} of ${FREE_DAILY} questions left today. Northfix Pro has no limit.)`;
    }
    return {content: [{type: 'text', text}], structuredContent: Object.assign({ok: true}, r.data)};
  } catch (e) {
    return {isError: true, content: [{type: 'text', text: e.message || String(e)}]};
  }
}

/* ---------- MCP over stdio ---------- */
const INSTRUCTIONS = 'Northfix answers questions about the user’s own professional network (their LinkedIn connections, with their notes, messages and follow-ups), from files on this Mac. Use it for who they know at a company or agency, warm intro paths, who is waiting on a reply, recent job changes, federal coverage, pursuits and the pipeline, call plans, and recompetes and teaming partners from USASpending.gov public contract data. Everything is read-only except log_note, which saves a note only when the user asks. Nothing about the user’s network is sent anywhere; recompetes and teaming partners send only agency names to USASpending.gov.';
function reply(id, result){ send({jsonrpc: '2.0', id, result}); }
function fail(id, code, message){ send({jsonrpc: '2.0', id, error: {code, message}}); }
function send(o){ process.stdout.write(JSON.stringify(o) + '\n'); }

/** Tool calls still running, so stdin closing doesn't cut their replies off. */
const pending = new Set();

export function handle(msg){
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string'){
    if (msg && msg.id != null && !('result' in msg) && !('error' in msg)) fail(msg.id, -32600, 'Invalid request');
    return;
  }
  const {id, method, params} = msg;
  const isNote = id === undefined || id === null;
  if (isNote) return; // notifications/initialized, notifications/cancelled and friends need no answer
  switch (method){
    case 'initialize': {
      const asked = params && params.protocolVersion;
      return reply(id, {protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: {tools: {listChanged: false}},
        serverInfo: {name: 'northfix', title: 'Northfix', version: VERSION}, instructions: INSTRUCTIONS});
    }
    case 'ping': return reply(id, {});
    case 'tools/list': return reply(id, {tools: TOOLS});
    case 'tools/call': {
      const name = params && params.name;
      if (!handlers[name]) return fail(id, -32602, `Unknown tool: ${name}`);
      { const job = runTool(name, params.arguments).then(r => reply(id, r), e => fail(id, -32603, (e && e.message) || 'Internal error')).finally(() => pending.delete(job));
        pending.add(job); return job; }
    }
    case 'resources/list': return reply(id, {resources: []});
    case 'resources/templates/list': return reply(id, {resourceTemplates: []});
    case 'prompts/list': return reply(id, {prompts: []});
    default: return fail(id, -32601, `Method not found: ${method}`);
  }
}

function serve(){
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0){
      const lineText = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!lineText) continue;
      let msg;
      try { msg = JSON.parse(lineText); } catch { send({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'Parse error'}}); continue; }
      try { (Array.isArray(msg) ? msg : [msg]).forEach(handle); } catch (e) { if (msg && msg.id != null) fail(msg.id, -32603, e.message || 'Internal error'); }
    }
  });
  // let replies still being worked out (a USASpending fetch) and large ones finish writing first
  process.stdin.on('end', () => { const done = () => process.stdout.write('', () => process.exit(0)); pending.size ? Promise.allSettled([...pending]).then(done) : done(); });
  const f = findData();
  process.stderr.write(`Northfix MCP ${VERSION}: ${f.problem ? 'no network found yet (' + f.dir + ')' : 'reading ' + f.dir}\n`);
}

// Run as a program (node server.mjs, or the bundled northfix-mcp.mjs), not when imported by a test.
const entry = process.argv[1] && path.resolve(process.argv[1]);
const self = fileURLToPath(import.meta.url);
if (entry && (entry === self || fs.realpathSync(entry) === fs.realpathSync(self))) serve();
