-- Updated match_candidates RPC with enrichment field filters
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Backward compatible — all filter params default to NULL (= no filter applied).
-- When a filter IS specified, it applies only to enriched candidates (enriched_at IS NOT NULL).
-- Unenriched candidates are excluded when any filter is active.

CREATE OR REPLACE FUNCTION match_candidates(
  query_embedding        vector(1024),
  match_count            int     DEFAULT 200,

  -- Location filters
  filter_location_city   text    DEFAULT NULL,  -- e.g. 'Bangalore'
  filter_location_tier   text    DEFAULT NULL,  -- 'metro' | 'tier_2' | 'tier_3'

  -- Experience filters
  filter_min_years       int     DEFAULT NULL,
  filter_max_years       int     DEFAULT NULL,
  filter_seniority       text[]  DEFAULT NULL,  -- e.g. ARRAY['senior','lead','exec']

  -- Function & industry filters
  filter_function        text    DEFAULT NULL,  -- e.g. 'product'
  filter_industries      text[]  DEFAULT NULL,  -- e.g. ARRAY['fintech','SaaS']

  -- People & leadership filters
  filter_manages_people  boolean DEFAULT NULL,
  filter_is_ic_or_manager text   DEFAULT NULL,  -- 'ic' | 'manager' | 'both'

  -- Education filters
  filter_top_school      boolean DEFAULT NULL,
  filter_has_mba         boolean DEFAULT NULL,

  -- Mobility filters
  filter_likely_open_to_move boolean DEFAULT NULL,
  filter_mobility        text    DEFAULT NULL,  -- 'low' | 'medium' | 'high'

  -- Quality signal filters
  filter_is_outlier      boolean DEFAULT NULL,
  filter_min_builder_score int   DEFAULT NULL,  -- e.g. 7 = builder score >= 7
  filter_min_ownership_score int DEFAULT NULL,

  -- Startup / founder filters
  filter_is_founder      boolean DEFAULT NULL,
  filter_has_startup_exp boolean DEFAULT NULL,
  filter_has_0_to_1_exp  boolean DEFAULT NULL
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
  similarity     float
)
LANGUAGE plpgsql
AS $$
DECLARE
  any_filter_active boolean;
BEGIN
  -- Check if any filter is specified
  any_filter_active := (
    filter_location_city       IS NOT NULL OR
    filter_location_tier       IS NOT NULL OR
    filter_min_years           IS NOT NULL OR
    filter_max_years           IS NOT NULL OR
    filter_seniority           IS NOT NULL OR
    filter_function            IS NOT NULL OR
    filter_industries          IS NOT NULL OR
    filter_manages_people      IS NOT NULL OR
    filter_is_ic_or_manager    IS NOT NULL OR
    filter_top_school          IS NOT NULL OR
    filter_has_mba             IS NOT NULL OR
    filter_likely_open_to_move IS NOT NULL OR
    filter_mobility            IS NOT NULL OR
    filter_is_outlier          IS NOT NULL OR
    filter_min_builder_score   IS NOT NULL OR
    filter_min_ownership_score IS NOT NULL OR
    filter_is_founder          IS NOT NULL OR
    filter_has_startup_exp     IS NOT NULL OR
    filter_has_0_to_1_exp      IS NOT NULL
  );

  RETURN QUERY
  SELECT
    c.uid,
    c.url,
    c.image_url,
    c.name,
    c.headline,
    c.summary,
    c.location,
    c.skills,
    c.top_experience,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM candidates c
  WHERE
    -- When filters are active, restrict to enriched candidates only
    (NOT any_filter_active OR c.enriched_at IS NOT NULL)

    -- Location
    AND (filter_location_city       IS NULL OR c.location_city = filter_location_city)
    AND (filter_location_tier       IS NULL OR c.location_tier = filter_location_tier)

    -- Experience
    AND (filter_min_years           IS NULL OR c.years_experience >= filter_min_years)
    AND (filter_max_years           IS NULL OR c.years_experience <= filter_max_years)
    AND (filter_seniority           IS NULL OR c.seniority = ANY(filter_seniority))

    -- Function & industry
    AND (filter_function            IS NULL OR c.primary_function = filter_function)
    AND (filter_industries          IS NULL OR c.industries && filter_industries)

    -- People & leadership
    AND (filter_manages_people      IS NULL OR c.manages_people = filter_manages_people)
    AND (filter_is_ic_or_manager    IS NULL OR c.is_ic_or_manager = filter_is_ic_or_manager)

    -- Education
    AND (filter_top_school          IS NULL OR c.top_school = filter_top_school)
    AND (filter_has_mba             IS NULL OR c.has_mba = filter_has_mba)

    -- Mobility
    AND (filter_likely_open_to_move IS NULL OR c.likely_open_to_move = filter_likely_open_to_move)
    AND (filter_mobility            IS NULL OR c.mobility_likelihood = filter_mobility)

    -- Quality signals
    AND (filter_is_outlier          IS NULL OR c.is_outlier = filter_is_outlier)
    AND (filter_min_builder_score   IS NULL OR c.builder_score >= filter_min_builder_score)
    AND (filter_min_ownership_score IS NULL OR c.ownership_score >= filter_min_ownership_score)

    -- Startup / founder
    AND (filter_is_founder          IS NULL OR c.is_founder = filter_is_founder)
    AND (filter_has_startup_exp     IS NULL OR c.has_startup_exp = filter_has_startup_exp)
    AND (filter_has_0_to_1_exp      IS NULL OR c.has_0_to_1_exp = filter_has_0_to_1_exp)

  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;
