CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claim_types (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value_type TEXT NOT NULL,
  sensitivity_level TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  claim_type_id TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  status TEXT NOT NULL CHECK (
    status IN ('asserted', 'extracted', 'confirmed', 'verified', 'expired', 'revoked', 'superseded')
  ),
  confidence REAL,
  issuer TEXT,
  observed_at TEXT,
  expires_at TEXT,
  superseded_by_claim_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE,
  FOREIGN KEY (claim_type_id) REFERENCES claim_types(id) ON DELETE RESTRICT,
  FOREIGN KEY (superseded_by_claim_id) REFERENCES claims(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_claims_person_status ON claims(person_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_claims_claim_type ON claims(claim_type_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  storage_uri TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  sha256 TEXT,
  source_system TEXT,
  source_name TEXT,
  captured_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_evidence_person_kind ON evidence(person_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS claim_evidence_links (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (
    relation_type IN ('extracted_from', 'confirmed_by', 'derived_from', 'contradicted_by')
  ),
  note TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
  FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE,
  UNIQUE (claim_id, evidence_id, relation_type)
);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  document_number TEXT,
  issuing_country TEXT,
  issued_at TEXT,
  expires_at TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS requesters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  origin TEXT,
  public_key_or_identifier TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_requesters_identifier ON requesters(public_key_or_identifier);

CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('proposed', 'active', 'expired', 'revoked', 'denied')
  ),
  service_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(service_json)),
  scope_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(scope_json)),
  actions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(actions_json)),
  policy_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(policy_json)),
  granted_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE,
  FOREIGN KEY (requester_id) REFERENCES requesters(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_grants_person_status ON grants(person_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS grant_claims (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  access_mode TEXT NOT NULL CHECK (access_mode IN ('read', 'autofill', 'verify_only')),
  FOREIGN KEY (grant_id) REFERENCES grants(id) ON DELETE CASCADE,
  FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
  UNIQUE (grant_id, claim_id, access_mode)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  person_id TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'agent', 'requester')),
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload_json TEXT NOT NULL CHECK (json_valid(event_payload_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_person_created ON audit_events(person_id, created_at DESC);

CREATE TABLE IF NOT EXISTS timeline_entries (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail_md TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_timeline_person_date ON timeline_entries(person_id, event_date DESC);
