// Enrichment script — extracts 83 structured fields per candidate using Claude Haiku
// Run with: node --env-file=.env.local scripts/enrich.mjs
//
// Resume-safe: skips candidates where enriched_at is already set.
// Test mode:   node --env-file=.env.local scripts/enrich.mjs --test
//              Runs on 20 candidates only, prints sample output, does not write to DB.

import { writeFileSync } from 'fs';

const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;

const TEST_MODE      = process.argv.includes('--test');
const LIMIT_ARG      = process.argv.find(a => a.startsWith('--limit='));
const CUSTOM_LIMIT   = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1]) : null;
const OFFSET_ARG     = process.argv.find(a => a.startsWith('--start-offset='));
const START_OFFSET   = OFFSET_ARG ? parseInt(OFFSET_ARG.split('=')[1]) : 0;
const BATCH_SIZE     = 10;   // candidates processed in parallel
const PAGE_SIZE      = 100;  // candidates fetched from Supabase per page
const DELAY_MS       = 500;  // pause between batches (ms)
const MODEL          = 'claude-haiku-4-5-20251001';

if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_KEY) {
  console.error('Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY');
  process.exit(1);
}

// ── Build profile text to send to Claude ──────────────────────────────────────

function buildProfileText(c) {
  const lines = [];

  if (c.name)     lines.push(`Name: ${c.name}`);
  if (c.headline) lines.push(`Headline: ${c.headline}`);
  if (c.location) lines.push(`Location: ${c.location}`);
  if (c.summary)  lines.push(`Summary: ${c.summary}`);

  if (c.top_experience?.length) {
    lines.push('Experience:');
    c.top_experience.forEach(e => {
      const parts = [e.title, e.company, e.date, e.location].filter(Boolean);
      lines.push(`  - ${parts.join(' | ')}`);
      if (e.description) lines.push(`    ${e.description.slice(0, 300)}`);
    });
  }

  if (c.education?.length) {
    lines.push('Education:');
    c.education.forEach(e => {
      const parts = [e.degree, e.field, e.school, e.date].filter(Boolean);
      lines.push(`  - ${parts.join(' | ')}`);
    });
  }

  if (c.skills?.length) {
    lines.push(`Skills: ${c.skills.slice(0, 30).join(', ')}`);
  }

  return lines.join('\n');
}

// ── Extraction prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert recruiter and talent analyst. You will be given a LinkedIn candidate profile and must extract structured information about the candidate.

Return ONLY a valid JSON object. No explanation, no markdown, no preamble.
If a field cannot be determined from the profile, use null.
For boolean fields, use true, false, or null (if truly unknown).
For array fields, return an empty array [] if nothing applies.
For score fields (1-10), always return an integer or null.`;

const USER_PROMPT_TEMPLATE = (profileText) => `Extract structured information from this candidate profile:

---
${profileText}
---

Return a JSON object with exactly these fields:

{
  "years_experience": <integer — total years of professional experience>,
  "seniority": <"junior" | "mid" | "senior" | "lead" | "exec">,
  "manages_people": <boolean>,
  "team_size_managed": <"none" | "small" | "medium" | "large" | "org">,
  "is_founder": <boolean — founded or co-founded a company>,
  "has_startup_exp": <boolean>,
  "has_enterprise_exp": <boolean — worked at large corps like TCS, Infosys, Amazon, etc.>,
  "career_trajectory": <"ascending" | "lateral" | "mixed" | "declining">,
  "avg_tenure_years": <float — average years per company>,
  "job_switches": <integer — number of companies worked at>,
  "currently_employed": <boolean>,
  "has_gap_years": <boolean — any visible employment gaps>,

  "industries": <array of strings — e.g. ["fintech", "SaaS", "healthcare"]>,
  "business_model": <array — e.g. ["B2B", "B2C", "marketplace"]>,
  "company_stage_exp": <array — e.g. ["early-stage", "Series B", "enterprise"]>,
  "has_0_to_1_exp": <boolean — built something from scratch>,
  "has_scale_exp": <boolean — scaled an existing product or team>,
  "has_turnaround_exp": <boolean — fixed or rescued a failing product/team>,
  "geography_exp": <array — e.g. ["India", "SEA", "US"]>,
  "has_india_market_exp": <boolean>,
  "has_international_exp": <boolean>,
  "built_for_bharat": <boolean — built for Tier 2/3 India or vernacular markets>,

  "primary_function": <"engineering" | "product" | "design" | "sales" | "marketing" | "data" | "operations" | "finance" | "HR" | "legal" | "consulting" | "other">,
  "secondary_function": <same options or null>,
  "technical_depth": <"high" | "medium" | "low" | "none">,
  "is_ic_or_manager": <"ic" | "manager" | "both">,
  "has_p_and_l_ownership": <boolean>,
  "has_fundraising_exp": <boolean>,
  "has_bd_or_partnerships_exp": <boolean>,
  "has_hiring_exp": <boolean — built or scaled a team>,

  "stack": <array of tech skills/tools — e.g. ["Python", "React", "AWS"]>,
  "product_type": <array — e.g. ["consumer app", "enterprise software", "API", "data product"]>,
  "has_ai_ml_exp": <boolean>,
  "has_data_exp": <boolean — data science, analytics, BI>,
  "has_mobile_exp": <boolean>,
  "has_open_source_contributions": <boolean>,
  "open_source_projects": <array of project names if mentioned>,

  "leadership_style": <"hands-on" | "strategic" | "player-coach" | "operator" | null>,
  "has_board_or_investor_exposure": <boolean>,
  "has_public_presence": <boolean — speaker, writer, media mentions>,
  "languages": <array — e.g. ["English", "Hindi", "Tamil"]>,
  "has_side_projects": <boolean>,
  "side_project_names": <array of names if mentioned>,

  "top_school": <boolean — IIT, IIM, BITS, NIT, or top international>,
  "school_tier": <"tier_1" | "tier_2" | "tier_3" | "international_top" | "other">,
  "has_mba": <boolean>,
  "mba_tier": <"IIM_ABC" | "IIM_other" | "ISB" | "international_top" | "other" | null>,
  "has_engineering_degree": <boolean>,
  "highest_qualification": <"undergraduate" | "postgraduate" | "PhD" | "MBA" | "diploma" | "other">,

  "location_city": <normalised city name — e.g. "Bangalore", "Mumbai", "Delhi NCR">,
  "location_state": <state name — e.g. "Karnataka", "Maharashtra">,
  "location_tier": <"metro" | "tier_2" | "tier_3">,
  "open_to_relocate": <boolean or null if not mentioned>,
  "is_remote_worker": <boolean or null if not mentioned>,

  "estimated_seniority_band": <"L3-L4" | "L5-L6" | "L7+">,

  "recent_title": <their most recent job title>,
  "recent_function": <function in last 3-5 years>,
  "recent_seniority": <seniority level in last 3-5 years>,
  "recent_industries": <array — industries in last 3-5 years>,
  "recent_company_stage": <company stage in most recent role>,
  "recent_company_names": <array — last 2-3 company names>,
  "recent_manages_people": <boolean — managing people in recent roles>,
  "recent_technical_depth": <technical depth in recent roles>,
  "recent_business_model": <array — B2B/B2C/etc. in recent roles>,
  "recent_geography": <city or region of most recent role>,
  "recent_key_achievements": <string — 2-3 specific accomplishments from last 3-5 years, focus on metrics and outcomes>,
  "recent_has_0_to_1": <boolean — built from scratch in last 3-5 years>,
  "recent_has_scale_exp": <boolean — scaled in last 3-5 years>,

  "hobbies": <array of hobby/interest tags — e.g. ["marathon running", "chess", "music"]>,
  "volunteer_or_social_impact": <boolean>,

  "is_outlier": <boolean — genuinely exceptional, top <1% signal: unicorn early employee, notable exit, major publication, olympiad winner, etc.>,
  "outlier_reason": <one-line string explaining why if is_outlier is true, else null>,

  "mobility_likelihood": <"low" | "medium" | "high" — how likely are they to be open to a new role>,
  "mobility_signals": <array — e.g. ["long_tenure_restless", "career_plateau", "post_exit", "recently_promoted", "company_in_decline", "job_hopper"]>,
  "likely_open_to_move": <boolean>,

  "builder_score": <integer 1-10 — how much evidence of building/making things, not just managing>,
  "builder_evidence": <one-line string summarising why — e.g. "founded two products, maintains open source ML library">,

  "evidence_density_score": <integer 1-10 — how specific and metric-driven is the profile vs vague buzzwords>,
  "evidence_density_signals": <array — e.g. ["uses_metrics", "names_companies_products", "vague_language", "buzzword_heavy", "outcome_oriented"]>,

  "ownership_score": <integer 1-10 — how much personal agency and accountability is shown, not just "we" language>,
  "ownership_signals": <array — e.g. ["uses_first_person", "named_as_dri", "shows_decisions_made", "vague_collective_language", "consultant_speak"]>,

  "profile_completeness": <"high" | "medium" | "low" — how much data exists in this profile>,
  "extraction_confidence": <"high" | "medium" | "low" — how confident you are in this extraction>
}`;

// ── Claude API call ───────────────────────────────────────────────────────────

async function extractFields(profileText, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: USER_PROMPT_TEMPLATE(profileText) }],
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        if (res.status === 429 || res.status === 529) {
          const wait = Math.pow(2, attempt + 2) * 1000;
          console.warn(`  Rate limited. Waiting ${wait / 1000}s…`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw new Error(`Anthropic API ${res.status}: ${err}`);
      }

      const data = await res.json();
      const text = data.content[0].text.trim();

      // Strip markdown code fences if present
      const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      return JSON.parse(cleaned);

    } catch (err) {
      if (attempt === retries - 1) {
        console.warn(`  Extraction failed after ${retries} attempts: ${err.message}`);
        return null;
      }
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function fetchUnenriched(offset, limit) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/candidates?enriched_at=is.null&select=uid,name,headline,location,summary,top_experience,skills,education&offset=${offset}&limit=${limit}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) throw new Error(`Supabase fetch failed: ${await res.text()}`);
  return res.json();
}

async function updateCandidate(uid, fields, retries = 4) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/candidates?uid=eq.${encodeURIComponent(uid)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ ...fields, enriched_at: new Date().toISOString() }),
      }
    );
    if (res.ok) return;
    const errText = await res.text();
    // Retry on timeout or server errors
    if (attempt < retries - 1 && (errText.includes('57014') || errText.includes('timeout') || res.status >= 500)) {
      const wait = Math.pow(2, attempt + 1) * 1000;
      console.warn(`  Supabase timeout for ${uid}, retrying in ${wait / 1000}s…`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    throw new Error(`Supabase update failed for ${uid}: ${errText}`);
  }
}

async function countUnenriched() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/candidates?enriched_at=is.null&select=uid`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'count=exact',
        'Range-Unit': 'items',
        Range: '0-0',
      },
    }
  );
  const range = res.headers.get('content-range'); // e.g. "0-0/12453"
  return range ? parseInt(range.split('/')[1]) : '?';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🪄  Candidate enrichment script`);
  console.log(`   Model: ${MODEL}`);
  console.log(`   Mode:  ${TEST_MODE ? 'TEST (20 candidates, no writes)' : CUSTOM_LIMIT ? `LIMITED RUN (${CUSTOM_LIMIT} candidates)` : 'PRODUCTION (all candidates)'}`);
  if (START_OFFSET > 0) console.log(`   Start offset: ${START_OFFSET}`)
  console.log('');

  const total = await countUnenriched();
  console.log(`   Unenriched candidates: ${total}`);

  if (total === 0) {
    console.log('   All candidates already enriched. Nothing to do.');
    return;
  }

  const limit = TEST_MODE ? 20 : (CUSTOM_LIMIT || Infinity);
  let offset = START_OFFSET;
  let processed = 0;
  let failed = 0;
  const testSamples = [];

  while (processed < limit) {
    const fetchCount = Math.min(PAGE_SIZE, limit - processed);
    const candidates = await fetchUnenriched(offset, fetchCount);
    if (candidates.length === 0) break;

    // Process in parallel batches of BATCH_SIZE
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (c) => {
        const profileText = buildProfileText(c);
        const fields = await extractFields(profileText);

        if (!fields) {
          failed++;
          console.log(`  ✗ ${c.name || c.uid} — extraction failed`);
          return;
        }

        if (TEST_MODE) {
          testSamples.push({ uid: c.uid, name: c.name, fields });
          console.log(`  ✓ ${c.name}`);
          console.log(`    seniority: ${fields.seniority} | years: ${fields.years_experience} | function: ${fields.primary_function}`);
          console.log(`    location: ${fields.location_city} | industries: ${(fields.industries || []).slice(0, 3).join(', ')}`);
          console.log(`    builder: ${fields.builder_score}/10 | ownership: ${fields.ownership_score}/10 | evidence: ${fields.evidence_density_score}/10`);
          if (fields.is_outlier) console.log(`    ⭐ OUTLIER: ${fields.outlier_reason}`);
          console.log('');
        } else {
          await updateCandidate(c.uid, fields);
          console.log(`  ✓ ${c.name || c.uid}`);
        }

        processed++;
      }));

      if (i + BATCH_SIZE < candidates.length) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    offset += candidates.length;

    if (!TEST_MODE) {
      console.log(`\n  Progress: ${processed} enriched, ${failed} failed\n`);
    }

    if (candidates.length < PAGE_SIZE) break; // last page
  }

  console.log(`\n✅  Done. ${processed} enriched, ${failed} failed.\n`);

  if (TEST_MODE && testSamples.length > 0) {
    const outPath = '/tmp/enrichment_test_sample.json';
    writeFileSync(outPath, JSON.stringify(testSamples, null, 2));
    console.log(`   Sample output written to: ${outPath}\n`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
