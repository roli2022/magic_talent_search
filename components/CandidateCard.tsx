'use client';

import { useState, useEffect, useRef } from 'react';

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
  enriched_at?: string | null;
  years_experience?: number | null;
  seniority?: string | null;
  avg_tenure_years?: number | null;
  job_switches?: number | null;
  mobility_likelihood?: string | null;
  likely_open_to_move?: boolean | null;
  manages_people?: boolean | null;
  team_size_managed?: string | null;
  top_school?: boolean | null;
  school_tier?: string | null;
  has_mba?: boolean | null;
  is_founder?: boolean | null;
  has_0_to_1_exp?: boolean | null;
  has_scale_exp?: boolean | null;
  has_startup_exp?: boolean | null;
  builder_score?: number | null;
  builder_evidence?: string | null;
  ownership_score?: number | null;
  is_outlier?: boolean | null;
  outlier_reason?: string | null;
  primary_function?: string | null;
  location_city?: string | null;
}

interface EnrichedBadge {
  icon: string;
  label: string;
  cls: string;
  title?: string;
}

function buildEnrichedBadges(c: Candidate): EnrichedBadge[] {
  if (!c.enriched_at) return [];
  const badges: EnrichedBadge[] = [];

  if (c.mobility_likelihood === 'low') {
    badges.push({ icon: '🟢', label: 'Stable', cls: 'bg-emerald-950/60 text-emerald-400 border-emerald-900/60', title: 'Low mobility likelihood' });
  } else if (c.mobility_likelihood === 'high') {
    badges.push({ icon: '🔴', label: 'Likely to move', cls: 'bg-red-950/60 text-red-400 border-red-900/60', title: 'High mobility likelihood' });
  } else if (c.mobility_likelihood === 'medium') {
    badges.push({ icon: '🟡', label: 'May move', cls: 'bg-yellow-950/60 text-yellow-400 border-yellow-900/60', title: 'Medium mobility likelihood' });
  }

  if (c.avg_tenure_years != null) {
    badges.push({ icon: '⏱', label: `${c.avg_tenure_years}yr avg tenure`, cls: 'bg-slate-800/60 text-slate-400 border-slate-700/60' });
  }

  if (c.is_outlier) {
    badges.push({ icon: '⭐', label: 'Outlier', cls: 'bg-amber-950/60 text-amber-300 border-amber-800/60', title: c.outlier_reason || 'Exceptional candidate' });
  }

  if (c.builder_score != null && c.builder_score >= 6) {
    badges.push({ icon: '🔨', label: `Builder ${c.builder_score}/10`, cls: 'bg-violet-950/60 text-violet-400 border-violet-900/60', title: c.builder_evidence || undefined });
  }

  if (c.top_school) {
    const label = c.school_tier === 'tier_1' ? 'IIT/IIM' : c.has_mba ? 'Top MBA' : 'Top school';
    badges.push({ icon: '🎓', label, cls: 'bg-blue-950/60 text-blue-400 border-blue-900/60' });
  }

  if (c.is_founder) {
    badges.push({ icon: '🚀', label: 'Founded a co.', cls: 'bg-orange-950/60 text-orange-400 border-orange-900/60' });
  }

  if (c.has_0_to_1_exp && !c.is_founder) {
    badges.push({ icon: '⚡', label: 'Built 0-to-1', cls: 'bg-cyan-950/60 text-cyan-400 border-cyan-900/60' });
  }

  return badges.slice(0, 5);
}

function buildMatchBadges(c: Candidate, filters: Record<string, unknown>): string[] {
  if (!c.enriched_at || !filters) return [];
  const badges: string[] = [];

  if (filters.location_city && c.location_city?.toLowerCase() === (filters.location_city as string).toLowerCase())
    badges.push(c.location_city!);
  if (filters.function && c.primary_function === filters.function)
    badges.push(c.primary_function!);
  if (filters.seniority && Array.isArray(filters.seniority) && c.seniority && (filters.seniority as string[]).includes(c.seniority))
    badges.push(c.seniority);
  if (filters.min_years != null && c.years_experience != null && c.years_experience >= (filters.min_years as number))
    badges.push(`${c.years_experience}+ yrs`);
  if (filters.manages_people && c.manages_people)
    badges.push('Manages teams');
  if (filters.top_school && c.top_school)
    badges.push('Top school');
  if (filters.has_mba && c.has_mba)
    badges.push('MBA');
  if (filters.is_founder && c.is_founder)
    badges.push('Founder');
  if (filters.has_0_to_1_exp && c.has_0_to_1_exp)
    badges.push('0-to-1');
  if (filters.has_startup_exp && c.has_startup_exp)
    badges.push('Startup exp');

  return badges.slice(0, 5);
}

const AVATAR_COLORS = [
  'bg-violet-900 text-violet-300',
  'bg-blue-900 text-blue-300',
  'bg-emerald-900 text-emerald-300',
  'bg-amber-900 text-amber-300',
  'bg-rose-900 text-rose-300',
  'bg-cyan-900 text-cyan-300',
];

const LI_PATH = 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z';

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className}>
      <path d={LI_PATH} />
    </svg>
  );
}

export default function CandidateCard({
  candidate,
  rank,
  query,
  maxRelevanceScore,
  minRelevanceScore,
  filters = {},
}: {
  candidate: Candidate;
  rank: number;
  query?: string;
  maxRelevanceScore?: number;
  minRelevanceScore?: number;
  filters?: Record<string, unknown>;
}) {
  const topExp      = candidate.top_experience?.[0];
  const avatarColor = AVATAR_COLORS[(candidate.name?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];

  const baseScore    = candidate.relevanceScore ?? candidate.similarity;
  const scoreRange   = (maxRelevanceScore ?? 1) - (minRelevanceScore ?? 0);
  const normStrength = scoreRange > 0 ? Math.min((baseScore - (minRelevanceScore ?? 0)) / scoreRange, 1) : 1;
  const relStrength  = maxRelevanceScore ? Math.min(baseScore / maxRelevanceScore, 1) : 1;

  const matchLabel =
    normStrength >= 0.75 ? { text: 'Excellent', cls: 'bg-amber-900/60 text-amber-300 border-amber-700/60',   borderCls: 'border-amber-700/50 hover:border-amber-500/70', barCls: 'from-amber-600 to-amber-400'  } :
    normStrength >= 0.50 ? { text: 'Strong',    cls: 'bg-slate-600/40 text-slate-100 border-slate-400/70',   borderCls: 'border-slate-500/40 hover:border-slate-400/70', barCls: 'from-slate-400 to-slate-300'  } :
    normStrength >= 0.25 ? { text: 'OK',        cls: 'bg-pink-950/60  text-pink-300  border-pink-800/50',    borderCls: 'border-pink-900/50  hover:border-pink-700/60',  barCls: 'from-pink-700  to-pink-500'   } :
                           { text: 'Partial',   cls: 'bg-blue-950/70  text-blue-300  border-blue-800/60',    borderCls: 'border-blue-900/50  hover:border-blue-700/60',  barCls: 'from-blue-700  to-blue-500'   };

  const [summary, setSummary]               = useState('');
  const [sumDone, setSumDone]               = useState(false);
  const [sumLoading, setSumLoading]         = useState(false);
  const [interviewQueued, setInterviewQueued] = useState(false);
  const fetchedRef = useRef(false);

  function renderSummary(text: string) {
    const parts = text.split(/\*\*(.+?)\*\*/g);
    return parts.map((part, i) =>
      i % 2 === 1
        ? <span key={i} className="text-cyan-300 font-semibold">{part}</span>
        : <span key={i}>{part}</span>
    );
  }

  useEffect(() => {
    if (!query || fetchedRef.current) return;
    fetchedRef.current = true;
    setSumLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidate, query }),
        });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let text = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          setSummary(text);
        }
        setSumDone(true);
      } catch { /* silently skip */ }
      finally { setSumLoading(false); }
    })();
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const matched  = buildMatchBadges(candidate, filters);
  const enriched = buildEnrichedBadges(candidate);

  return (
    <div className={`bg-[#1c2128] rounded-2xl border transition-all duration-200 shadow-md shadow-black/30 overflow-hidden ${matchLabel.borderCls}`}>
      <div className="p-5">
        <div className="flex items-start gap-4">

          {/* Rank + Avatar */}
          <div className="flex flex-col items-center gap-1.5 flex-shrink-0 w-11">
            <span className="text-[10px] font-medium text-gray-700">#{rank}</span>
            <a href={candidate.url} target="_blank" rel="noopener noreferrer">
              {candidate.image_url ? (
                <img
                  src={candidate.image_url}
                  alt={candidate.name}
                  className="w-11 h-11 rounded-full object-cover ring-1 ring-white/10"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className={`w-11 h-11 rounded-full ${avatarColor} flex items-center justify-center font-bold text-sm ring-1 ring-white/10`}>
                  {(candidate.name || '?').charAt(0).toUpperCase()}
                </div>
              )}
            </a>
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">

            {/* Name row */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <a
                  href={candidate.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-[16px] text-white hover:text-cyan-400 transition-colors"
                >
                  {candidate.name}
                </a>
                {candidate.location && (
                  <span className="text-gray-600 text-[11px] ml-2">{candidate.location}</span>
                )}
              </div>
              <div className={`flex-shrink-0 text-[12px] font-semibold px-3 py-1 rounded-lg border ${matchLabel.cls}`}>
                {matchLabel.text}
              </div>
            </div>

            {candidate.headline && (
              <p className="text-[13px] text-gray-400 mt-1 line-clamp-1">{candidate.headline}</p>
            )}

            {topExp && (
              <p className="text-xs text-gray-600 mt-2">
                <span className="text-gray-300 font-semibold">{topExp.title}</span>
                {topExp.company && <span className="text-gray-500"> at {topExp.company}</span>}
                {topExp.date && <span className="text-gray-700"> · {topExp.date}</span>}
              </p>
            )}

            {/* AI Summary */}
            <div className="mt-3 pt-3 border-t border-[#2d333b]">
              {sumLoading && !summary && (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-600 animate-pulse" />
                  <span className="text-[11px] text-gray-700">Analysing fit…</span>
                </div>
              )}
              {summary && (
                <p className="text-[12px] text-gray-400 leading-relaxed">
                  {sumDone ? renderSummary(summary) : summary}
                </p>
              )}
            </div>

            {/* Signals + Actions — always show actions, signals only when present */}
            <div className="mt-3 pt-3 border-t border-[#2d333b] flex items-start justify-between gap-3">

              {/* Signals column */}
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                {matched.length > 0 && (
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] font-bold text-emerald-600 mt-0.5 w-16 flex-shrink-0">Matched</span>
                    <div className="flex flex-wrap gap-1.5">
                      {matched.map((label, i) => (
                        <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border bg-emerald-950/50 text-emerald-400 border-emerald-900/60">
                          ✓ {label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {enriched.length > 0 && (
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] font-bold text-violet-400 mt-0.5 w-16 flex-shrink-0">AI-Signals</span>
                    <div className="flex flex-wrap gap-1.5">
                      {enriched.map((badge, i) => (
                        <span key={i} title={badge.title} className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${badge.cls}`}>
                          {badge.icon} {badge.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Actions column — always visible */}
              <div className="flex flex-row gap-2 flex-shrink-0 items-center">
                {/* LinkedIn — branded icon button */}
                <a
                  href={candidate.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View LinkedIn profile"
                  className="w-7 h-7 rounded-md bg-[#0a66c2] hover:bg-[#0958a8] flex items-center justify-center transition-colors flex-shrink-0"
                >
                  <LinkedInIcon className="w-3.5 h-3.5 fill-white" />
                </a>

                {/* AI Phone Screen */}
                <div className="relative group/phone flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setInterviewQueued(q => !q)}
                    className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors border relative ${
                      interviewQueued
                        ? 'bg-violet-600 border-violet-500 text-white'
                        : 'border-emerald-800 text-emerald-600 hover:border-emerald-500 hover:text-emerald-400 hover:bg-emerald-950/40'
                    }`}
                  >
                    {/* Phone + sparkle to signal AI */}
                    <svg viewBox="0 0 24 24" className="w-3 h-3 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6.06 6.06l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2z" />
                    </svg>
                    {/* AI sparkle badge */}
                    <span className={`absolute -top-1 -right-1 text-[8px] leading-none ${interviewQueued ? 'text-violet-200' : 'text-emerald-400'}`}>✦</span>
                  </button>
                  {/* Hover tooltip */}
                  <div className="pointer-events-none absolute bottom-full right-0 mb-1.5 opacity-0 group-hover/phone:opacity-100 transition-opacity duration-150">
                    <div className={`whitespace-nowrap text-[10px] font-semibold px-2 py-1 rounded-md ${interviewQueued ? 'bg-violet-600 text-white' : 'bg-[#2d333b] text-gray-300'}`}>
                      {interviewQueued ? 'Queued for AI screen' : 'AI Phone Screen'}
                    </div>
                  </div>
                </div>
              </div>

            </div>

          </div>
        </div>
      </div>

      {/* Strength bar */}
      <div className="h-[3px] w-full bg-[#2d333b]">
        <div
          className={`h-full bg-gradient-to-r transition-all duration-500 ${matchLabel.barCls}`}
          style={{ width: `${Math.round(relStrength * 100)}%` }}
        />
      </div>
    </div>
  );
}
