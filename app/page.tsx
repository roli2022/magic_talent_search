'use client';

import { useState, useRef, useEffect } from 'react';
import CandidateCard from '@/components/CandidateCard';

interface Experience {
  title: string;
  company: string;
  date: string;
  location: string;
}

interface Candidate {
  uid: string;
  url: string;
  image_url: string | null;
  name: string;
  headline: string;
  summary: string | null;
  location: string;
  skills: string[];
  top_experience: Experience[];
  similarity: number;
  relevanceScore?: number;
}

type Stage = 'intro' | 'nudging' | 'confirming' | 'results';

const NUDGES = [
  {
    key: 'location',
    question: "Where should they be based?",
    placeholder: "e.g. Bangalore, anywhere in India, open to remote",
    skip: "Already specified / doesn't matter",
    append: (v: string) => `Based in ${v}.`,
  },
  {
    key: 'experience',
    question: "Anything to add about their experience?",
    placeholder: "e.g. led teams, early-stage startup, managed P&L",
    skip: "Already covered above",
    append: (v: string) => `${v}.`,
  },
  {
    key: 'skills',
    question: "Any additional skills to include?",
    placeholder: "e.g. React, go-to-market, financial modelling",
    skip: "Already covered above",
    append: (v: string) => `Also strong in ${v}.`,
  },
  {
    key: 'education',
    question: "Does their educational background matter?",
    placeholder: "e.g. IIT, MBA from a top school, CS degree",
    skip: "Education doesn't matter",
    append: (v: string) => `Education: ${v}.`,
  },
  {
    key: 'musthave',
    question: "Anything that's a deal-breaker if missing?",
    placeholder: "e.g. must be in Bangalore, 5+ years is non-negotiable",
    skip: "No hard requirements",
    append: (v: string) => `Non-negotiable requirement: ${v}. Candidates who do not meet this should not be considered.`,
  },
] as const;

const SKIP_PATTERN = /^(no|none|na|n\/a|nah|nope|not applicable|doesn'?t matter|no preference|any|open|skip|-)$/i;

function normalizeNudgeInput(value: string): string {
  const v = value.trim();
  return SKIP_PATTERN.test(v) ? '' : v;
}

function buildComposed(main: string, values: Record<string, string>): string {
  const parts = [main.trim()];
  const mustHaveRaw = values['musthave']?.trim();
  NUDGES.forEach(({ key, append }) => {
    const v = values[key]?.trim();
    if (!v || key === 'musthave') return;
    parts.push(append(v));
  });
  const base = parts.join(' ');
  if (!mustHaveRaw) return base;
  return `${base}\n\nMust-have: ${mustHaveRaw}. Candidates who do not meet this should not be considered.`;
}

export default function SearchPage() {
  const [stage, setStage]                   = useState<Stage>('intro');
  const [mainQuery, setMainQuery]           = useState('');
  const [activeNudge, setActiveNudge]       = useState(0);
  const [nudgeInput, setNudgeInput]         = useState('');
  const [values, setValues]                 = useState<Record<string, string>>({});
  const [detectedFields, setDetectedFields] = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing]           = useState(false);
  const [finalQuery, setFinalQuery]         = useState('');
  const [rewrittenQuery, setRewrittenQuery] = useState('');
  const [poolMinScore, setPoolMinScore]     = useState(0);
  const [poolMaxScore, setPoolMaxScore]     = useState(1);
  const [results, setResults]               = useState<Candidate[]>([]);
  const [page, setPage]                     = useState(1);
  const PAGE_SIZE = 10;
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [searchHistory, setSearchHistory]   = useState<{ label: string; query: string; mustHave: string }[]>([]);
  const [hasSearched, setHasSearched]       = useState(false);

  const nudgeInputRef  = useRef<HTMLInputElement>(null);
  const confirmRef     = useRef<HTMLTextAreaElement>(null);
  const rightPanelRef  = useRef<HTMLDivElement>(null);

  // Stay split once first search has run — only centered on fresh page load
  const isSplit = hasSearched || loading || stage === 'results' || (results.length > 0 && (stage === 'confirming' || stage === 'nudging'));

  // Nudges filtered to only those not already covered by the initial query
  const activeNudges = NUDGES.filter(n => !detectedFields[n.key]);

  useEffect(() => {
    if (stage === 'nudging') nudgeInputRef.current?.focus();
  }, [stage, activeNudge]);

  useEffect(() => {
    if (stage === 'confirming') confirmRef.current?.focus();
  }, [stage]);

  async function handleIntroSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mainQuery.trim()) return;
    setAnalyzing(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: mainQuery.trim() }),
      });
      const data = await res.json();
      const detected: Record<string, string> = data.detected || {};
      setDetectedFields(detected);

      const remaining = NUDGES.filter(n => !detected[n.key]);
      setActiveNudge(0);
      setNudgeInput('');
      setValues({});
      if (remaining.length === 0) {
        setFinalQuery(buildComposed(mainQuery.trim(), {}));
        setStage('confirming');
      } else {
        setStage('nudging');
      }
    } catch {
      setDetectedFields({});
      setActiveNudge(0);
      setNudgeInput('');
      setValues({});
      setStage('nudging');
    } finally {
      setAnalyzing(false);
    }
  }

  function advanceNudge(inputValue: string) {
    const newValues = { ...values, [activeNudges[activeNudge].key]: normalizeNudgeInput(inputValue) };
    setValues(newValues);
    setNudgeInput('');
    if (activeNudge < activeNudges.length - 1) {
      setActiveNudge(i => i + 1);
    } else {
      setFinalQuery(buildComposed(mainQuery, newValues));
      setStage('confirming');
    }
  }

  function handleNudgeSubmit(e: React.FormEvent) {
    e.preventDefault();
    advanceNudge(nudgeInput);
  }

  async function handleSearch(queryOverride?: string, mustHaveOverride?: string) {
    const q  = queryOverride  ?? finalQuery;
    const mh = mustHaveOverride ?? (values.musthave || detectedFields.musthave || '');
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    if (queryOverride) { setFinalQuery(queryOverride); setStage('confirming'); }
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, mustHave: mh }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      const rq = data.rewrittenQuery || q;
      setResults(data.results);
      setRewrittenQuery(rq);
      setPoolMinScore(data.poolMinScore ?? 0);
      setPoolMaxScore(data.poolMaxScore ?? 1);
      setPage(1);
      setHasSearched(true);
      setStage('results');
      // Record in history (dedup, keep last 5)
      setSearchHistory(prev => {
        const entry = { label: rq, query: q, mustHave: mh };
        const deduped = prev.filter(h => h.query !== q);
        return [entry, ...deduped].slice(0, 5);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setStage('intro');
    setMainQuery('');
    setActiveNudge(0);
    setNudgeInput('');
    setValues({});
    setDetectedFields({});
    setFinalQuery('');
    setRewrittenQuery('');
    setPoolMinScore(0);
    setPoolMaxScore(1);
    setPage(1);
    setResults([]);
    setError(null);
  }

  const composed = buildComposed(mainQuery, { ...values, [activeNudges[activeNudge]?.key]: nudgeInput });
  const nudge    = activeNudges[activeNudge];

  // Filter out results below 30% relative strength within the pool
  const scoreRange = poolMaxScore - poolMinScore;
  const visibleResults = results.filter(c => {
    const base = c.relevanceScore ?? c.similarity;
    const norm = scoreRange > 0 ? Math.min((base - poolMinScore) / scoreRange, 1) : 1;
    return norm >= 0.30;
  });


  return (
    <div className="flex h-screen overflow-hidden bg-[#0d1117]">

      {/* ── LEFT PANEL ── */}
      <div
        className={`
          flex-shrink-0 overflow-y-auto transition-all duration-500 ease-in-out
          ${isSplit
            ? 'w-2/5 border-r border-[#21262d] flex flex-col justify-center'
            : 'w-full flex items-center justify-center'
          }
        `}
      >
        <div
          className={`
            transition-all duration-500 ease-in-out px-8 py-14
            ${isSplit ? 'w-full' : 'w-full max-w-2xl'}
          `}
        >

          {/* ── INTRO ── */}
          {stage === 'intro' && (
            <div>
              <div className="mb-10">
                <div className="inline-flex items-center gap-2 bg-cyan-950 text-cyan-400 text-xs font-semibold px-3 py-1.5 rounded-full border border-cyan-900 mb-7">
                  <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full" />
                  30,000 candidates · India
                </div>
                <h1 className="text-5xl font-black tracking-tight leading-tight mb-4">
                  Find great talent.{' '}
                  <span className="text-cyan-400">Fast ⚡</span>
                </h1>
                <p className="text-gray-500 text-base">
                  Describe who you need in plain English — we'll find the best matches.
                </p>
              </div>

              <form onSubmit={handleIntroSubmit}>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
                  Who are you looking for?
                </label>
                <textarea
                  value={mainQuery}
                  onChange={e => setMainQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey && mainQuery.trim()) {
                      e.preventDefault();
                      handleIntroSubmit(e as unknown as React.FormEvent);
                    }
                  }}
                  placeholder="e.g. a senior product manager with 8+ years who has scaled a B2B SaaS product from 0 to 1, ideally with a background in fintech or enterprise software"
                  rows={4}
                  className="w-full bg-gray-900 border border-gray-700 rounded-2xl px-5 py-4 text-base text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-600 resize-none transition-colors mb-3"
                  autoFocus
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!mainQuery.trim() || analyzing}
                    className="bg-cyan-500 text-gray-950 px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-cyan-400 disabled:opacity-30 transition-colors"
                  >
                    {analyzing ? 'Thinking…' : '🔍 Find'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ── NUDGING ── */}
          {stage === 'nudging' && (
            <div>
              <button
                onClick={handleReset}
                className="text-xs text-gray-600 hover:text-gray-400 mb-8 flex items-center gap-1 transition-colors"
              >
                ← Start over
              </button>

              <div className="bg-gray-900 border border-cyan-900 rounded-2xl px-5 py-4 mb-8">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-600 mb-1.5">
                  Your search so far
                </p>
                <p className="text-gray-200 text-base leading-relaxed font-medium whitespace-pre-wrap">{composed}</p>
              </div>

              <form onSubmit={handleNudgeSubmit}>
                <label className="block text-xl font-bold text-white mb-4">
                  {nudge.question}
                </label>
                <input
                  ref={nudgeInputRef}
                  type="text"
                  value={nudgeInput}
                  onChange={e => setNudgeInput(e.target.value)}
                  placeholder={nudge.placeholder}
                  className="w-full bg-gray-900 border border-gray-700 rounded-2xl px-5 py-4 text-base text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-600 mb-4 transition-colors"
                />
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={!nudgeInput.trim()}
                    className="bg-cyan-500 text-gray-950 px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-cyan-400 disabled:opacity-30 transition-colors"
                  >
                    {activeNudge < activeNudges.length - 1 ? 'Next →' : 'Review →'}
                  </button>
                  <button
                    type="button"
                    onClick={() => advanceNudge('')}
                    className="px-5 py-2.5 rounded-xl text-sm text-gray-500 border border-gray-700 hover:border-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {nudge.skip}
                  </button>
                </div>
              </form>

              <div className="flex gap-1.5 mt-10">
                {activeNudges.map((_, i) => (
                  <div
                    key={i}
                    className={`h-0.5 flex-1 rounded-full transition-all duration-500 ${
                      i < activeNudge   ? 'bg-cyan-700' :
                      i === activeNudge ? 'bg-cyan-400' :
                      'bg-gray-800'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── CONFIRMING ── */}
          {stage === 'confirming' && (
            <div>
              <button
                onClick={handleReset}
                className="text-xs text-gray-600 hover:text-gray-400 mb-8 flex items-center gap-1 transition-colors"
              >
                ← Start over
              </button>

              <p className="text-2xl font-black text-white mb-1">Almost there.</p>
              <p className="text-gray-500 text-sm mb-6">
                Here's what we'll search for. Feel free to reword or add anything.
              </p>

              <textarea
                ref={confirmRef}
                value={finalQuery}
                onChange={e => setFinalQuery(e.target.value)}
                rows={5}
                className="w-full bg-gray-900 border border-gray-700 rounded-2xl px-5 py-4 text-base text-white leading-relaxed focus:outline-none focus:border-cyan-600 resize-none mb-5 transition-colors"
              />

              {error && (
                <div className="bg-red-950 border border-red-800 text-red-400 rounded-xl px-4 py-3 text-sm mb-5">
                  {error}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={() => handleSearch()}
                  disabled={loading || !finalQuery.trim()}
                  className="bg-cyan-500 text-gray-950 px-8 py-3 rounded-xl text-sm font-bold hover:bg-cyan-400 disabled:opacity-40 transition-colors"
                >
                  {loading ? 'Searching…' : '🔍 Find candidates'}
                </button>
              </div>
            </div>
          )}

          {/* ── RESULTS SIDEBAR ── */}
          {stage === 'results' && !loading && (
            <div className="flex flex-col gap-8">
              {/* Badge + Title */}
              <div>
                <div className="inline-flex items-center gap-2 bg-cyan-950 text-cyan-400 text-xs font-semibold px-3 py-1.5 rounded-full border border-cyan-900 mb-4">
                  <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full" />
                  30,000 candidates · India
                </div>
                <h1 className="text-3xl font-black tracking-tight leading-tight">
                  Find great talent.{' '}
                  <span className="text-cyan-400">Fast ⚡</span>
                </h1>
              </div>

              {/* Searched for */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">
                  Searched for
                </p>
                <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                  {rewrittenQuery || finalQuery}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setStage('confirming')}
                  className="text-sm text-cyan-500 hover:text-cyan-400 font-medium transition-colors"
                >
                  ← Refine search
                </button>
                <button
                  onClick={handleReset}
                  className="text-sm font-semibold text-white bg-[#21262d] hover:bg-[#2d333b] border border-[#373e47] px-4 py-2 rounded-xl transition-colors"
                >
                  New search →
                </button>
              </div>

            </div>
          )}

          {/* ── PREVIOUS SEARCHES (persistent) ── */}
          {searchHistory.length > 0 && (
            <div className="mt-10 pt-8 border-t border-[#21262d]">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-700 mb-3">
                Previous searches
              </p>
              <div className="flex flex-col gap-2.5">
                {searchHistory.map((entry, i) => (
                  <button
                    key={i}
                    onClick={() => handleSearch(entry.query, entry.mustHave)}
                    className="text-left text-xs text-gray-500 hover:text-gray-300 leading-snug transition-colors line-clamp-2"
                    title={entry.label}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div
        ref={rightPanelRef}
        className={`
          flex-1 overflow-y-auto transition-opacity duration-700 ease-in-out
          ${isSplit ? 'opacity-100' : 'opacity-0 pointer-events-none'}
        `}
      >
        <div className="px-10 py-14">

          {/* ── LOADING SKELETON ── */}
          {loading && (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="bg-[#161b22] rounded-2xl p-5 border border-[#30363d] animate-pulse">
                  <div className="flex items-start gap-4">
                    <div className="flex flex-col items-center gap-1.5">
                      <div className="w-4 h-2 bg-gray-800 rounded" />
                      <div className="w-11 h-11 rounded-full bg-gray-800 flex-shrink-0" />
                    </div>
                    <div className="flex-1 space-y-2.5 pt-1">
                      <div className="h-4 bg-gray-800 rounded-full w-1/3" />
                      <div className="h-3 bg-gray-800 rounded-full w-2/3" />
                      <div className="h-3 bg-gray-800 rounded-full w-1/4" />
                      <div className="flex gap-1.5 mt-1">
                        {[...Array(4)].map((_, j) => (
                          <div key={j} className="h-5 w-16 bg-gray-800 rounded-full" />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── RESULT CARDS ── */}
          {(stage === 'results' || ((stage === 'confirming' || stage === 'nudging') && results.length > 0)) && !loading && (
            <div>
              <div className="space-y-3">
                {(() => {
                  const start = (page - 1) * PAGE_SIZE;
                  return visibleResults.slice(start, start + PAGE_SIZE).map((candidate, i) => (
                    <div
                      key={candidate.uid}
                      className="card-reveal"
                      style={{ animationDelay: `${Math.min(i * 50, 350)}ms` }}
                    >
                      <CandidateCard
                        candidate={candidate}
                        rank={start + i + 1}
                        query={rewrittenQuery || finalQuery}
                        maxRelevanceScore={poolMaxScore}
                        minRelevanceScore={poolMinScore}
                      />
                    </div>
                  ));
                })()}
              </div>

              {visibleResults.length > PAGE_SIZE && (
                <div className="flex items-center justify-center gap-3 mt-8 pb-8">
                  <button
                    onClick={() => { setPage(p => p - 1); rightPanelRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    disabled={page === 1}
                    className="px-4 py-2 rounded-xl text-sm text-gray-400 border border-[#373e47] hover:border-gray-500 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    ← Prev
                  </button>
                  <span className="text-xs text-gray-600">
                    {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, visibleResults.length)} of {visibleResults.length}
                  </span>
                  <button
                    onClick={() => { setPage(p => p + 1); rightPanelRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    disabled={page * PAGE_SIZE >= visibleResults.length}
                    className="px-4 py-2 rounded-xl text-sm text-gray-400 border border-[#373e47] hover:border-gray-500 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Next →
                  </button>
                </div>
              )}

              {visibleResults.length === 0 && (
                <div className="text-center mt-20">
                  <p className="text-gray-500 mb-2">No candidates found.</p>
                  <p className="text-sm text-gray-700">Try broadening your search.</p>
                </div>
              )}
            </div>
          )}

        </div>
      </div>

    </div>
  );
}
