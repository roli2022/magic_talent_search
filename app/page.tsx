'use client';

import { useState, useRef, useEffect } from 'react';
import CandidateCard from '@/components/CandidateCard';
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
  // enriched fields
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
  builder_score?: number | null;
  builder_evidence?: string | null;
  ownership_score?: number | null;
  is_outlier?: boolean | null;
  outlier_reason?: string | null;
  primary_function?: string | null;
  location_city?: string | null;
}

type Stage = 'intro' | 'nudging' | 'confirming' | 'results' | 'refining';
type IntroTab = 'type' | 'jd';

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

const SEARCH_STATUS_MESSAGES = [
  'I’m looking across the pool for the strongest fits.',
  'I’m checking who matches the brief most cleanly.',
  'I’m narrowing this down into a workable shortlist.',
  'I’m comparing criteria match with the AI read.',
  'I’m pulling the most promising profiles to the top.',
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

function buildCriteriaFromQuery(query: string): string[] {
  const normalized = query.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const parts = normalized
    .replace(/\n+/g, ' ')
    .split(/(?<=[.?!])\s+|(?=Must-have:)/)
    .map(part => part.trim())
    .filter(Boolean);

  const cleanPart = (part: string) =>
    part
      .trim()
      .replace(/\.$/, '')
      .replace(/^ideally\s+/i, 'Ideally ')
      .replace(/^who has\s+/i, 'Has ')
      .replace(/^who can\s+/i, 'Can ')
      .replace(/^who is\s+/i, 'Is ')
      .replace(/^with\s+(\d+\+?\s+years?.*)/i, 'Has $1')
      .replace(/^background in\s+/i, 'Background in ')
      .replace(/^experience in\s+/i, 'Experience in ');

  const criteria = parts.flatMap((part) => {
    if (/^(Based in|Also strong in|Education:|Must-have:|Non-negotiable requirement:)/i.test(part)) {
      return [cleanPart(part)];
    }

    const clauseParts = part
      .split(/,\s+|\s+(?=who\s+(?:has|can|is)\b)/i)
      .map(cleanPart)
      .filter(Boolean);

    return clauseParts.length > 0 ? clauseParts : [cleanPart(part)];
  });

  return criteria.reduce<string[]>((acc, part) => {
    if (!part) return acc;
    if (part.startsWith('Candidates who do not meet this should not be considered') && acc.length > 0) {
      acc[acc.length - 1] = `${acc[acc.length - 1]}. ${part}`;
      return acc;
    }
    acc.push(part);
    return acc;
  }, []);
}

function buildCriteriaFromDescribeRoleInputs(
  mainQuery: string,
  fields: Record<string, string>,
  fallbackQuery: string
): string[] {
  const criteria: string[] = [];
  const seen = new Set<string>();

  const pushUnique = (value: string) => {
    const cleaned = value.trim().replace(/\s+/g, ' ').replace(/\.$/, '');
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    criteria.push(cleaned);
  };

  const normalizedMain = mainQuery.trim().replace(/\s+/g, ' ');
  if (normalizedMain) {
    const roleFirst = normalizedMain
      .split(/,\s+|\s+\band\b\s+|\s+with\s+(?=\d+\+?\s+years?|\d+\s+years?)/i)[0]
      .trim();
    pushUnique(roleFirst || normalizedMain);

    normalizedMain
      .split(/,\s+|\s+\band\b\s+/i)
      .slice(1)
      .map(part => part.trim())
      .filter(part => {
        const lower = part.toLowerCase();
        if (!lower) return false;
        if (fields.experience?.trim() && (lower.includes('year') || lower.includes(fields.experience.trim().toLowerCase()))) return false;
        if (fields.location?.trim() && lower.includes(fields.location.trim().toLowerCase())) return false;
        if (fields.education?.trim() && lower.includes(fields.education.trim().toLowerCase())) return false;
        if (fields.skills?.trim() && lower.includes(fields.skills.trim().toLowerCase())) return false;
        if (fields.musthave?.trim() && lower.includes(fields.musthave.trim().toLowerCase())) return false;
        return true;
      })
      .forEach(pushUnique);
  }

  if (fields.experience?.trim()) {
    const experience = fields.experience.trim();
    pushUnique(/^\d+\+?\s+years?/i.test(experience) ? `Has ${experience}` : experience);
  }
  if (fields.location?.trim()) pushUnique(`Based in ${fields.location.trim()}`);
  if (fields.skills?.trim()) pushUnique(`Also strong in ${fields.skills.trim()}`);
  if (fields.education?.trim()) pushUnique(`Education: ${fields.education.trim()}`);
  if (fields.musthave?.trim()) {
    pushUnique(`Must-have: ${fields.musthave.trim()}`);
  }

  if (criteria.length <= 1 && fallbackQuery.trim()) {
    buildCriteriaFromQuery(fallbackQuery).forEach(pushUnique);
  }

  return criteria;
}

function buildShortCriterionLabel(criterion: string): string {
  const lower = criterion.toLowerCase().trim();

  const yearsMatch = criterion.match(/(\d+\+?)\s*years?/i);
  if (yearsMatch) {
    if (lower.includes('product')) return `${yearsMatch[1]} years PM`;
    return `${yearsMatch[1]} years`;
  }

  if (lower.includes('bengaluru') || lower.includes('bangalore')) return 'Bengaluru';
  if (lower.includes('mumbai')) return 'Mumbai';
  if (lower.includes('delhi')) return 'Delhi NCR';
  if (lower.includes('remote')) return 'Remote';
  if (lower.includes('node')) return 'Node.js backend';
  if (lower.includes('javascript') || lower.includes('front-end') || lower.includes('frontend')) return 'JavaScript + FE';
  if (lower.includes('sql') || lower.includes('nosql') || lower.includes('database')) return 'Databases';
  if (lower.includes('fintech') || lower.includes('enterprise')) return 'Fintech / enterprise';
  if (lower.includes('b2b saas')) return 'B2B SaaS';
  if (lower.includes('team') || lower.includes('leadership')) return 'Team leadership';
  if (lower.includes('stakeholder')) return 'Stakeholder mgmt';
  if (lower.includes('degree') || lower.includes('education') || lower.includes('computer science')) return 'Education';
  if (lower.includes('0 to 1') || lower.includes('0-to-1')) return '0-to-1 build';
  if (lower.includes('product manager')) return 'Product manager';

  return criterion
    .replace(/^based in\s+/i, '')
    .replace(/^also strong in\s+/i, '')
    .replace(/^education:\s+/i, '')
    .replace(/^must-have:\s+/i, '')
    .replace(/^has\s+/i, '')
    .replace(/^experience with\s+/i, '')
    .replace(/^experience in\s+/i, '')
    .replace(/^strong\s+/i, '')
    .split(/[,.]/)[0]
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(' ');
}

function AssistantAvatar({
  size = 'md',
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizeClass =
    size === 'lg'
      ? 'w-16 h-16 rounded-[18px] text-[30px]'
      : size === 'sm'
        ? 'w-10 h-10 rounded-[12px] text-[20px]'
        : 'w-12 h-12 rounded-[14px] text-[24px]';

  return (
    <div className={`relative flex-shrink-0 ${className}`}>
      <div
        className={`${sizeClass} bg-gradient-to-br from-[#ffd66b] via-[#ff8e42] to-[#1f7cf0] flex items-center justify-center shadow-[0_14px_34px_rgba(19,33,46,0.12)] ring-1 ring-white/70`}
      >
        <span className="translate-y-[1px]">🧙‍♀️</span>
      </div>
      <div className="absolute -right-1 -bottom-1 w-5 h-5 rounded-full bg-white border border-[#d7e4ea] shadow-[0_8px_16px_rgba(19,33,46,0.08)] flex items-center justify-center text-[11px]">
        ✨
      </div>
    </div>
  );
}

export default function SearchPage() {
  const MAX_CRITERIA = 8;
  type SearchHistoryEntry = {
    label: string;
    query: string;
    mustHave: string;
    type: 'new' | 'refined';
    criteria: string[];
    importance: CriterionImportance[];
  };
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
  const [searchHistory, setSearchHistory]   = useState<SearchHistoryEntry[]>([]);
  const [expandedHistory, setExpandedHistory] = useState<string[]>([]);
  const [selectedCriterion, setSelectedCriterion] = useState<number | null>(null);
  const [guidanceExpanded, setGuidanceExpanded] = useState(false);
  const [criteriaExpanded, setCriteriaExpanded] = useState(false);
  const [loadingStatusIndex, setLoadingStatusIndex] = useState(0);
  const [hasSearched, setHasSearched]       = useState(false);
  const [activeFilters, setActiveFilters]   = useState<Record<string, unknown>>({});

  const [refinementInput, setRefinementInput] = useState('');

  // JD upload state
  const [introTab, setIntroTab]             = useState<IntroTab>('jd');
  const [jdFile, setJdFile]                 = useState<File | null>(null);
  const [jdDragging, setJdDragging]         = useState(false);
  const [jdParsing, setJdParsing]           = useState(false);
  const [jdRequirements, setJdRequirements] = useState<string[]>([]);
  const [jdError, setJdError]               = useState<string | null>(null);
  const [jdRebuilding, setJdRebuilding]     = useState(false);
  const [jdNewRequirement, setJdNewRequirement] = useState('');
  const [jdNewRequirementImportance, setJdNewRequirementImportance] = useState<CriterionImportance>('regular');
  const [criterionImportance, setCriterionImportance] = useState<CriterionImportance[]>([]);
  const jdInputRef = useRef<HTMLInputElement>(null);

  const nudgeInputRef  = useRef<HTMLInputElement>(null);
  const confirmRef     = useRef<HTMLTextAreaElement>(null);
  const refineRef      = useRef<HTMLInputElement>(null);
  const rightPanelRef  = useRef<HTMLDivElement>(null);

  // Stay split once first search has run — only centered on fresh page load
  const isSplit = hasSearched || loading || stage === 'results' || stage === 'refining' || (results.length > 0 && (stage === 'confirming' || stage === 'nudging'));

  // Nudges filtered to only those not already covered by the initial query
  const activeNudges = NUDGES.filter(n => !detectedFields[n.key]);

  useEffect(() => {
    if (stage === 'nudging') nudgeInputRef.current?.focus();
  }, [stage, activeNudge]);

  useEffect(() => {
    if (stage === 'confirming') confirmRef.current?.focus();
  }, [stage]);

  useEffect(() => {
    if (stage === 'refining') refineRef.current?.focus();
  }, [stage]);

  useEffect(() => {
    if (!loading) {
      setLoadingStatusIndex(0);
      return;
    }

    const timer = window.setInterval(() => {
      setLoadingStatusIndex(prev => (prev + 1) % SEARCH_STATUS_MESSAGES.length);
    }, 1800);

    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    if (stage !== 'confirming' || introTab !== 'type' || jdRequirements.length > 0 || !finalQuery.trim()) return;
    const describeRoleCriteria = buildCriteriaFromDescribeRoleInputs(
      mainQuery,
      { ...detectedFields, ...values },
      finalQuery
    ).slice(0, MAX_CRITERIA);
    setJdRequirements(describeRoleCriteria);
    setCriterionImportance(describeRoleCriteria.map(() => 'regular'));
    setJdNewRequirement('');
  }, [stage, introTab, jdRequirements.length, finalQuery, mainQuery, detectedFields, values, MAX_CRITERIA]);

  async function handleRefine(e: React.FormEvent) {
    e.preventDefault();
    if (!refinementInput.trim()) return;
    setLoading(true);
    setError(null);
    setStage('results');
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: refinementInput.trim(),
          previousQuery: rewrittenQuery || finalQuery,
          mustHave: values.musthave || detectedFields.musthave || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      const rq = data.rewrittenQuery || refinementInput;
      setResults(data.results);
      setRewrittenQuery(rq);
      setFinalQuery(rq);
      setPoolMinScore(data.poolMinScore ?? 0);
      setPoolMaxScore(data.poolMaxScore ?? 1);
      setActiveFilters(data.filters ?? {});
      setPage(1);
      setRefinementInput('');
      rightPanelRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      setSearchHistory(prev => {
        const criteria = buildCriteriaFromQuery(rq).slice(0, MAX_CRITERIA);
        const entry = {
          label: rq,
          query: rq,
          mustHave: '',
          type: 'refined' as const,
          criteria,
          importance: criteria.map(() => 'regular' as CriterionImportance),
        };
        const deduped = prev.filter(h => h.query !== rq);
        return [entry, ...deduped].slice(0, 3);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleIntroSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mainQuery.trim()) return;
    setJdRequirements([]);
    setCriterionImportance([]);
    setJdNewRequirement('');
    setJdNewRequirementImportance('regular');
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

  async function handleJdParse(file: File) {
    setJdFile(file);
    setJdParsing(true);
    setJdError(null);
    setJdRequirements([]);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/parse-jd', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse JD');
      const requirements = data.requirements || [];
      setJdRequirements(requirements);
      setCriterionImportance(requirements.map(() => 'regular'));
      setJdNewRequirementImportance('regular');
      setFinalQuery(data.query || '');
      setStage('confirming');
    } catch (err) {
      setJdError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setJdParsing(false);
    }
  }

  async function rebuildQueryFromRequirements(requirements: string[]) {
    const cleaned = requirements.map(r => r.trim()).filter(Boolean);
    if (cleaned.length === 0) return '';

    const res = await fetch('/api/rebuild-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirements: cleaned }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to rebuild query');
    return data.query || '';
  }

  async function handleDeleteRequirement(index: number) {
    const remaining = jdRequirements.filter((_, i) => i !== index);
    setJdRequirements(remaining);
    setCriterionImportance(prev => prev.filter((_, i) => i !== index));
    if (remaining.length === 0) {
      setFinalQuery('');
      return;
    }
    setJdRebuilding(true);
    try {
      const query = await rebuildQueryFromRequirements(remaining);
      setFinalQuery(query);
    } catch { /* keep existing query on failure */ }
    finally { setJdRebuilding(false); }
  }

  function handleUpdateRequirement(index: number, value: string) {
    setJdRequirements(prev => prev.map((req, i) => (i === index ? value : req)));
  }

  function handleUpdateImportance(index: number, value: CriterionImportance) {
    setCriterionImportance(prev => prev.map((importance, i) => (i === index ? value : importance)));
  }

  function handleAddRequirement() {
    const next = jdNewRequirement.trim();
    if (!next) return;
    if (jdRequirements.length >= MAX_CRITERIA) return;
    setJdRequirements(prev => [...prev, next]);
    setCriterionImportance(prev => [...prev, jdNewRequirementImportance]);
    setJdNewRequirement('');
    setJdNewRequirementImportance('regular');
  }

  function openCriteriaConfirmation(query: string, criteriaOverride?: string[], importanceOverride?: CriterionImportance[]) {
    const currentQuery = query.trim();
    const nextCriteria = (criteriaOverride && criteriaOverride.length > 0
      ? criteriaOverride
      : buildCriteriaFromQuery(currentQuery)
    ).slice(0, MAX_CRITERIA);
    if (!currentQuery && nextCriteria.length === 0) return;
    setError(null);
    setFinalQuery(currentQuery);
    setJdRequirements(nextCriteria);
    const nextImportance: CriterionImportance[] = (
      importanceOverride && importanceOverride.length > 0
        ? importanceOverride
        : nextCriteria.map(() => 'regular' as CriterionImportance)
    ).slice(0, nextCriteria.length);
    setCriterionImportance(
      nextImportance
    );
    setJdNewRequirement('');
    setJdNewRequirementImportance('regular');
    setSelectedCriterion(null);
    setStage('confirming');
  }

  function buildHistoryCriteria(query: string): string[] {
    if (jdRequirements.length > 0) return jdRequirements.slice(0, MAX_CRITERIA);
    if (introTab === 'type') {
      return buildCriteriaFromDescribeRoleInputs(mainQuery, { ...detectedFields, ...values }, query).slice(0, MAX_CRITERIA);
    }
    return buildCriteriaFromQuery(query).slice(0, MAX_CRITERIA);
  }

  function summarizeCriteria(criteria: string[]) {
    if (criteria.length === 0) return 'No saved criteria';
    if (criteria.length === 1) return criteria[0];
    return `${criteria[0]} + ${criteria.length - 1} more`;
  }

  function handleRefineSearch() {
    openCriteriaConfirmation(rewrittenQuery || finalQuery, jdRequirements, criterionImportance);
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
    let q  = queryOverride  ?? finalQuery;
    const mh = mustHaveOverride ?? (values.musthave || detectedFields.musthave || '');
    setLoading(true);
    setError(null);
    if (queryOverride) { setFinalQuery(queryOverride); setStage('confirming'); }
    try {
      if (!queryOverride && jdRequirements.length > 0) {
        const cleanedRequirements = jdRequirements.map(r => r.trim()).filter(Boolean);
        if (!cleanedRequirements.length) return;
        setJdRebuilding(true);
        try {
          q = await rebuildQueryFromRequirements(cleanedRequirements);
          setFinalQuery(q);
        } finally {
          setJdRebuilding(false);
        }
      }
      if (!q.trim()) return;
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
      setActiveFilters(data.filters ?? {});
      setPage(1);
      setHasSearched(true);
      setStage('results');
      // Record in history (dedup, keep last 5)
      setSearchHistory(prev => {
        const criteria = buildHistoryCriteria(q);
        const entry = {
          label: rq,
          query: q,
          mustHave: mh,
          type: 'new' as const,
          criteria,
          importance: criterionImportance.slice(0, criteria.length),
        };
        const deduped = prev.filter(h => h.query !== q);
        return [entry, ...deduped].slice(0, 3);
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
    setJdFile(null);
    setJdRequirements([]);
    setJdError(null);
    setJdNewRequirement('');
    setCriterionImportance([]);
    setSelectedCriterion(null);
  }

  const composed = buildComposed(mainQuery, { ...values, [activeNudges[activeNudge]?.key]: nudgeInput });
  const nudge    = activeNudges[activeNudge];
  const resultsCriteria = (() => {
    if (jdRequirements.length > 0) return jdRequirements;
    if (introTab === 'type') {
      return buildCriteriaFromDescribeRoleInputs(mainQuery, { ...detectedFields, ...values }, rewrittenQuery || finalQuery).slice(0, MAX_CRITERIA);
    }
    return buildCriteriaFromQuery(rewrittenQuery || finalQuery).slice(0, MAX_CRITERIA);
  })();
  const effectiveImportance = resultsCriteria.map((_, i) => criterionImportance[i] ?? 'regular');
  const filledCriteriaCount = jdRequirements.filter(req => req.trim()).length;

  useEffect(() => {
    setGuidanceExpanded(false);
    setCriteriaExpanded(false);
  }, [rewrittenQuery, finalQuery]);

  // Filter out results below 30% relative strength within the pool
  const scoreRange = poolMaxScore - poolMinScore;
  const visibleResults = results
    .filter(c => {
      const base = c.relevanceScore ?? c.similarity;
      const norm = scoreRange > 0 ? Math.min((base - poolMinScore) / scoreRange, 1) : 1;
      return norm >= 0.30;
    })
    .sort((a, b) => {
      const aScore = computeWeightedMatchScore(buildCriteriaMatches(a, resultsCriteria), effectiveImportance);
      const bScore = computeWeightedMatchScore(buildCriteriaMatches(b, resultsCriteria), effectiveImportance);
      if (bScore !== aScore) return bScore - aScore;
      return (b.relevanceScore ?? b.similarity) - (a.relevanceScore ?? a.similarity);
    });
  const resultGuidance = (() => {
    if (resultsCriteria.length === 0 || visibleResults.length === 0) return null;
    const sample = visibleResults.slice(0, Math.min(8, visibleResults.length));
    const stats = resultsCriteria.map((criterion, index) => {
      const matches = sample.map(candidate => buildCriteriaMatches(candidate, [criterion])[0]);
      const avg = matches.reduce((sum, match) => sum + (match.status === 'match' ? 1 : match.status === 'partial' ? 0.5 : 0), 0) / sample.length;
      return { index, criterion, importance: effectiveImportance[index], avg };
    });

    const weakHigh = [...stats]
      .filter(item => item.importance === 'high')
      .sort((a, b) => a.avg - b.avg)[0];
    const strongest = [...stats].sort((a, b) => b.avg - a.avg)[0];
    const weakest = [...stats].sort((a, b) => a.avg - b.avg)[0];
    const strongCount = visibleResults.filter(candidate => {
      const matches = buildCriteriaMatches(candidate, resultsCriteria);
      return computeWeightedMatchScore(matches, effectiveImportance) >= 75;
    }).length;
    const promisingCount = visibleResults.filter(candidate => {
      const matches = buildCriteriaMatches(candidate, resultsCriteria);
      const score = computeWeightedMatchScore(matches, effectiveImportance);
      return score >= 55 && score < 75;
    }).length;

    const headline =
      weakHigh && weakHigh.avg < 0.45
        ? `High-priority ${`C${weakHigh.index + 1}`} is filtering hard across the current pool.`
        : weakest && weakest.avg < 0.3
          ? `${`C${weakest.index + 1}`} looks over-constraining for this market.`
          : `The current brief is landing best on ${`C${strongest.index + 1}`}.`;

    const bullets = [
      weakHigh && weakHigh.avg < 0.45
        ? `Consider relaxing or clarifying C${weakHigh.index + 1} before widening the search.`
        : `Keep C${strongest.index + 1} anchored — it is showing the clearest signal across top candidates.`,
      strongest && weakest && strongest.index !== weakest.index
        ? `Top candidates are consistently stronger on C${strongest.index + 1} than on C${weakest.index + 1}.`
        : `Use criterion weights to tell the system what should matter most in ranking.`,
    ];

    const cards = [
      {
        tone: 'lead' as const,
        eyebrow: 'What I’m seeing',
        title: headline,
        body: bullets[0],
      },
      {
        tone: 'neutral' as const,
        eyebrow: 'Pipeline snapshot',
        title: `${strongCount} strong fit${strongCount === 1 ? '' : 's'} · ${promisingCount} promising`,
        body: strongCount > 0
          ? 'You have a workable shortlist now. Review the strongest lane before widening the search.'
          : 'This is still more of a calibration pass. The top group is promising, but the brief is holding the pool tight.',
      },
      {
        tone: weakHigh && weakHigh.avg < 0.45 ? 'warning' as const : 'neutral' as const,
        eyebrow: 'Main constraint',
        title: weakHigh && weakHigh.avg < 0.45
          ? `C${weakHigh.index + 1} is the main narrowing factor`
          : `C${weakest.index + 1} is the hardest criterion to satisfy`,
        body: weakHigh && weakHigh.avg < 0.45
          ? `If you need a wider pool, relax or rewrite C${weakHigh.index + 1} first.`
          : `Candidates are consistently weaker on C${weakest.index + 1} than on the rest of the brief.`,
      },
      {
        tone: 'success' as const,
        eyebrow: 'Best next move',
        title: strongCount > 0
          ? `Start with the top ${Math.min(strongCount, 8)} profiles`
          : 'Start with the promising band first',
        body: strongest && weakest && strongest.index !== weakest.index
          ? `Keep C${strongest.index + 1} anchored. It is doing the clearest sorting work right now.`
          : bullets[1],
      },
    ];

    return { cards };
  })();
  const showResultsOnlyLayout = stage === 'results' || loading;


  return (
    <div className="app-shell flex h-screen overflow-hidden">
      <div className="flow-lines" aria-hidden="true">
        <div className="flow-lines-top" />
        <div className="flow-lines-mid" />
        <div className="flow-lines-bottom" />
      </div>

      {/* ── LEFT PANEL ── */}
      <div
        className={`
          flex-shrink-0 transition-all duration-500 ease-in-out
          ${showResultsOnlyLayout
            ? 'w-0 overflow-hidden opacity-0 pointer-events-none'
            : isSplit
            ? 'w-2/5 border-r border-[#d7e4ea] overflow-y-auto flex flex-col justify-center relative z-10'
            : 'w-full h-full flex items-center justify-center overflow-y-auto relative z-10'
          }
        `}
      >
        <div
          className={`
            transition-all duration-500 ease-in-out px-8
            ${isSplit ? 'w-full py-14' : 'w-full max-w-xl py-0'}
          `}
        >

          {/* ── INTRO ── */}
          {stage === 'intro' && (
            <div className="flex flex-col gap-6">
              {/* Capsule */}
              <div className="inline-flex items-center gap-2 bg-[#d7f5ea] text-[#0f8e61] text-xs font-semibold px-3 py-1.5 rounded-full border border-[#b5e9d6] self-start">
                <span className="w-1.5 h-1.5 bg-[#19b37d] rounded-full" />
                100K+ candidates · India
              </div>

              {/* Avatar + title */}
              <div className="flex items-center gap-4">
                <AssistantAvatar size="lg" />
                <div>
                  <p className="text-[#587082] text-sm leading-none mb-1">Hi, I&apos;m your</p>
                  <h1 className="text-[28px] font-black tracking-[-0.05em] text-[#13212e] leading-tight whitespace-nowrap">
                    talent search partner, with a little magic <span className="text-[#ff6b2c]">✨</span>
                  </h1>
                </div>
              </div>

              {/* Tab toggle */}
              <div className="flex gap-1 bg-[rgba(255,255,255,0.74)] border border-[#d7e4ea] rounded-[10px] p-1 self-start shadow-[0_8px_22px_rgba(19,33,46,0.05)]">
                <button
                  type="button"
                  onClick={() => { setIntroTab('jd'); setJdError(null); }}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    introTab === 'jd'
                      ? 'bg-[#163a59] text-white'
                      : 'text-[#587082] hover:text-[#13212e]'
                  }`}
                >
                  Upload JD
                </button>
                <button
                  type="button"
                  onClick={() => setIntroTab('type')}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    introTab === 'type'
                      ? 'bg-[#163a59] text-white'
                      : 'text-[#587082] hover:text-[#13212e]'
                  }`}
                >
                  Describe role
                </button>
              </div>

              {/* ── Tab: Describe role ── */}
              {introTab === 'type' && (
                <form onSubmit={handleIntroSubmit} className="flex flex-col gap-3">
                  <label className="block text-sm font-medium text-[#587082]">
                    Tell me the role. I&apos;ll shape the search.
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
                    className="w-full bg-[rgba(255,255,255,0.84)] border border-[#cad9df] rounded-[10px] px-5 py-4 text-[15px] text-[#13212e] placeholder:text-[#8698a4] focus:outline-none focus:border-[#3b82f6] resize-none transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_14px_28px_rgba(19,33,46,0.05)]"
                    autoFocus
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={!mainQuery.trim() || analyzing}
                      className="bg-[#163a59] text-white px-6 py-2.5 rounded-[8px] text-sm font-bold hover:bg-[#0f2c44] disabled:opacity-30 transition-colors"
                    >
                      {analyzing ? 'Thinking…' : '🔍 Start search'}
                    </button>
                  </div>
                </form>
              )}

              {/* ── Tab: Upload JD ── */}
              {introTab === 'jd' && (
                <div className="flex flex-col gap-4">
                  <p className="text-sm text-[#587082]">
                    Upload the JD. I&apos;ll pull out the main criteria and search on that.
                  </p>

                  {/* Drop zone */}
                  <div
                    onClick={() => jdInputRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setJdDragging(true); }}
                    onDragLeave={() => setJdDragging(false)}
                    onDrop={e => {
                      e.preventDefault();
                      setJdDragging(false);
                      const f = e.dataTransfer.files[0];
                      if (f) handleJdParse(f);
                    }}
                    className={`
                      relative border-2 border-dashed rounded-2xl px-6 py-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors
                      ${jdDragging
                        ? 'border-[#3b82f6] bg-[rgba(255,255,255,0.8)]'
                        : jdFile
                          ? 'border-[#b5e9d6] bg-[rgba(255,255,255,0.8)]'
                          : 'border-[#cad9df] hover:border-[#9fb7c2] bg-[rgba(255,255,255,0.7)]'
                      }
                    `}
                  >
                    <input
                      ref={jdInputRef}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) handleJdParse(f);
                      }}
                    />

                    {jdParsing ? (
                      <>
                        <div className="w-8 h-8 rounded-full border-2 border-[#3b82f6] border-t-transparent animate-spin" />
                        <p className="text-sm text-[#163a59] font-medium">📄 I&apos;m reading the JD…</p>
                      </>
                    ) : jdFile && !jdError ? (
                      <>
                        <span className="text-3xl">📄</span>
                        <p className="text-sm text-[#163a59] font-medium text-center">{jdFile.name}</p>
                        <p className="text-xs text-[#8698a4]">Click to replace it</p>
                      </>
                    ) : (
                      <>
                        <span className="text-3xl text-[#8698a4]">📂</span>
                        <p className="text-sm text-[#587082] font-medium">Drop the PDF here or click to upload</p>
                        <p className="text-xs text-[#8698a4]">PDF only · max 10 MB</p>
                      </>
                    )}
                  </div>

                  {jdError && (
                    <div className="bg-[#ffe3e3] border border-[#ffc5cc] text-[#d9485f] rounded-[10px] px-4 py-3 text-sm">
                      {jdError}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── NUDGING ── */}
          {stage === 'nudging' && (
            <div>
              <button
                onClick={handleReset}
                className="text-xs text-[#8698a4] hover:text-[#13212e] mb-8 flex items-center gap-1 transition-colors"
              >
                ← Start over
              </button>

              <div className="bg-[rgba(255,255,255,0.82)] border border-[#d7e4ea] rounded-[10px] px-5 py-4 mb-8 shadow-[0_14px_28px_rgba(19,33,46,0.05)]">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#3b82f6] mb-1.5">
                  What I have so far
                </p>
                <p className="text-[#13212e] text-base leading-relaxed font-medium whitespace-pre-wrap">{composed}</p>
              </div>

              <form onSubmit={handleNudgeSubmit}>
                <label className="block text-xl font-bold tracking-[-0.03em] text-[#13212e] mb-4">
                  {nudge.question}
                </label>
                <input
                  ref={nudgeInputRef}
                  type="text"
                  value={nudgeInput}
                  onChange={e => setNudgeInput(e.target.value)}
                  placeholder={nudge.placeholder}
                  className="w-full bg-[rgba(255,255,255,0.84)] border border-[#cad9df] rounded-[10px] px-5 py-4 text-base text-[#13212e] placeholder:text-[#8698a4] focus:outline-none focus:border-[#3b82f6] mb-4 transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_14px_28px_rgba(19,33,46,0.05)]"
                />
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={!nudgeInput.trim()}
                    className="bg-[#163a59] text-white px-6 py-2.5 rounded-[8px] text-sm font-bold hover:bg-[#0f2c44] disabled:opacity-30 transition-colors"
                  >
                    {activeNudge < activeNudges.length - 1 ? 'Next →' : 'Review →'}
                  </button>
                  <button
                    type="button"
                    onClick={() => advanceNudge('')}
                    className="px-5 py-2.5 rounded-[8px] text-sm text-[#587082] border border-[#cad9df] hover:border-[#9fb7c2] hover:text-[#13212e] transition-colors bg-white/50"
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
                      i < activeNudge   ? 'bg-[#163a59]' :
                      i === activeNudge ? 'bg-[#3b82f6]' :
                      'bg-[#d5e1e6]'
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
                className="text-xs text-[#8698a4] hover:text-[#13212e] mb-8 flex items-center gap-1 transition-colors"
              >
                ← Start over
              </button>

              <p className="text-2xl font-black tracking-[-0.04em] text-[#13212e] mb-6">
                Here&apos;s how I&apos;m defining a great candidate.
              </p>

              {/* Criteria list */}
              {jdRequirements.length > 0 && (
                <div className="flex flex-col gap-2.5 mb-5">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8698a4] mb-1">
                    Edit, remove, or add criteria, then 🔍
                  </p>
                  {jdRequirements.map((req, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 bg-[rgba(255,255,255,0.82)] border border-[#d7e4ea] rounded-[10px] px-4 py-2.5 group"
                    >
                      <span className="text-[11px] font-semibold text-[#8698a4] w-6 flex-shrink-0 tabular-nums">
                        C{i + 1}
                      </span>
                      <input
                        type="text"
                        value={req}
                        onChange={(e) => handleUpdateRequirement(i, e.target.value)}
                        className="flex-1 bg-transparent text-sm text-[#13212e] placeholder:text-[#8698a4] focus:outline-none"
                      />
                      <div className="flex items-center p-0.5 rounded-full bg-[#edf4f7] border border-[#d7e4ea] flex-shrink-0">
                        {(['regular', 'high'] as CriterionImportance[]).map((level) => (
                          <button
                            key={level}
                            type="button"
                            onClick={() => handleUpdateImportance(i, level)}
                            className={`px-3 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                              (criterionImportance[i] ?? 'regular') === level
                                ? level === 'high'
                                  ? 'bg-[#146a55] text-white shadow-[0_6px_14px_rgba(20,106,85,0.22)]'
                                  : 'bg-white text-[#557086] shadow-[0_4px_10px_rgba(19,33,46,0.08)]'
                                : 'text-[#8698a4] hover:text-[#13212e]'
                            }`}
                          >
                            {level === 'high' ? 'Imp' : 'Reg'}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteRequirement(i)}
                        className="text-[#8698a4] hover:text-[#13212e] transition-colors flex-shrink-0 text-base leading-none"
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  {jdRequirements.length < MAX_CRITERIA ? (
                    <div className="flex items-center gap-3 bg-[rgba(255,255,255,0.7)] border border-dashed border-[#d7e4ea] rounded-[10px] px-4 py-2.5">
                      <span className="text-[11px] font-semibold text-[#8698a4] w-6 flex-shrink-0">
                        C{jdRequirements.length + 1}
                      </span>
                      <input
                        type="text"
                        value={jdNewRequirement}
                        onChange={(e) => setJdNewRequirement(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddRequirement();
                          }
                        }}
                        placeholder="Add one more criterion"
                        className="flex-1 bg-transparent text-sm text-[#13212e] placeholder:text-[#8698a4] focus:outline-none"
                      />
                      <div className="flex items-center p-0.5 rounded-full bg-[#edf4f7] border border-[#d7e4ea] flex-shrink-0">
                        {(['regular', 'high'] as CriterionImportance[]).map((level) => (
                          <button
                            key={level}
                            type="button"
                            onClick={() => setJdNewRequirementImportance(level)}
                            className={`px-3 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                              jdNewRequirementImportance === level
                                ? level === 'high'
                                  ? 'bg-[#146a55] text-white shadow-[0_6px_14px_rgba(20,106,85,0.22)]'
                                  : 'bg-white text-[#557086] shadow-[0_4px_10px_rgba(19,33,46,0.08)]'
                                : 'text-[#8698a4] hover:text-[#13212e]'
                            }`}
                          >
                            {level === 'high' ? 'Imp' : 'Reg'}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={handleAddRequirement}
                        disabled={!jdNewRequirement.trim()}
                        className="px-3 py-1.5 rounded-[8px] text-xs font-bold text-white bg-[#163a59] hover:bg-[#0f2c44] disabled:opacity-40 transition-colors"
                      >
                        Add
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-[#0f8e61]">
                      Max criteria reached
                    </p>
                  )}
                </div>
              )}

              {jdRequirements.length === 0 && (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8698a4]">
                      Search I&apos;ll run
                    </p>
                    {jdRebuilding && (
                      <span className="text-[11px] text-[#8698a4] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse inline-block" />
                        Updating…
                      </span>
                    )}
                  </div>
                  <textarea
                    ref={confirmRef}
                    value={finalQuery}
                    onChange={e => setFinalQuery(e.target.value)}
                    rows={5}
                    className="w-full bg-[rgba(255,255,255,0.84)] border border-[#cad9df] rounded-[10px] px-5 py-4 text-base text-[#13212e] leading-relaxed focus:outline-none focus:border-[#3b82f6] resize-none mb-5 transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_14px_28px_rgba(19,33,46,0.05)]"
                  />
                </>
              )}

              {jdRequirements.length > 0 && jdRebuilding && (
                <div className="mb-5 text-[11px] text-[#8698a4] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse inline-block" />
                  I&apos;m building the search in the background…
                </div>
              )}

              {error && (
                <div className="bg-[#ffe3e3] border border-[#ffc5cc] text-[#d9485f] rounded-[10px] px-4 py-3 text-sm mb-5">
                  {error}
                </div>
              )}
              {jdRequirements.length > 0 && filledCriteriaCount < 3 && (
                <div className="bg-[#fff0bf] border border-[#ffe08b] text-[#a16207] rounded-[10px] px-4 py-3 text-sm mb-5">
                  Add at least 3 criteria so I can run a solid search.
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={() => handleSearch()}
                  disabled={loading || (jdRequirements.length > 0 ? filledCriteriaCount < 3 : !finalQuery.trim())}
                  className="bg-[#163a59] text-white px-8 py-3 rounded-[8px] text-sm font-bold hover:bg-[#0f2c44] disabled:opacity-40 transition-colors"
                >
                  {loading ? 'Searching…' : '🔍 Find candidates'}
                </button>
              </div>
            </div>
          )}

          {/* ── RESULTS SIDEBAR ── */}
          {stage === 'results' && !loading && (
            <div className="flex flex-col gap-8">
              {/* Avatar + identity */}
              <div className="flex items-center gap-3">
                <AssistantAvatar size="sm" />
                <div>
                  <p className="text-[#587082] text-xs leading-none mb-1">Hi, I&apos;m your</p>
                  <p className="text-[#13212e] text-sm font-bold leading-none">talent search partner <span className="text-[#ff6b2c]">✨</span></p>
                </div>
              </div>

              {/* Searched for */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#8698a4] mb-2">
                  What I searched for
                </p>
                <div className="flex flex-col gap-2">
                  {resultsCriteria.map((criterion, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 bg-[rgba(221,231,236,0.72)] border border-[#c6d4db] rounded-[10px] px-3 py-2"
                    >
                      <span className="text-[10px] font-semibold text-[#8698a4] w-5 flex-shrink-0 tabular-nums">
                        C{i + 1}
                      </span>
                      <span className="text-xs text-[#48606f] leading-relaxed">
                        {criterion}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between">
                <button
                  onClick={handleRefineSearch}
                  className="text-sm text-[#3b82f6] hover:text-[#163a59] font-medium transition-colors"
                >
                  ← Tighten this search
                </button>
                <button
                  onClick={handleReset}
                  className="text-sm font-semibold text-white bg-[#163a59] hover:bg-[#0f2c44] border border-[#163a59] px-4 py-2 rounded-[8px] transition-colors"
                >
                  Start a new search →
                </button>
              </div>

            </div>
          )}

          {/* ── REFINING ── */}
          {stage === 'refining' && (
            <div className="flex flex-col gap-6">
              {/* Avatar + identity */}
              <div className="flex items-center gap-3">
                <AssistantAvatar size="sm" />
                <div>
                  <p className="text-[#587082] text-xs leading-none mb-1">Hi, I&apos;m your</p>
                  <p className="text-[#13212e] text-sm font-bold leading-none">talent search partner <span className="text-[#ff6b2c]">✨</span></p>
                </div>
              </div>

              {/* Previous query context */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#8698a4] mb-2">
                  Current search
                </p>
                <p className="text-sm text-[#587082] leading-relaxed whitespace-pre-wrap line-clamp-3">
                  {rewrittenQuery || finalQuery}
                </p>
              </div>

              {/* Refinement input */}
              <form onSubmit={handleRefine} className="flex flex-col gap-3">
                <label className="text-base font-bold text-[#13212e]">
                  What should I change?
                </label>
                <input
                  ref={refineRef}
                  type="text"
                  value={refinementInput}
                  onChange={e => setRefinementInput(e.target.value)}
                  placeholder="e.g. focus more on team leadership, remove fintech"
                  className="w-full bg-[rgba(255,255,255,0.84)] border border-[#cad9df] rounded-[10px] px-5 py-4 text-base text-[#13212e] placeholder:text-[#8698a4] focus:outline-none focus:border-[#3b82f6] transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_14px_28px_rgba(19,33,46,0.05)]"
                />
                {error && (
                  <div className="bg-[#ffe3e3] border border-[#ffc5cc] text-[#d9485f] rounded-[10px] px-4 py-3 text-sm">
                    {error}
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={!refinementInput.trim() || loading}
                    className="bg-[#163a59] text-white px-6 py-2.5 rounded-[8px] text-sm font-bold hover:bg-[#0f2c44] disabled:opacity-30 transition-colors"
                  >
                    {loading ? 'Searching…' : '🔍 Update search'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStage('results')}
                    className="text-sm text-[#587082] hover:text-[#13212e] transition-colors"
                  >
                    Back
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ── PREVIOUS SEARCHES (persistent) ── */}
          {searchHistory.length > 0 && (() => {
            // Group: collect leading 'refined' entries, then attach to the 'new' that follows
            const groups: { base: SearchHistoryEntry; refinements: SearchHistoryEntry[] }[] = [];
            let pending: SearchHistoryEntry[] = [];
            for (const entry of searchHistory) {
              if (entry.type === 'refined') {
                pending.push(entry);
              } else {
                groups.push({ base: entry, refinements: pending });
                pending = [];
              }
            }
            // Any trailing refinements with no parent new-search
            if (pending.length) groups.push({ base: pending[0], refinements: pending.slice(1) });

            return (
              <div className="mt-10 pt-8 border-t border-[#d7e4ea]">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#8698a4] mb-3">
                  Last 3 searches
                </p>
                <div className="flex flex-col gap-4">
                  {groups.map((group, gi) => (
                    <div key={gi}>
                      {/* New search */}
                      <div className="rounded-[10px] border border-[#d7e4ea] bg-[rgba(255,255,255,0.46)] overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2.5">
                          <button
                            onClick={() => openCriteriaConfirmation(group.base.query, group.base.criteria, group.base.importance)}
                            className="text-left flex-1 min-w-0 transition-colors"
                            title={group.base.label}
                          >
                            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#8698a4] mb-1">
                              Search
                            </div>
                            <div className="text-xs text-[#587082] leading-snug truncate">
                              {summarizeCriteria(group.base.criteria)}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedHistory(prev =>
                                prev.includes(group.base.query)
                                  ? prev.filter(item => item !== group.base.query)
                                  : [...prev, group.base.query]
                              )
                            }
                            className="text-[10px] font-semibold uppercase tracking-widest text-[#8698a4] hover:text-[#587082] transition-colors"
                          >
                            {expandedHistory.includes(group.base.query) ? 'Hide' : 'Show'}
                          </button>
                        </div>
                        {expandedHistory.includes(group.base.query) && (
                          <div className="px-3 pb-3 flex flex-col gap-1.5">
                            {group.base.criteria.map((criterion, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-2 bg-[rgba(221,231,236,0.52)] border border-[#d7e4ea] rounded-[8px] px-2.5 py-2 text-xs text-[#587082]"
                              >
                                <span className="text-[9px] font-semibold text-[#8698a4] w-4 flex-shrink-0 tabular-nums">
                                  C{i + 1}
                                </span>
                                <span className="leading-snug">{criterion}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Refinements clustered below */}
                      {group.refinements.length > 0 && (
                        <div className="mt-2 ml-2 pl-3 border-l border-[#d7e4ea] flex flex-col gap-2">
                          {group.refinements.map((r, ri) => (
                            <div key={ri} className="rounded-[10px] border border-[#d7e4ea] bg-[rgba(255,255,255,0.32)] overflow-hidden">
                              <div className="flex items-center gap-2 px-3 py-2.5">
                                <button
                                  onClick={() => openCriteriaConfirmation(r.query, r.criteria, r.importance)}
                                  className="text-left flex-1 min-w-0 transition-colors"
                                  title={r.label}
                                >
                                  <span className="text-[9px] font-semibold uppercase tracking-widest text-[#8698a4] block mb-0.5">↳ updated</span>
                                  <div className="text-xs text-[#8698a4] leading-snug truncate">
                                    {summarizeCriteria(r.criteria)}
                                  </div>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedHistory(prev =>
                                      prev.includes(r.query)
                                        ? prev.filter(item => item !== r.query)
                                        : [...prev, r.query]
                                    )
                                  }
                                  className="text-[10px] font-semibold uppercase tracking-widest text-[#8698a4] hover:text-[#587082] transition-colors"
                                >
                                  {expandedHistory.includes(r.query) ? 'Hide' : 'Show'}
                                </button>
                              </div>
                              {expandedHistory.includes(r.query) && (
                                <div className="px-3 pb-3 flex flex-col gap-1.5">
                                  {r.criteria.map((criterion, i) => (
                                    <div
                                      key={i}
                                      className="flex items-center gap-2 bg-[rgba(221,231,236,0.42)] border border-[#d7e4ea] rounded-[8px] px-2.5 py-2 text-xs text-[#8698a4]"
                                    >
                                      <span className="text-[9px] font-semibold text-[#9aa8b1] w-4 flex-shrink-0 tabular-nums">
                                        C{i + 1}
                                      </span>
                                      <span className="leading-snug">{criterion}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div
        ref={rightPanelRef}
        className={`
          flex-1 overflow-y-auto transition-opacity duration-700 ease-in-out
          ${showResultsOnlyLayout || isSplit ? 'opacity-100 relative z-10' : 'opacity-0 pointer-events-none'}
        `}
      >
        <div className={`${showResultsOnlyLayout ? 'px-10 py-10' : 'px-10 py-14'}`}>

          {/* ── WORKING STATE ── */}
          {loading && (
            <div className="min-h-[68vh] flex items-center justify-center">
              <div className="w-full max-w-2xl px-6 text-center">
                <div className="mb-5 flex justify-center">
                  <AssistantAvatar size="md" className="scale-[0.95]" />
                </div>
                <div className="inline-flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] uppercase text-[#9aaab4]">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#19b37d]/35" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#19b37d]" />
                  </span>
                  Searching
                </div>
                <p className="mt-4 text-[24px] font-semibold tracking-[-0.035em] text-[#233545] leading-[1.35]">
                  {SEARCH_STATUS_MESSAGES[loadingStatusIndex]}
                </p>
                <p className="mt-3 text-[14px] leading-relaxed text-[#7f929f]">
                  Checking the brief, the weighting, and the strongest profile signals.
                </p>
              </div>
            </div>
          )}

          {/* ── RESULT CARDS ── */}
          {(stage === 'results' || ((stage === 'confirming' || stage === 'nudging') && results.length > 0)) && !loading && (
            <div>
              {showResultsOnlyLayout && (
                <div className="sticky top-0 z-20 mb-5">
                  <div className="rounded-[16px] border border-[#d7e4ea] bg-[rgba(246,250,252,0.92)] backdrop-blur-md shadow-[0_20px_45px_rgba(19,33,46,0.08)] overflow-hidden">
                    <div className="flex flex-col gap-4 px-5 py-4 border-b border-[#dfe9ee] md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-[24px] font-black tracking-[-0.04em] text-[#13212e] leading-none">
                          ✨ Strong matches so far
                        </p>
                        <p className="text-sm text-[#587082] mt-1">
                          I&apos;m checking every profile against the criteria below.
                        </p>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap md:justify-end">
                        <span className="text-[11px] font-semibold uppercase tracking-widest text-[#8698a4]">
                          {visibleResults.length} results
                        </span>
                        <button
                          type="button"
                          onClick={handleRefineSearch}
                          className="px-4 py-2 rounded-[10px] text-sm font-semibold text-[#163a59] border border-[#cad9df] bg-white/70 hover:border-[#9fb7c2] hover:bg-white transition-colors"
                        >
                          Tighten this search
                        </button>
                        <button
                          type="button"
                          onClick={handleReset}
                          className="px-4 py-2 rounded-[10px] text-sm font-semibold text-white bg-[#163a59] hover:bg-[#0f2c44] transition-colors"
                        >
                          Start a new search
                        </button>
                      </div>
                    </div>

                    {resultsCriteria.length > 0 && (
                      <div className="px-5 py-4">
                        {resultGuidance && (
                          <div className="mb-4">
                            <button
                              type="button"
                              onClick={() => setGuidanceExpanded(prev => !prev)}
                              className="group w-full rounded-[16px] border border-[#1f3140] bg-[linear-gradient(135deg,#102332,#132c40_45%,#183851)] px-4 py-4 text-left shadow-[0_20px_45px_rgba(19,33,46,0.14)] transition-all hover:border-[#2f5069]"
                            >
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3 min-w-0">
                                  <AssistantAvatar size="sm" className="scale-[0.9]" />
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[#8fb2c9] mb-1">
                                      Ideas on what I&apos;d do next
                                    </p>
                                    <p className="text-[15px] font-semibold tracking-[-0.03em] text-white leading-snug">
                                      {resultGuidance.cards[0]?.title}
                                    </p>
                                  </div>
                                </div>
                                <span className="flex-shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-[#cfe3f0]">
                                  {guidanceExpanded ? 'Hide' : 'Open'}
                                </span>
                              </div>
                            </button>

                            {guidanceExpanded && (
                              <div className="mt-3 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                                <div className="flex gap-3 min-w-max pr-1">
                                  {resultGuidance.cards.map((card, i) => {
                                    const toneClass =
                                      card.tone === 'warning'
                                        ? 'border-[#705c2f] bg-[linear-gradient(180deg,rgba(84,67,31,0.96),rgba(45,36,18,0.94))]'
                                        : card.tone === 'success'
                                          ? 'border-[#285845] bg-[linear-gradient(180deg,rgba(20,73,58,0.96),rgba(14,43,35,0.94))]'
                                          : i === 0
                                            ? 'border-[#26435d] bg-[linear-gradient(180deg,rgba(24,56,81,0.98),rgba(16,35,50,0.96))]'
                                            : 'border-[#22394e] bg-[linear-gradient(180deg,rgba(20,44,63,0.97),rgba(14,31,45,0.95))]';

                                    return (
                                      <div
                                        key={i}
                                        className={`min-h-[148px] w-[300px] rounded-[16px] border px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_14px_30px_rgba(8,16,24,0.22)] ${toneClass}`}
                                      >
                                        {i === 0 ? (
                                          <div className="flex items-start gap-3">
                                            <AssistantAvatar size="sm" className="scale-[0.9]" />
                                            <div className="min-w-0">
                                              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#8fb2c9] mb-1">
                                                {card.eyebrow}
                                              </p>
                                              <p className="text-[15px] font-semibold tracking-[-0.03em] text-white leading-snug">
                                                {card.title}
                                              </p>
                                              <p className="mt-2 text-[12px] leading-relaxed text-[#c5d9e6]">
                                                {card.body}
                                              </p>
                                            </div>
                                          </div>
                                        ) : (
                                          <div>
                                            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#8fb2c9] mb-2">
                                              {card.eyebrow}
                                            </p>
                                            <p className="text-[15px] font-semibold tracking-[-0.03em] text-white leading-snug">
                                              {card.title}
                                            </p>
                                            <p className="mt-2 text-[12px] leading-relaxed text-[#c5d9e6]">
                                              {card.body}
                                            </p>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="rounded-[14px] border border-[#dfe9ee] bg-[rgba(255,255,255,0.72)] shadow-[inset_0_1px_0_rgba(255,255,255,0.76)]">
                          <button
                            type="button"
                            onClick={() => setCriteriaExpanded(prev => !prev)}
                            className="w-full px-4 py-3 text-left"
                          >
                            <div className="flex items-center justify-between gap-4">
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#8698a4]">
                                Search criteria
                              </p>
                              <span className="flex-shrink-0 rounded-full border border-[#d7e4ea] bg-white/80 px-3 py-1 text-[11px] font-semibold text-[#587082]">
                                {criteriaExpanded ? 'Hide' : 'Open'}
                              </span>
                            </div>
                          </button>

                          <div className="px-4 pb-4">
                            {!criteriaExpanded ? (
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                {resultsCriteria.map((criterion, i) => (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={() => setSelectedCriterion(prev => (prev === i ? null : i))}
                                    title={criterion}
                                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] transition-all ${
                                      selectedCriterion === i
                                        ? 'border-[#163a59] bg-[#163a59] text-white shadow-[0_10px_22px_rgba(22,58,89,0.18)]'
                                        : effectiveImportance[i] === 'high'
                                          ? 'border-[#b5e9d6] bg-[rgba(215,245,234,0.82)] text-[#0f8e61] hover:border-[#19b37d] shadow-[0_8px_18px_rgba(25,179,125,0.08)]'
                                          : 'border-[#d7e4ea] bg-[rgba(221,231,236,0.52)] text-[#48606f] hover:border-[#9fb7c2]'
                                    }`}
                                  >
                                    <span className={`font-semibold ${selectedCriterion === i ? 'text-white/80' : effectiveImportance[i] === 'high' ? 'text-[#0f8e61]' : 'text-[#8698a4]'}`}>C{i + 1}</span>
                                    <span>{buildShortCriterionLabel(criterion)}</span>
                                    {effectiveImportance[i] === 'high' && (
                                      <span className={`text-[10px] ${selectedCriterion === i ? 'text-white/80' : ''}`}>💪</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="flex flex-col gap-2 pt-1">
                                {resultsCriteria.map((criterion, i) => (
                                  <div
                                    key={i}
                                    className={`flex items-center justify-between gap-3 rounded-[12px] border px-3 py-2.5 text-[11px] transition-all ${
                                      selectedCriterion === i
                                        ? 'border-[#163a59] bg-[#163a59] text-white shadow-[0_10px_22px_rgba(22,58,89,0.18)]'
                                        : effectiveImportance[i] === 'high'
                                          ? 'border-[#b5e9d6] bg-[rgba(215,245,234,0.62)] text-[#48606f]'
                                          : 'border-[#d7e4ea] bg-[rgba(221,231,236,0.42)] text-[#48606f]'
                                    }`}
                                  >
                                    <div className="flex min-w-0 flex-1 items-start gap-2 text-left">
                                      <span className={`mt-0.5 font-semibold flex-shrink-0 ${selectedCriterion === i ? 'text-white/80' : effectiveImportance[i] === 'high' ? 'text-[#0f8e61]' : 'text-[#8698a4]'}`}>C{i + 1}</span>
                                      <span className="leading-relaxed">{criterion}</span>
                                      {effectiveImportance[i] === 'high' && (
                                        <span className={`mt-0.5 flex-shrink-0 text-[10px] ${selectedCriterion === i ? 'text-white/80' : 'text-[#0f8e61]'}`}>💪</span>
                                      )}
                                    </div>
                                    <span
                                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[9px] font-semibold flex-shrink-0 ${
                                        effectiveImportance[i] === 'high'
                                          ? 'border-[#b5e9d6] bg-[#146a55] text-white'
                                          : 'border-[#d7e4ea] bg-white/80 text-[#557086]'
                                      }`}
                                      title={effectiveImportance[i] === 'high' ? 'Important criterion' : 'Regular criterion'}
                                    >
                                      {effectiveImportance[i] === 'high' ? 'Imp' : 'Reg'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

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
                        query={rewrittenQuery || finalQuery}
                        criteria={resultsCriteria}
                        criterionImportance={effectiveImportance}
                        selectedCriterion={selectedCriterion}
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
                    className="px-4 py-2 rounded-[8px] text-sm text-[#587082] border border-[#cad9df] hover:border-[#9fb7c2] hover:text-[#13212e] disabled:opacity-30 disabled:cursor-not-allowed transition-colors bg-white/60"
                  >
                    ← Prev
                  </button>
                  <span className="text-xs text-[#8698a4]">
                    {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, visibleResults.length)} of {visibleResults.length}
                  </span>
                  <button
                    onClick={() => { setPage(p => p + 1); rightPanelRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    disabled={page * PAGE_SIZE >= visibleResults.length}
                    className="px-4 py-2 rounded-[8px] text-sm text-[#587082] border border-[#cad9df] hover:border-[#9fb7c2] hover:text-[#13212e] disabled:opacity-30 disabled:cursor-not-allowed transition-colors bg-white/60"
                  >
                    Next →
                  </button>
                </div>
              )}

              {visibleResults.length === 0 && (
                <div className="text-center mt-20">
                  <p className="text-[#587082] mb-2">I&apos;m not seeing enough strong fits yet.</p>
                  <p className="text-sm text-[#8698a4]">I&apos;d broaden one or two criteria and try again.</p>
                </div>
              )}
            </div>
          )}

        </div>
      </div>

    </div>
  );
}
