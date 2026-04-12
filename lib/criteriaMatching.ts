export type CriterionImportance = 'high' | 'regular';

export interface CandidateForCriteria {
  headline: string;
  summary: string | null;
  location: string;
  location_city?: string | null;
  primary_function?: string | null;
  seniority?: string | null;
  years_experience?: number | null;
  top_school?: boolean | null;
  has_mba?: boolean | null;
  skills: string[];
  top_experience?: Array<{
    title: string;
    company: string;
    location: string;
  }>;
}

export interface CriteriaMatch {
  label: string;
  status: 'match' | 'partial' | 'miss';
  reason: string;
}

export function importanceWeight(importance: CriterionImportance) {
  return importance === 'high' ? 2 : 1;
}

export function buildCriteriaMatches(c: CandidateForCriteria, criteria: string[]): CriteriaMatch[] {
  const haystack = [
    c.headline,
    c.summary,
    c.location,
    c.location_city,
    c.primary_function,
    c.seniority,
    c.top_experience?.map(exp => [exp.title, exp.company, exp.location].filter(Boolean).join(' ')).join(' '),
    (c.skills || []).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const normalizedSkills = (c.skills || []).map(skill => skill.toLowerCase());
  const containsAny = (values: string[]) => values.some(value => haystack.includes(value));
  const parseYears = (criterion: string) => {
    const match = criterion.match(/(\d+)\+?\s+years?/i);
    return match ? Number(match[1]) : null;
  };

  return criteria.map((criterion) => {
    const normalized = criterion.trim().toLowerCase();
    const years = parseYears(criterion);

    if (years != null && c.years_experience != null) {
      return {
        label: criterion,
        status: c.years_experience >= years ? 'match' : c.years_experience >= Math.max(years - 2, 0) ? 'partial' : 'miss',
        reason:
          c.years_experience >= years
            ? `${c.years_experience} years experience meets the requirement`
            : c.years_experience >= Math.max(years - 2, 0)
              ? `${c.years_experience} years experience is close to the requirement`
              : `${c.years_experience} years experience is below the requirement`,
      };
    }

    if (/education:|mba|iit|iim|top school|top mba/i.test(criterion)) {
      const strong = (c.top_school || c.has_mba) && containsAny(['mba', 'iit', 'iim', 'top school', 'education']);
      const partial = c.top_school || c.has_mba || containsAny(['mba', 'education', 'school']);
      return {
        label: criterion,
        status: strong ? 'match' : partial ? 'partial' : 'miss',
        reason: strong ? 'Strong education signal found' : partial ? 'Some education signal found' : 'No clear education signal found',
      };
    }

    if (/based in|location|bangalore|bengaluru|mumbai|delhi|gurgaon|remote|india/i.test(criterion)) {
      const tokens = normalized.split(/[^a-z]+/).filter(token => token.length > 2);
      const locationTokens = tokens.filter(token => !['based', 'location', 'remote'].includes(token));
      const locationMatch = locationTokens.length > 0 ? containsAny(locationTokens) : containsAny(['remote', 'india']);
      return {
        label: criterion,
        status: locationMatch ? 'match' : containsAny(['india', 'remote']) ? 'partial' : 'miss',
        reason: locationMatch ? 'Location aligns directly' : containsAny(['india', 'remote']) ? 'Location is adjacent or flexible' : 'Location signal not found',
      };
    }

    if (/must-have|non-negotiable/i.test(criterion)) {
      const tokens = normalized.split(/[^a-z0-9+-]+/).filter(token => token.length > 2);
      const tokenHits = tokens.filter(token => haystack.includes(token)).length;
      return {
        label: criterion,
        status: tokenHits >= 2 ? 'match' : tokenHits === 1 ? 'partial' : 'miss',
        reason: tokenHits >= 2 ? 'Multiple must-have terms are present' : tokenHits === 1 ? 'Only part of the must-have is present' : 'Must-have signal not found',
      };
    }

    const keywordTokens = normalized
      .replace(/^(based in|also strong in|education:|must-have:|non-negotiable requirement:|has|is|can|ideally|background in|experience in)\s+/i, '')
      .split(/[^a-z0-9+-]+/)
      .filter(token => token.length > 2);

    const skillHits = keywordTokens.filter(token =>
      normalizedSkills.some(skill => skill.includes(token) || token.includes(skill))
    ).length;
    const textHits = keywordTokens.filter(token => haystack.includes(token)).length;
    const totalHits = skillHits + textHits;

    if (totalHits >= 3 || (keywordTokens.length > 0 && totalHits >= Math.min(2, keywordTokens.length))) {
      return { label: criterion, status: 'match', reason: 'Multiple supporting signals found in profile' };
    }
    if (totalHits > 0) {
      return { label: criterion, status: 'partial', reason: 'Some supporting signals found in profile' };
    }
    return { label: criterion, status: 'miss', reason: 'No direct supporting signal found in profile' };
  });
}

export function computeWeightedMatchScore(matches: CriteriaMatch[], importance: CriterionImportance[]) {
  if (matches.length === 0) return 0;
  const total = matches.reduce((sum, match, i) => sum + importanceWeight(importance[i] ?? 'regular'), 0);
  const earned = matches.reduce((sum, match, i) => {
    const weight = importanceWeight(importance[i] ?? 'regular');
    const multiplier = match.status === 'match' ? 1 : match.status === 'partial' ? 0.5 : 0;
    return sum + weight * multiplier;
  }, 0);
  return total > 0 ? Math.round((earned / total) * 100) : 0;
}
