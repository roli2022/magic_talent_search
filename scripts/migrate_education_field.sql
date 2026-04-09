-- Add education column to candidates table
-- Run in Supabase SQL Editor before running the education backfill script

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS education jsonb;

-- Index for filtering by education data
CREATE INDEX IF NOT EXISTS idx_candidates_education ON candidates USING gin (education);
