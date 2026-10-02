// Writes a watch snapshot of the sample network, for CI screenshots of the watch app.
import fs from 'node:fs';
new Function(fs.readFileSync('apple/Bearings/Resources/engine.js', 'utf8'))();
const call = (n, ...a) => JSON.parse(globalThis.Bearings.call(n, JSON.stringify(a))).ok;
call('loadSample');
const snap = call('watch', 'Jay');
// give a couple of people follow-ups due today so every list has something in it
snap.people.slice(0, 2).forEach(p => { p.due = snap.today; p.f += 'd'; });
fs.writeFileSync(process.argv[2] || 'watch-sample.json', JSON.stringify(snap));
console.log('watch sample', snap.people.length);
