CREATE TABLE IF NOT EXISTS wiki_entries (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'identity',
  field_key TEXT NOT NULL DEFAULT '',
  value_text TEXT NOT NULL DEFAULT '',
  summary_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (
    status IN ('candidate', 'verified', 'stale', 'rejected', 'superseded')
  ),
  trust_level TEXT NOT NULL CHECK (
    trust_level IN (
      'nfc',
      'mrz',
      'official_doc',
      'user_asserted',
      'model_inferred',
      'reviewed_merge'
    )
  ),
  autofill_eligible INTEGER NOT NULL DEFAULT 0 CHECK (autofill_eligible IN (0, 1)),
  source_kind TEXT NOT NULL DEFAULT '',
  source_ref TEXT NOT NULL DEFAULT '',
  source_locator TEXT NOT NULL DEFAULT '',
  source_document_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_document_ids_json)),
  supporting_evidence_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(supporting_evidence_ids_json)),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  reviewed_at TEXT,
  superseded_by_entry_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE,
  FOREIGN KEY (superseded_by_entry_id) REFERENCES wiki_entries(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wiki_entries_person_updated
  ON wiki_entries(person_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wiki_entries_person_status
  ON wiki_entries(person_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wiki_entries_person_field
  ON wiki_entries(person_id, field_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS wiki_events (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN (
      'created',
      'updated',
      'status_changed',
      'merged_into_claim',
      'marked_stale',
      'linked_evidence'
    )
  ),
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE,
  FOREIGN KEY (entry_id) REFERENCES wiki_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wiki_events_entry_created
  ON wiki_events(entry_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wiki_events_person_created
  ON wiki_events(person_id, created_at DESC);
