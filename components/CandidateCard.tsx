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
}

const AVATAR_COLORS = [
  'bg-violet-900 text-violet-300',
  'bg-blue-900 text-blue-300',
  'bg-emerald-900 text-emerald-300',
  'bg-amber-900 text-amber-300',
  'bg-rose-900 text-rose-300',
  'bg-cyan-900 text-cyan-300',
];

export default function CandidateCard({
  candidate,
  rank,
  query,
  maxRelevanceScore,
  minRelevanceScore,
}: {
  candidate: Candidate;
  rank: number;
  query?: string;
  maxRelevanceScore?: number;
  minRelevanceScore?: number;
}) {
  const topExp      = candidate.top_experience?.[0];
  const avatarColor = AVATAR_COLORS[(candidate.name?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];

  // Relative strength within the pool
  const baseScore    = candidate.relevanceScore ?? candidate.similarity;
  const scoreRange   = (maxRelevanceScore ?? 1) - (minRelevanceScore ?? 0);
  const normStrength = scoreRange > 0
    ? Math.min((baseScore - (minRelevanceScore ?? 0)) / scoreRange, 1)
    : 1;
  const relStrength  = maxRelevanceScore ? Math.min(baseScore / maxRelevanceScore, 1) : 1;

  const matchLabel =
    normStrength >= 0.75 ? { text: 'Excellent', cls: 'bg-amber-900/60 text-amber-300 border-amber-700/60', borderCls: 'border-amber-700/50 hover:border-amber-500/70', barCls: 'from-amber-600 to-amber-400'    } :
    normStrength >= 0.50 ? { text: 'Strong',    cls: 'bg-slate-600/40 text-slate-100 border-slate-400/70', borderCls: 'border-slate-500/40 hover:border-slate-400/70', barCls: 'from-slate-400 to-slate-300'    } :
    normStrength >= 0.25 ? { text: 'OK',        cls: 'bg-pink-950/60  text-pink-300  border-pink-800/50',  borderCls: 'border-pink-900/50  hover:border-pink-700/60',  barCls: 'from-pink-700  to-pink-500'     } :
                           { text: 'Partial',   cls: 'bg-blue-950/70  text-blue-300  border-blue-800/60',  borderCls: 'border-blue-900/50  hover:border-blue-700/60',  barCls: 'from-blue-700  to-blue-500'     };

  // ── AI summary streaming ────────────────────────────────────────────────────
  const [summary, setSummary]       = useState('');
  const [sumDone, setSumDone]       = useState(false);
  const [sumLoading, setSumLoading] = useState(false);
  const fetchedRef = useRef(false);

  // Parse **bold** markers into cyan highlighted spans
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
  }, [query]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`bg-[#1c2128] rounded-2xl border transition-all duration-200 shadow-md shadow-black/30 overflow-hidden ${matchLabel.borderCls}`}>
      <div className="p-5">
        <div className="flex items-start gap-4">

          {/* Rank + Avatar column */}
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

              {/* Match label badge */}
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
          </div>
        </div>
      </div>

      {/* Relative strength bar — colour matches match tier */}
      <div className="h-[3px] w-full bg-[#2d333b]">
        <div
          className={`h-full bg-gradient-to-r transition-all duration-500 ${matchLabel.barCls}`}
          style={{ width: `${Math.round(relStrength * 100)}%` }}
        />
      </div>
    </div>
  );
}
