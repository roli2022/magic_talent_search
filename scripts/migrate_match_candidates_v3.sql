-- Update match_candidates to return enriched fields alongside base fields
-- Run in Supabase SQL Editor

CREATE OR REPLACE FUNCTION match_candidates(
  query_embedding vector(1024),
  match_count int DEFAULT 200
)
RETURNS TABLE (
  uid            text,
  url            text,
  image_url      text,
  name           text,
  headline       text,
  summary        text,
  location       text,
  skills         text[],
  top_experience jsonb,
  similarity     float,
  -- enriched fields
  enriched_at          timestamptz,
  years_experience     integer,
  seniority            text,
  avg_tenure_years     numeric,
  job_switches         integer,
  mobility_likelihood  text,
  likely_open_to_move  boolean,
  manages_people       boolean,
  team_size_managed    text,
  top_school           boolean,
  school_tier          text,
  has_mba              boolean,
  is_founder           boolean,
  has_0_to_1_exp       boolean,
  has_scale_exp        boolean,
  builder_score        smallint,
  builder_evidence     text,
  ownership_score      smallint,
  is_outlier           boolean,
  outlier_reason       text,
  primary_function     text,
  location_city        text
)
LANGUAGE sql
AS $$
  SELECT
    uid, url, image_url, name, headline, summary, location,
    skills, top_experience,
    1 - (embedding <=> query_embedding) AS similarity,
    enriched_at, years_experience, seniority, avg_tenure_years,
    job_switches, mobility_likelihood, likely_open_to_move,
    manages_people, team_size_managed, top_school, school_tier,
    has_mba, is_founder, has_0_to_1_exp, has_scale_exp,
    builder_score, builder_evidence, ownership_score,
    is_outlier, outlier_reason, primary_function, location_city
  FROM candidates
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
