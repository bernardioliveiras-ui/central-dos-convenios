PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  susep TEXT NOT NULL,
  profile TEXT NOT NULL CHECK(profile IN ('cpf','cnpj','ambos')),
  product TEXT NOT NULL CHECK(product IN ('saude','odontologico','pet','multiplos')),
  status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK(status IN ('PENDENTE','APROVADO','REPROVADO')),
  internal_reason TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  decision_id TEXT UNIQUE,
  invite_status TEXT NOT NULL DEFAULT 'NAO_APLICAVEL' CHECK(invite_status IN ('NAO_APLICAVEL','PENDENTE','ENVIADO','ERRO')),
  invite_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_applications_status_created ON applications(status,created_at);

CREATE TABLE IF NOT EXISTS staff_accounts (
  auth_user_id TEXT PRIMARY KEY NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('BKO','ADMIN')),
  label TEXT NOT NULL,
  suspended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS broker_profiles (
  auth_user_id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL UNIQUE REFERENCES applications(id),
  suspended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_auth_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_events(target_type,target_id,created_at);

CREATE TABLE IF NOT EXISTS request_limits (
  bucket_id TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
