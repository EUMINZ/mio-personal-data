CREATE TABLE IF NOT EXISTS review_bundles (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  source_bundle_id TEXT,
  source_system TEXT NOT NULL,
  producer TEXT,
  stage_key TEXT,
  stage_label TEXT,
  source_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_json)),
  summary_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(summary_json)),
  requested_fields_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(requested_fields_json)),
  injected_fields_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(injected_fields_json)),
  page_profile_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(page_profile_json)),
  trip_record_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(trip_record_json)),
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'partially_applied', 'applied', 'dismissed', 'archived')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_review_bundles_source_bundle
  ON review_bundles(source_bundle_id)
  WHERE source_bundle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_review_bundles_person_status
  ON review_bundles(person_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS review_items (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (
    item_type IN ('page_profile', 'observation', 'proposal', 'trip_record')
  ),
  field_key TEXT NOT NULL,
  target TEXT NOT NULL CHECK (
    target IN ('identity_claim', 'service_context', 'bundle_context', 'trip_context')
  ),
  suggested_value_json TEXT NOT NULL CHECK (json_valid(suggested_value_json)),
  current_value_json TEXT CHECK (
    current_value_json IS NULL OR json_valid(current_value_json)
  ),
  rationale TEXT NOT NULL DEFAULT '',
  source_document_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_document_ids_json)),
  supporting_evidence_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(supporting_evidence_ids_json)),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'applied', 'dismissed', 'superseded')
  ),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by_actor_type TEXT CHECK (
    resolved_by_actor_type IS NULL OR resolved_by_actor_type IN ('user', 'system', 'agent', 'requester')
  ),
  resolved_by_actor_id TEXT,
  resolution_note TEXT NOT NULL DEFAULT '',
  applied_claim_id TEXT,
  FOREIGN KEY (bundle_id) REFERENCES review_bundles(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE,
  FOREIGN KEY (applied_claim_id) REFERENCES claims(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_review_items_bundle_status
  ON review_items(bundle_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_review_items_person_status
  ON review_items(person_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS review_decisions (
  id TEXT PRIMARY KEY,
  review_item_id TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  person_id TEXT,
  decision TEXT NOT NULL CHECK (
    decision IN ('accepted', 'dismissed', 'superseded')
  ),
  actor_type TEXT NOT NULL CHECK (
    actor_type IN ('user', 'system', 'agent', 'requester')
  ),
  actor_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  applied_claim_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (review_item_id) REFERENCES review_items(id) ON DELETE CASCADE,
  FOREIGN KEY (bundle_id) REFERENCES review_bundles(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE SET NULL,
  FOREIGN KEY (applied_claim_id) REFERENCES claims(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_review_decisions_item_created
  ON review_decisions(review_item_id, created_at DESC);
