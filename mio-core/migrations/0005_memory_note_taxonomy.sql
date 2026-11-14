CREATE TABLE IF NOT EXISTS memory_items_next (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('evidence_note', 'execution_note', 'review_rationale')
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

INSERT INTO memory_items_next (
  id,
  person_id,
  kind,
  field_key,
  service_key,
  session_or_bundle_id,
  title,
  snippet_text,
  rationale,
  source_kind,
  source_ref,
  source_locator,
  confidence,
  metadata_json,
  created_at
)
SELECT
  id,
  person_id,
  CASE kind
    WHEN 'evidence_snippet' THEN 'evidence_note'
    WHEN 'execution_observation' THEN 'execution_note'
    ELSE kind
  END,
  field_key,
  service_key,
  session_or_bundle_id,
  title,
  snippet_text,
  rationale,
  source_kind,
  source_ref,
  source_locator,
  confidence,
  metadata_json,
  created_at
FROM memory_items;

DROP TABLE memory_items;
ALTER TABLE memory_items_next RENAME TO memory_items;

CREATE INDEX IF NOT EXISTS idx_memory_items_person_created
  ON memory_items(person_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_items_person_field
  ON memory_items(person_id, field_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_items_person_kind
  ON memory_items(person_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_items_person_session
  ON memory_items(person_id, session_or_bundle_id, created_at DESC);
