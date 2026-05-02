-- Add platform column to rules and events tables
-- Existing rows default to 'instagram' to preserve all current data.

ALTER TABLE dmflow.rules
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'instagram';

ALTER TABLE dmflow.events
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'instagram';

-- Optional: add index for platform-scoped rule queries
CREATE INDEX IF NOT EXISTS idx_rules_platform ON dmflow.rules (platform);
CREATE INDEX IF NOT EXISTS idx_events_platform ON dmflow.events (platform);
