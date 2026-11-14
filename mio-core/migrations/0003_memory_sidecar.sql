CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('evidence_snippet', 'execution_observation', 'review_rationale')
  ),
  field_key TEXT,
  service_key TEXT,
  session_or_bundle_id TEXT,
  title TEXT NOT NULL,
  snippet_text TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL DEFAULT '',
  source_kind TEXT NOT NULL DEFAULT '',
  source_ref TEXT NOT NULL DEFAULT '',
  source_locator TEXT NOT NULL DEFAULT '',
  confidence REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_items_person_created
  ON memory_items(person_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_items_person_field
  ON memory_items(person_id, field_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_items_person_kind
  ON memory_items(person_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_items_person_session
  ON memory_items(person_id, session_or_bundle_id, created_at DESC);
