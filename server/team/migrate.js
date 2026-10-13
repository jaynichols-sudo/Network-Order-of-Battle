// Brings an existing D1 database up to date with schema.sql. D1 applies schema.sql on every
// deploy, but SQLite can't add a column or widen a CHECK with IF NOT EXISTS, so changes to
// the teams table are made here, once per worker instance, before its first request.

// The teams table as schema.sql makes it. Keep the two the same (a test checks).
export const TEAMS_TABLE = `CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name_enc TEXT NOT NULL,
  created INTEGER NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial', 'active', 'past_due', 'canceled', 'team5')),
  seats INTEGER NOT NULL DEFAULT 5,
  trial_ends INTEGER NOT NULL,
  stripe_customer TEXT,
  stripe_sub TEXT,
  apple_transaction_id TEXT,
  apple_expires INTEGER
)`;
const TEAMS_COLUMNS = ['id', 'name_enc', 'created', 'plan', 'seats', 'trial_ends', 'stripe_customer', 'stripe_sub', 'apple_transaction_id', 'apple_expires'];

export async function migrate(db) {
  const row = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'teams'").first();
  if (!row) return; // schema.sql hasn't run yet; nothing to bring forward
  const haveTx = /apple_transaction_id/.test(row.sql), haveExpires = /apple_expires/.test(row.sql), haveTeam5 = /'team5'/.test(row.sql);
  // This index lives here rather than in schema.sql because, on an older database, schema.sql
  // runs at deploy before the column exists.
  const appleIndex = db.prepare('CREATE INDEX IF NOT EXISTS teams_apple_transaction ON teams (apple_transaction_id)');
  if (haveTx && haveExpires && haveTeam5) { await appleIndex.run(); return; }
  const steps = [];
  if (!haveTx) steps.push(db.prepare('ALTER TABLE teams ADD COLUMN apple_transaction_id TEXT'));
  if (!haveExpires) steps.push(db.prepare('ALTER TABLE teams ADD COLUMN apple_expires INTEGER'));
  if (!haveTeam5) {
    // Widening the CHECK means rebuilding the table, the way SQLite's docs describe.
    const cols = TEAMS_COLUMNS.join(', ');
    steps.push(
      db.prepare(TEAMS_TABLE.replace('CREATE TABLE IF NOT EXISTS teams', 'CREATE TABLE teams_next')),
      db.prepare(`INSERT INTO teams_next (${cols}) SELECT ${cols} FROM teams`),
      db.prepare('DROP TABLE teams'),
      db.prepare('ALTER TABLE teams_next RENAME TO teams'),
      db.prepare('CREATE INDEX IF NOT EXISTS teams_stripe_sub ON teams (stripe_sub)'),
    );
  }
  steps.push(appleIndex);
  await db.batch(steps);
  console.log('Migrated the teams table for the App Store plan.');
}
