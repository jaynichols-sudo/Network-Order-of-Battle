-- Northfix Team: D1 schema. Safe to run again (every statement is IF NOT EXISTS).
-- Encrypted fields (*_enc, shares.body) hold base64 ciphertext from the apps.
-- The server never decrypts them. Times are milliseconds since 1970.

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name_enc TEXT NOT NULL,
  created INTEGER NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial', 'active', 'past_due', 'canceled')),
  seats INTEGER NOT NULL DEFAULT 5,
  trial_ends INTEGER NOT NULL,
  stripe_customer TEXT,
  stripe_sub TEXT
);
CREATE INDEX IF NOT EXISTS teams_stripe_sub ON teams (stripe_sub);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  token_hash TEXT NOT NULL UNIQUE,
  profile_enc TEXT NOT NULL,
  joined INTEGER NOT NULL,
  seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS members_team ON members (team_id);

CREATE TABLE IF NOT EXISTS shares (
  member_id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  body TEXT NOT NULL,
  size INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shares_team ON shares (team_id);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  uses_left INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS invites_team ON invites (team_id);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT
);
CREATE INDEX IF NOT EXISTS events_team_at ON events (team_id, at);
