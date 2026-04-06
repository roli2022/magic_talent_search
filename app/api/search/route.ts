import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ── Pass 0: Query rewrite via Claude ─────────────────────────────────────────

async function rewriteQuery(raw: string): Promise<string> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `You are helping rewrite a recruiter's candidate search query into clean, professional language.

Fix typos, grammar, and awkward phrasing. Remove conversational filler (e.g. "yeah", "like", "basically").
Preserve every requirement exactly — location, experience level, skills, education, must-haves.
If there is a "Must-have:" line, keep it as a separate line with that exact prefix.
Return only the rewritten query. No explanation, no preamble.

Query:
${raw}`,
        }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`Rewrite failed ${res.status}:`, errText);
      return raw;
    }
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || raw;
  } catch (e) {
    console.error('Rewrite error:', e);
    return raw; // graceful fallback — never block search
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
}

function buildSnippet(c: RawCandidate): string {
  const topExp = c.top_experience?.[0];
  const expPart = topExp ? `${topExp.title} at ${topExp.company}` : '';
  const skillsPart = c.skills?.slice(0, 10).join(', ') || '';
  return [c.name, c.headline, skillsPart && `Skills: ${skillsPart}`, expPart]
    .filter(Boolean)
    .join('. ');
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
      model: 'rerank-2-lite',
      top_k: 50,
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
    const { query, mustHave } = await req.json();

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return NextResponse.json({ error: 'Query must be at least 2 characters' }, { status: 400 });
    }

    const trimmed = query.trim();

    // Pass 0 — rewrite query into clean professional language
    const rewritten = await rewriteQuery(trimmed);

    // Pass 1 — embed → vector search top 200
    const embedding = await embedQuery(rewritten);
    const { data: candidates, error } = await supabase.rpc('match_candidates', {
      query_embedding: `[${embedding.join(',')}]`,
      match_count: 200,
    });

    if (error) {
      console.error('Supabase RPC error:', error);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }

    if (!candidates?.length) {
      return NextResponse.json({ results: [] });
    }

    // Pass 2a — rerank top 200 → top 50
    const reranked = await rerankCandidates(rewritten, candidates);
    let results = reranked.map(({ index, relevance_score }) => ({
      ...candidates[index],
      relevanceScore: relevance_score,
    }));

    // Pass 2b — deterministic must-have boost (if provided)
    const mustHaveTrimmed = typeof mustHave === 'string' ? mustHave.trim() : '';
    if (mustHaveTrimmed) {
      results = applyMustHaveBoost(results, mustHaveTrimmed);
    }

    // Capture score range across full 50 for normalisation in the UI
    const poolMinScore = results[results.length - 1]?.relevanceScore ?? 0;
    const poolMaxScore = results[0]?.relevanceScore ?? 1;

    // Return all 50 + rewritten query + score range for display
    return NextResponse.json({
      results,
      rewrittenQuery: rewritten,
      poolMinScore,
      poolMaxScore,
    });

  } catch (err) {
    console.error('Search API error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
