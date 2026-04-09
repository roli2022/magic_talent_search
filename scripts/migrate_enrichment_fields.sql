-- Enrichment fields migration
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- Safe to run multiple times — uses ADD COLUMN IF NOT EXISTS

ALTER TABLE candidates

  -- ── Career Shape ────────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS years_experience        integer,
  ADD COLUMN IF NOT EXISTS seniority               text,        -- junior / mid / senior / lead / exec
  ADD COLUMN IF NOT EXISTS manages_people          boolean,
  ADD COLUMN IF NOT EXISTS team_size_managed       text,        -- none / small / medium / large / org
  ADD COLUMN IF NOT EXISTS is_founder              boolean,
  ADD COLUMN IF NOT EXISTS has_startup_exp         boolean,
  ADD COLUMN IF NOT EXISTS has_enterprise_exp      boolean,
  ADD COLUMN IF NOT EXISTS career_trajectory       text,        -- ascending / lateral / mixed / declining
  ADD COLUMN IF NOT EXISTS avg_tenure_years        numeric(4,1),
  ADD COLUMN IF NOT EXISTS job_switches            integer,
  ADD COLUMN IF NOT EXISTS currently_employed      boolean,
  ADD COLUMN IF NOT EXISTS has_gap_years           boolean,

  -- ── Domain & Industry ───────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS industries              text[],
  ADD COLUMN IF NOT EXISTS business_model          text[],      -- B2B / B2C / D2C / marketplace / enterprise
  ADD COLUMN IF NOT EXISTS company_stage_exp       text[],      -- early-stage / Series A-C / growth / enterprise / public
  ADD COLUMN IF NOT EXISTS has_0_to_1_exp          boolean,
  ADD COLUMN IF NOT EXISTS has_scale_exp           boolean,
  ADD COLUMN IF NOT EXISTS has_turnaround_exp      boolean,
  ADD COLUMN IF NOT EXISTS geography_exp           text[],
  ADD COLUMN IF NOT EXISTS has_india_market_exp    boolean,
  ADD COLUMN IF NOT EXISTS has_international_exp   boolean,
  ADD COLUMN IF NOT EXISTS built_for_bharat        boolean,

  -- ── Function & Depth ────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS primary_function        text,        -- engineering / product / design / sales / marketing / data / operations / finance / HR / legal
  ADD COLUMN IF NOT EXISTS secondary_function      text,
  ADD COLUMN IF NOT EXISTS technical_depth         text,        -- high / medium / low / none
  ADD COLUMN IF NOT EXISTS is_ic_or_manager        text,        -- ic / manager / both
  ADD COLUMN IF NOT EXISTS has_p_and_l_ownership   boolean,
  ADD COLUMN IF NOT EXISTS has_fundraising_exp     boolean,
  ADD COLUMN IF NOT EXISTS has_bd_or_partnerships_exp boolean,
  ADD COLUMN IF NOT EXISTS has_hiring_exp          boolean,

  -- ── Product & Tech Specifics ─────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS stack                   text[],
  ADD COLUMN IF NOT EXISTS product_type            text[],
  ADD COLUMN IF NOT EXISTS has_ai_ml_exp           boolean,
  ADD COLUMN IF NOT EXISTS has_data_exp            boolean,
  ADD COLUMN IF NOT EXISTS has_mobile_exp          boolean,
  ADD COLUMN IF NOT EXISTS has_open_source_contributions boolean,
  ADD COLUMN IF NOT EXISTS open_source_projects    text[],

  -- ── Leadership & Soft Signals ────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS leadership_style        text,        -- hands-on / strategic / player-coach / operator
  ADD COLUMN IF NOT EXISTS has_board_or_investor_exposure boolean,
  ADD COLUMN IF NOT EXISTS has_public_presence     boolean,
  ADD COLUMN IF NOT EXISTS languages               text[],
  ADD COLUMN IF NOT EXISTS has_side_projects       boolean,
  ADD COLUMN IF NOT EXISTS side_project_names      text[],

  -- ── Education ───────────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS top_school              boolean,
  ADD COLUMN IF NOT EXISTS school_tier             text,        -- tier_1 / tier_2 / tier_3 / international_top / other
  ADD COLUMN IF NOT EXISTS has_mba                 boolean,
  ADD COLUMN IF NOT EXISTS mba_tier                text,        -- IIM_ABC / IIM_other / ISB / international_top / other
  ADD COLUMN IF NOT EXISTS has_engineering_degree  boolean,
  ADD COLUMN IF NOT EXISTS highest_qualification   text,        -- undergraduate / postgraduate / PhD / MBA / diploma

  -- ── Location ────────────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS location_city           text,
  ADD COLUMN IF NOT EXISTS location_state          text,
  ADD COLUMN IF NOT EXISTS location_tier           text,        -- metro / tier_2 / tier_3
  ADD COLUMN IF NOT EXISTS open_to_relocate        boolean,
  ADD COLUMN IF NOT EXISTS is_remote_worker        boolean,

  -- ── Compensation Signal ──────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS estimated_seniority_band text,       -- L3-L4 / L5-L6 / L7+

  -- ── Recent Experience (last 3–5 years) ───────────────────────────────────
  ADD COLUMN IF NOT EXISTS recent_title            text,
  ADD COLUMN IF NOT EXISTS recent_function         text,
  ADD COLUMN IF NOT EXISTS recent_seniority        text,
  ADD COLUMN IF NOT EXISTS recent_industries       text[],
  ADD COLUMN IF NOT EXISTS recent_company_stage    text,
  ADD COLUMN IF NOT EXISTS recent_company_names    text[],
  ADD COLUMN IF NOT EXISTS recent_manages_people   boolean,
  ADD COLUMN IF NOT EXISTS recent_technical_depth  text,
  ADD COLUMN IF NOT EXISTS recent_business_model   text[],
  ADD COLUMN IF NOT EXISTS recent_geography        text,
  ADD COLUMN IF NOT EXISTS recent_key_achievements text,
  ADD COLUMN IF NOT EXISTS recent_has_0_to_1       boolean,
  ADD COLUMN IF NOT EXISTS recent_has_scale_exp    boolean,

  -- ── Hobbies & Personality ────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS hobbies                 text[],
  ADD COLUMN IF NOT EXISTS volunteer_or_social_impact boolean,

  -- ── Outlier ─────────────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS is_outlier              boolean,
  ADD COLUMN IF NOT EXISTS outlier_reason          text,

  -- ── Mobility ────────────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS mobility_likelihood     text,        -- low / medium / high
  ADD COLUMN IF NOT EXISTS mobility_signals        text[],
  ADD COLUMN IF NOT EXISTS likely_open_to_move     boolean,

  -- ── Builder Score ────────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS builder_score           smallint,    -- 1–10
  ADD COLUMN IF NOT EXISTS builder_evidence        text,

  -- ── Evidence Density ─────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS evidence_density_score  smallint,    -- 1–10
  ADD COLUMN IF NOT EXISTS evidence_density_signals text[],

  -- ── Ownership Score ──────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS ownership_score         smallint,    -- 1–10
  ADD COLUMN IF NOT EXISTS ownership_signals       text[],

  -- ── Profile Quality ──────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS profile_completeness    text,        -- high / medium / low
  ADD COLUMN IF NOT EXISTS extraction_confidence   text,        -- high / medium / low

  -- ── Enrichment tracking ──────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS enriched_at             timestamptz; -- set when enrichment runs, null = not yet enriched


-- Index the most-filtered fields for fast WHERE clause performance
CREATE INDEX IF NOT EXISTS idx_candidates_enriched_at        ON candidates (enriched_at);
CREATE INDEX IF NOT EXISTS idx_candidates_seniority          ON candidates (seniority);
CREATE INDEX IF NOT EXISTS idx_candidates_years_experience   ON candidates (years_experience);
CREATE INDEX IF NOT EXISTS idx_candidates_location_city      ON candidates (location_city);
CREATE INDEX IF NOT EXISTS idx_candidates_primary_function   ON candidates (primary_function);
CREATE INDEX IF NOT EXISTS idx_candidates_mobility           ON candidates (mobility_likelihood);
CREATE INDEX IF NOT EXISTS idx_candidates_is_outlier         ON candidates (is_outlier);
CREATE INDEX IF NOT EXISTS idx_candidates_builder_score      ON candidates (builder_score);
CREATE INDEX IF NOT EXISTS idx_candidates_industries         ON candidates USING gin (industries);
CREATE INDEX IF NOT EXISTS idx_candidates_stack              ON candidates USING gin (stack);
CREATE INDEX IF NOT EXISTS idx_candidates_recent_industries  ON candidates USING gin (recent_industries);
