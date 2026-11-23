CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','CORRETOR')),
  password_hash TEXT,
  state TEXT NOT NULL CHECK(state IN ('INVITED','ACTIVE','SUSPENDED')),
  mfa_secret TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  mfa_last_counter INTEGER NOT NULL DEFAULT -1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS only_one_admin ON auth_users(role) WHERE role='ADMIN';
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_users(id),
  mfa_verified INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON auth_sessions(user_id);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_users(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('INVITE','RESET')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON auth_tokens(user_id,purpose);
