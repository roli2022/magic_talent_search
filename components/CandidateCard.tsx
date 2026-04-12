'use client';

import { useState, useEffect, useRef } from 'react';
import { buildCriteriaMatches, computeWeightedMatchScore, type CriterionImportance } from '@/lib/criteriaMatching';

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
    badges.push({ icon: '🟢', label: 'Stable', cls: 'bg-[#d7f5ea] text-[#0f8e61] border-[#b5e9d6]', title: 'Low mobility likelihood' });
  } else if (c.mobility_likelihood === 'high') {
    badges.push({ icon: '🔴', label: 'Likely to move', cls: 'bg-[#ffe3e3] text-[#d9485f] border-[#ffc5cc]', title: 'High mobility likelihood' });
  } else if (c.mobility_likelihood === 'medium') {
    badges.push({ icon: '🟡', label: 'May move', cls: 'bg-[#fff0bf] text-[#af7c05] border-[#ffe08b]', title: 'Medium mobility likelihood' });
  }

  if (c.avg_tenure_years != null) {
    badges.push({ icon: '⏱', label: `${c.avg_tenure_years}yr avg tenure`, cls: 'bg-[#edf4f7] text-[#557086] border-[#d5e1e6]' });
  }

  if (c.is_outlier) {
    badges.push({ icon: '⭐', label: 'Outlier', cls: 'bg-[#fff0bf] text-[#a16207] border-[#f6d878]', title: c.outlier_reason || 'Exceptional candidate' });
  }

  if (c.builder_score != null && c.builder_score >= 6) {
    badges.push({ icon: '🔨', label: `Builder ${c.builder_score}/10`, cls: 'bg-[#ffe0d1] text-[#de5320] border-[#ffc8b1]', title: c.builder_evidence || undefined });
  }

  if (c.top_school) {
    const label = c.school_tier === 'tier_1' ? 'IIT/IIM' : c.has_mba ? 'Top MBA' : 'Top school';
    badges.push({ icon: '🎓', label, cls: 'bg-[#dbeafe] text-[#2563eb] border-[#b9d5fb]' });
  }

  if (c.is_founder) {
    badges.push({ icon: '🚀', label: 'Founded a co.', cls: 'bg-[#ffe0d1] text-[#de5320] border-[#ffc8b1]' });
  }

  if (c.has_0_to_1_exp && !c.is_founder) {
    badges.push({ icon: '⚡', label: 'Built 0-to-1', cls: 'bg-[#fff0bf] text-[#af7c05] border-[#ffe08b]' });
  }

  return badges.slice(0, 5);
}

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
  query,
  maxRelevanceScore,
  minRelevanceScore,
  criteria = [],
  criterionImportance = [],
  selectedCriterion = null,
}: {
  candidate: Candidate;
  query?: string;
  maxRelevanceScore?: number;
  minRelevanceScore?: number;
  criteria?: string[];
  criterionImportance?: CriterionImportance[];
  selectedCriterion?: number | null;
}) {
  const topExp      = candidate.top_experience?.[0];

  const [summary, setSummary]               = useState('');
  const [sumDone, setSumDone]               = useState(false);
  const [sumLoading, setSumLoading]         = useState(false);
  const [interviewQueued, setInterviewQueued] = useState(false);
  const fetchedRef = useRef(false);

  function renderSummary(text: string) {
    const parts = text.split(/\*\*(.+?)\*\*/g);
    return parts.map((part, i) =>
      i % 2 === 1
        ? <span key={i} className="text-[#163a59] font-semibold">{part}</span>
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

  const criteriaMatches = buildCriteriaMatches(candidate, criteria);
  const enriched = buildEnrichedBadges(candidate);
  const weightedMatchScore = computeWeightedMatchScore(criteriaMatches, criterionImportance);
  const matchLabel =
    weightedMatchScore >= 75 ? { text: `${weightedMatchScore}%`, cls: 'bg-[#d7f5ea] text-[#0f8e61] border-[#b5e9d6]', borderCls: 'border-[#6ec7a1] hover:border-[#19b37d]', barCls: 'from-[#19b37d] to-[#74d7ad]' } :
    weightedMatchScore >= 50 ? { text: `${weightedMatchScore}%`, cls: 'bg-[#dbeafe] text-[#2563eb] border-[#bfd6ff]', borderCls: 'border-[#bfd6ff] hover:border-[#3b82f6]', barCls: 'from-[#3b82f6] to-[#67a0f8]' } :
                               { text: `${weightedMatchScore}%`, cls: 'bg-[#fff0bf] text-[#a16207] border-[#f4dc8c]', borderCls: 'border-[#f4dc8c] hover:border-[#ffc83d]', barCls: 'from-[#ffc83d] to-[#ffd86e]' };

  return (
    <div className={`rounded-[10px] border transition-all duration-200 overflow-hidden bg-[rgba(255,255,255,0.9)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_1px_0_rgba(19,33,46,0.03),0_18px_38px_rgba(19,33,46,0.08),0_34px_70px_rgba(19,33,46,0.04)] ${matchLabel.borderCls}`}>
      <div className="p-[18px]">
        <div className="flex items-start gap-3">

          {/* Avatar */}
          <div className="flex flex-col items-center gap-1.5 flex-shrink-0 w-11">
            <a href={candidate.url} target="_blank" rel="noopener noreferrer">
              {candidate.image_url ? (
                <img
                  src={candidate.image_url}
                  alt={candidate.name}
                  className="w-11 h-11 rounded-[8px] object-cover ring-1 ring-[#d5e1e6]"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="w-11 h-11 rounded-[8px] bg-[#edf4f7] text-[#7c8e99] flex items-center justify-center ring-1 ring-[#d5e1e6]">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
                    <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-3.33 0-6 1.79-6 4v1h12v-1c0-2.21-2.67-4-6-4z" />
                  </svg>
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
                  className="font-[820] text-[17px] tracking-[-0.03em] text-[#13212e] hover:text-[#163a59] transition-colors"
                >
                  {candidate.name}
                </a>
                {candidate.location && (
                  <span className="text-[#8698a4] text-[11px] ml-2">{candidate.location}</span>
                )}
              </div>
              <div className={`flex-shrink-0 text-[16px] font-black px-4 py-2 rounded-[8px] border tracking-[-0.03em] leading-none ${matchLabel.cls}`}>
                {matchLabel.text}
              </div>
            </div>

            {candidate.headline && (
              <p className="text-[13px] text-[#13212e] mt-1 line-clamp-1 font-medium">{candidate.headline}</p>
            )}

            {topExp && (
              <p className="text-[12px] text-[#587082] mt-1.5 leading-[1.4]">
                <span className="text-[#13212e] font-semibold">{topExp.title}</span>
                {topExp.company && <span> at {topExp.company}</span>}
                {topExp.date && <span className="text-[#8698a4]"> · {topExp.date}</span>}
              </p>
            )}

            {criteriaMatches.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[#e3edf1] flex items-start gap-2">
                <span className="text-[10px] font-bold text-[#163a59] mt-0.5 w-[110px] flex-shrink-0 uppercase tracking-[0.08em] whitespace-nowrap">Criteria Match</span>
                <div className="flex flex-wrap gap-1.5 min-w-0 flex-1">
                  {criteriaMatches.map((criterion, i) => {
                    const tone =
                      criterion.status === 'match'
                        ? 'bg-[#d7f5ea] text-[#0f8e61] border-[#b5e9d6]'
                        : criterion.status === 'partial'
                          ? 'bg-[#fff0bf] text-[#af7c05] border-[#ffe08b]'
                          : 'bg-[#ffe3e3] text-[#d9485f] border-[#ffc5cc]';
                    const isSelected = selectedCriterion === i;
                    return (
                      <span
                        key={i}
                        title={`${criterion.label}: ${criterion.reason}`}
                        className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border font-semibold transition-all ${tone} ${isSelected ? 'ring-2 ring-[#163a59] ring-offset-1 scale-[1.03]' : ''}`}
                      >
                        C{i + 1}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {enriched.length > 0 && (
              <div className="mt-3 rounded-[12px] border border-[rgba(255,179,102,0.45)] bg-[linear-gradient(135deg,rgba(255,244,214,0.96),rgba(255,233,215,0.96)_45%,rgba(223,240,255,0.92))] px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.52)]">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="w-[30px] h-[30px] rounded-[9px] bg-[linear-gradient(135deg,#ffd66b,#ff8e42_50%,#1f7cf0)] flex items-center justify-center text-[15px] shadow-[0_8px_18px_rgba(19,33,46,0.12)] border border-[rgba(255,255,255,0.65)] flex-shrink-0">
                    🧙‍♀️
                  </div>
                  <span className="text-[10px] font-bold text-[#163a59] uppercase tracking-[0.08em] whitespace-nowrap flex-shrink-0">AI read</span>
                  <div className="flex flex-wrap gap-1.5 min-w-0 flex-1">
                    {enriched.map((badge, i) => (
                      <span key={i} title={badge.title} className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border ${badge.cls}`}>
                        {badge.icon} {badge.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* AI Summary */}
            <div className="mt-3 pt-3 border-t border-[#e3edf1]">
              {sumLoading && !summary && (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse" />
                  <span className="text-[11px] text-[#8698a4]">I&apos;m reading the fit…</span>
                </div>
              )}
              {summary && (
                <p className="text-[13px] text-[#587082] leading-[1.55]">
                  {sumDone ? renderSummary(summary) : summary}
                </p>
              )}
            </div>

            {/* Assistant actions */}
            <div className="mt-3 pt-3 border-t border-[#e3edf1] flex items-start gap-3">
              <span className="text-[10px] font-bold text-[#163a59] mt-1 w-[110px] flex-shrink-0 uppercase tracking-[0.08em] whitespace-nowrap">Next steps</span>
              <div className="flex flex-row gap-2 flex-wrap items-center">
                {/* LinkedIn — branded icon button */}
                <a
                  href={candidate.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View LinkedIn profile"
                  className="w-7 h-7 rounded-[8px] bg-[#0a66c2] hover:bg-[#0958a8] flex items-center justify-center transition-colors flex-shrink-0"
                >
                  <LinkedInIcon className="w-3.5 h-3.5 fill-white" />
                </a>

                {/* AI Phone Screen */}
                <div className="relative group/phone flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setInterviewQueued(q => !q)}
                    className={`w-7 h-7 rounded-[8px] flex items-center justify-center transition-colors border relative ${
                      interviewQueued
                        ? 'bg-[#163a59] border-[#163a59] text-white'
                        : 'border-[#cad9df] text-[#587082] hover:border-[#19b37d] hover:text-[#0f8e61] hover:bg-[#d7f5ea]'
                    }`}
                  >
                    {/* Phone + sparkle to signal AI */}
                    <svg viewBox="0 0 24 24" className="w-3 h-3 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6.06 6.06l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2z" />
                    </svg>
                    {/* AI sparkle badge */}
                    <span className={`absolute -top-1 -right-1 text-[8px] leading-none ${interviewQueued ? 'text-white' : 'text-[#19b37d]'}`}>✦</span>
                  </button>
                  {/* Hover tooltip */}
                  <div className="pointer-events-none absolute bottom-full right-0 mb-1.5 opacity-0 group-hover/phone:opacity-100 transition-opacity duration-150">
                    <div className={`whitespace-nowrap text-[10px] font-semibold px-2 py-1 rounded-[8px] ${interviewQueued ? 'bg-[#163a59] text-white' : 'bg-[#13212e] text-white'}`}>
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
      <div className="h-[3px] w-full bg-[#e8eef1]">
        <div
          className={`h-full bg-gradient-to-r transition-all duration-500 ${matchLabel.barCls}`}
          style={{ width: `${weightedMatchScore}%` }}
        />
      </div>
    </div>
  );
}
