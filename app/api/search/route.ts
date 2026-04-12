import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ── Pass 0: Query rewrite + filter extraction via Claude ─────────────────────

interface ExtractedFilters {
  location_city?:          string | null;
  location_tier?:          string | null;
  min_years?:              number | null;
  max_years?:              number | null;
  seniority?:              string[] | null;
  function?:               string | null;
  industries?:             string[] | null;
  manages_people?:         boolean | null;
  top_school?:             boolean | null;
  has_mba?:                boolean | null;
  likely_open_to_move?:    boolean | null;
  is_outlier?:             boolean | null;
  min_builder_score?:      number | null;
  is_founder?:             boolean | null;
  has_startup_exp?:        boolean | null;
  has_0_to_1_exp?:         boolean | null;
}

interface RewriteResult {
  rewrittenQuery: string;
  filters: ExtractedFilters;
}

async function rewriteQuery(raw: string, previousQuery?: string): Promise<RewriteResult> {
  const fallback: RewriteResult = { rewrittenQuery: raw, filters: {} };
  try {
    const content = previousQuery
      ? `You are helping a recruiter refine their candidate search query.

Previous search query:
${previousQuery}

The recruiter wants to make this change or addition:
"${raw}"

Produce an updated search query that incorporates the refinement into the previous query.
Keep all unchanged requirements. Only modify or add what the recruiter asked for.
If there is a "Must-have:" line, keep it as a separate line with that exact prefix.

Also extract any hard filters explicitly stated in the final combined query.

Return a JSON object with exactly these fields:
{
  "rewrittenQuery": "<the clean rewritten query as a string>",
  "filters": {
    "location_city": "<normalised city name e.g. Bangalore, Mumbai, Delhi NCR, or null>",
    "location_tier": "<metro | tier_2 | tier_3 | null>",
    "min_years": <minimum years experience as integer or null>,
    "max_years": <maximum years experience as integer or null>,
    "seniority": <array e.g. ["senior","lead","exec"] or null>,
    "function": "<primary function e.g. product | engineering | sales | marketing | data | operations | finance | HR | null>",
    "industries": <array e.g. ["fintech","SaaS"] or null>,
    "manages_people": <true if managing teams is required, null otherwise>,
    "top_school": <true if IIT/IIM/top school is required, null otherwise>,
    "has_mba": <true if MBA is required, null otherwise>,
    "likely_open_to_move": <true if candidate must be open to moving, null otherwise>,
    "is_outlier": <true if only exceptional candidates wanted, null otherwise>,
    "min_builder_score": <integer 1-10 if hands-on builder required, null otherwise>,
    "is_founder": <true if founder experience required, null otherwise>,
    "has_startup_exp": <true if startup experience required, null otherwise>,
    "has_0_to_1_exp": <true if 0-to-1 building experience required, null otherwise>
  }
}

Only include filters that are EXPLICITLY stated or strongly implied. Default to null for anything uncertain.
Return only the JSON. No explanation, no preamble.`

      : `You are helping a recruiter search for candidates. Do two things:
1. Rewrite the query into clean professional language (fix typos, remove filler words, preserve all requirements).
2. Extract any hard filters explicitly stated in the query.

Query:
${raw}

Return a JSON object with exactly these fields:
{
  "rewrittenQuery": "<the clean rewritten query as a string>",
  "filters": {
    "location_city": "<normalised city name e.g. Bangalore, Mumbai, Delhi NCR, or null>",
    "location_tier": "<metro | tier_2 | tier_3 | null>",
    "min_years": <minimum years experience as integer or null>,
    "max_years": <maximum years experience as integer or null>,
    "seniority": <array e.g. ["senior","lead","exec"] or null>,
    "function": "<primary function e.g. product | engineering | sales | marketing | data | operations | finance | HR | null>",
    "industries": <array e.g. ["fintech","SaaS"] or null>,
    "manages_people": <true if managing teams is required, null otherwise>,
    "top_school": <true if IIT/IIM/top school is required, null otherwise>,
    "has_mba": <true if MBA is required, null otherwise>,
    "likely_open_to_move": <true if candidate must be open to moving, null otherwise>,
    "is_outlier": <true if only exceptional candidates wanted, null otherwise>,
    "min_builder_score": <integer 1-10 if hands-on builder required, null otherwise>,
    "is_founder": <true if founder experience required, null otherwise>,
    "has_startup_exp": <true if startup experience required, null otherwise>,
    "has_0_to_1_exp": <true if 0-to-1 building experience required, null otherwise>
  }
}

Only include filters that are EXPLICITLY stated or strongly implied. Default to null for anything uncertain.
Return only the JSON. No explanation, no preamble.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 500,
        messages: [{ role: 'user', content }],
      }),
    });
    if (!res.ok) {
      console.error(`Rewrite failed ${res.status}:`, await res.text());
      return fallback;
    }
    const data = await res.json();
    const text = data.content?.[0]?.text?.trim() || '';
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      rewrittenQuery: parsed.rewrittenQuery || raw,
      filters: parsed.filters || {},
    };
  } catch (e) {
    console.error('Rewrite error:', e);
    return fallback;
  }
}

// ── Pass 1: Voyage AI embedding ───────────────────────────────────────────────

async function embedQuery(query: string): Promise<number[]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ model: 'voyage-3', input: [query], input_type: 'query' }),
  });
  if (!res.ok) throw new Error(`Voyage embed error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}

interface RawCandidate {
  uid: string;
  url: string;
  image_url: string | null;
  name: string;
  headline: string;
  summary: string | null;
  location: string;
  skills: string[];
  top_experience: { title: string; company: string; date: string; location: string }[];
  similarity: number;
  // Enriched fields
  enriched_at?: string | null;
  location_city?: string | null;
  years_experience?: number | null;
  seniority?: string | null;
  primary_function?: string | null;
  industries?: string[] | null;
  manages_people?: boolean | null;
  top_school?: boolean | null;
  has_mba?: boolean | null;
  likely_open_to_move?: boolean | null;
  is_outlier?: boolean | null;
  builder_score?: number | null;
  is_founder?: boolean | null;
  has_startup_exp?: boolean | null;
  has_0_to_1_exp?: boolean | null;
}

// Apply enriched field filters in-memory after vector search
function applyEnrichedFilters(candidates: RawCandidate[], filters: ExtractedFilters): RawCandidate[] {
  const hasAnyFilter = Object.values(filters).some(v => v != null);
  if (!hasAnyFilter) return candidates;

  return candidates.filter(c => {
    // Only filter enriched candidates — skip unenriched ones when filters are active
    if (!c.enriched_at) return false;

    if (filters.location_city && c.location_city?.toLowerCase() !== filters.location_city.toLowerCase()) return false;
    if (filters.min_years != null && (c.years_experience == null || c.years_experience < filters.min_years)) return false;
    if (filters.max_years != null && (c.years_experience == null || c.years_experience > filters.max_years)) return false;
    if (filters.seniority?.length && (!c.seniority || !filters.seniority.includes(c.seniority))) return false;
    if (filters.function && c.primary_function !== filters.function) return false;
    if (filters.industries?.length && (!c.industries || !c.industries.some(i => filters.industries!.includes(i)))) return false;
    if (filters.manages_people != null && c.manages_people !== filters.manages_people) return false;
    if (filters.top_school != null && c.top_school !== filters.top_school) return false;
    if (filters.has_mba != null && c.has_mba !== filters.has_mba) return false;
    if (filters.likely_open_to_move != null && c.likely_open_to_move !== filters.likely_open_to_move) return false;
    if (filters.is_outlier != null && c.is_outlier !== filters.is_outlier) return false;
    if (filters.min_builder_score != null && (c.builder_score == null || c.builder_score < filters.min_builder_score)) return false;
    if (filters.is_founder != null && c.is_founder !== filters.is_founder) return false;
    if (filters.has_startup_exp != null && c.has_startup_exp !== filters.has_startup_exp) return false;
    if (filters.has_0_to_1_exp != null && c.has_0_to_1_exp !== filters.has_0_to_1_exp) return false;

    return true;
  });
}

function buildSnippet(c: RawCandidate): string {
  const exps = (c.top_experience || []).slice(0, 3)
    .map(e => `${e.title} at ${e.company}${e.date ? ` (${e.date})` : ''}`)
    .join('; ');
  const skillsPart = c.skills?.slice(0, 15).join(', ') || '';
  const summaryPart = c.summary ? c.summary.slice(0, 300) : '';
  return [
    c.name,
    c.headline,
    c.location && `Location: ${c.location}`,
    skillsPart && `Skills: ${skillsPart}`,
    exps && `Experience: ${exps}`,
    summaryPart && `Summary: ${summaryPart}`,
  ].filter(Boolean).join('. ');
}

// ── Pass 2a: Reranker ─────────────────────────────────────────────────────────

async function rerankCandidates(
  query: string,
  candidates: RawCandidate[]
): Promise<{ index: number; relevance_score: number }[]> {
  const documents = candidates.map(buildSnippet);
  const res = await fetch('https://api.voyageai.com/v1/rerank', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      documents,
      model: 'rerank-2',
      top_k: 60,
      return_documents: false,
    }),
  });
  if (!res.ok) throw new Error(`Voyage rerank error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data;
}

// ── Pass 2b: Deterministic must-have boost ────────────────────────────────────

// Normalise text: lowercase, collapse punctuation/hyphens to spaces
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-/\\_.]/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Common synonyms and abbreviations for Indian job-market terms
const SYNONYM_MAP: Record<string, string[]> = {
  bangalore:   ['bengaluru', 'blr'],
  bengaluru:   ['bangalore', 'blr'],
  hyderabad:   ['hyd', 'secunderabad'],
  mumbai:      ['bombay', 'bom'],
  delhi:       ['ncr', 'new delhi', 'gurgaon', 'gurugram', 'noida', 'faridabad'],
  pune:        ['pcmc', 'pimpri'],
  chennai:     ['madras'],
  insurance:   ['bfsi', 'insurer', 'underwriting', 'reinsurance', 'life insurance', 'general insurance'],
  banking:     ['bfsi', 'bank', 'nbfc', 'neobank'],
  fintech:     ['fin tech', 'financial technology', 'payments'],
  ecommerce:   ['e commerce', 'e-commerce', 'marketplace'],
  sales:       ['business development', 'bd', 'account executive', 'ae'],
};

// Expand a raw input string to all matching terms (original + synonyms)
function expandTerms(input: string): string[] {
  const norm = normalise(input);
  const terms = new Set<string>([norm]);
  const words = norm.split(' ');

  words.forEach(word => {
    SYNONYM_MAP[word]?.forEach(syn => terms.add(syn));
  });

  Object.entries(SYNONYM_MAP).forEach(([key, synonyms]) => {
    if (norm.includes(key)) {
      synonyms.forEach(syn => terms.add(syn));
    }
  });

  return Array.from(terms);
}

// Build a single normalised string from all candidate text fields
function candidateText(c: RawCandidate): string {
  const expText = (c.top_experience || [])
    .map(e => `${e.title} ${e.company} ${e.location}`)
    .join(' ');
  return normalise(
    [c.name, c.headline, c.summary, c.location, ...(c.skills || []), expText]
      .filter(Boolean)
      .join(' ')
  );
}

// Returns true if any expanded must-have term appears in the candidate's text
function matchesMustHave(c: RawCandidate, terms: string[]): boolean {
  const text = candidateText(c);
  return terms.some(term => text.includes(term));
}

// Stable boost: must-have matches float to top, reranker order preserved within each group
function applyMustHaveBoost(
  results: (RawCandidate & { relevanceScore: number })[],
  mustHave: string
): (RawCandidate & { relevanceScore: number; mustHaveMatch: boolean })[] {
  const terms = expandTerms(mustHave);
  const tagged = results.map(r => ({ ...r, mustHaveMatch: matchesMustHave(r, terms) }));
  const hits    = tagged.filter(r => r.mustHaveMatch);
  const others  = tagged.filter(r => !r.mustHaveMatch);
  return [...hits, ...others];
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { query, mustHave, previousQuery } = await req.json();

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return NextResponse.json({ error: 'Query must be at least 2 characters' }, { status: 400 });
    }

    const trimmed = query.trim();

    // Pass 0 — rewrite + extract filters
    const { rewrittenQuery: rewritten, filters } = await rewriteQuery(trimmed, previousQuery?.trim() || undefined);

    console.log('Filters extracted:', JSON.stringify(filters));

    // Pass 1 — embed → vector search top 500
    const embedding = await embedQuery(rewritten);
    const { data: candidates, error } = await supabase.rpc('match_candidates', {
      query_embedding: `[${embedding.join(',')}]`,
      match_count: 500,
    });

    if (error) {
      console.error('Supabase RPC error:', error);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }

    if (!candidates?.length) {
      return NextResponse.json({ results: [], rewrittenQuery: rewritten, filters });
    }

    // Pass 1b — apply enriched field filters in-memory
    const filtered = applyEnrichedFilters(candidates, filters);
    const pool = filtered.length >= 10 ? filtered : candidates; // fallback to full pool if filters too aggressive
    console.log(`Pool: ${candidates.length} → filtered: ${filtered.length} → using: ${pool.length}`);

    // Pass 2a — rerank filtered pool → top 60
    const reranked = await rerankCandidates(rewritten, pool);
    let results = reranked.map(({ index, relevance_score }) => ({
      ...pool[index],
      relevanceScore: relevance_score,
    }));

    // Pass 2b — deterministic must-have boost (if provided)
    const mustHaveTrimmed = typeof mustHave === 'string' ? mustHave.trim() : '';
    if (mustHaveTrimmed) {
      results = applyMustHaveBoost(results, mustHaveTrimmed);
    }

    // Capture score range across full returned set for normalisation in the UI
    const poolMinScore = results[results.length - 1]?.relevanceScore ?? 0;
    const poolMaxScore = results[0]?.relevanceScore ?? 1;

    // Return all reranked results + rewritten query + score range + active filters for display
    return NextResponse.json({
      results,
      rewrittenQuery: rewritten,
      poolMinScore,
      poolMaxScore,
      filters,
    });

  } catch (err) {
    console.error('Search API error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
