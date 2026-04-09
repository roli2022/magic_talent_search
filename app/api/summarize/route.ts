import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function fetchEnrichedFields(uid: string) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/candidates?uid=eq.${encodeURIComponent(uid)}&select=enriched_at,years_experience,seniority,manages_people,team_size_managed,avg_tenure_years,job_switches,mobility_likelihood,likely_open_to_move,mobility_signals,industries,recent_industries,recent_key_achievements,recent_company_names,recent_seniority,primary_function,technical_depth,is_founder,has_startup_exp,has_0_to_1_exp,has_scale_exp,top_school,school_tier,has_mba,location_city,builder_score,builder_evidence,ownership_score,evidence_density_score,is_outlier,outlier_reason`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.[0]?.enriched_at ? data[0] : null;
  } catch {
    return null;
  }
}

function buildEnrichedContext(e: Record<string, unknown>): string {
  const lines: string[] = [];

  if (e.years_experience != null) lines.push(`Years of experience: ${e.years_experience}`);
  if (e.seniority)                lines.push(`Seniority: ${e.seniority}`);
  if (e.avg_tenure_years != null) lines.push(`Average tenure: ${e.avg_tenure_years} years per role`);
  if (e.job_switches != null)     lines.push(`Companies worked at: ${e.job_switches}`);
  if (e.mobility_likelihood)      lines.push(`Mobility likelihood: ${e.mobility_likelihood}`);
  if (e.manages_people != null)   lines.push(`Manages people: ${e.manages_people ? 'yes' : 'no'}${e.team_size_managed ? ` (${e.team_size_managed} team)` : ''}`);
  if ((e.recent_industries as string[])?.length)  lines.push(`Recent industries: ${(e.recent_industries as string[]).join(', ')}`);
  if ((e.recent_company_names as string[])?.length) lines.push(`Recent companies: ${(e.recent_company_names as string[]).join(', ')}`);
  if (e.recent_key_achievements)  lines.push(`Recent achievements: ${e.recent_key_achievements}`);
  if (e.top_school)               lines.push(`Education: top-tier institution (${e.school_tier || ''})`);
  if (e.has_mba)                  lines.push(`Has MBA: yes`);
  if (e.is_founder)               lines.push(`Founded a company: yes`);
  if (e.has_0_to_1_exp)          lines.push(`Built 0-to-1: yes`);
  if (e.has_scale_exp)           lines.push(`Scaled a product/team: yes`);
  if (e.builder_score != null)   lines.push(`Builder score: ${e.builder_score}/10${e.builder_evidence ? ` — ${e.builder_evidence}` : ''}`);
  if (e.ownership_score != null) lines.push(`Ownership score: ${e.ownership_score}/10`);
  if (e.is_outlier)              lines.push(`Outlier signal: ${e.outlier_reason || 'yes'}`);

  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  const { candidate, query } = await req.json();

  // Fetch enriched fields if available
  const enriched = await fetchEnrichedFields(candidate.uid);
  const enrichedContext = enriched ? buildEnrichedContext(enriched) : '';

  // Build a compact profile string — only real data, no inference
  const expLines = (candidate.top_experience ?? []).slice(0, 3).map(
    (e: { title: string; company: string; date: string }) =>
      `${e.title}${e.company ? ` at ${e.company}` : ''}${e.date ? ` (${e.date})` : ''}`
  ).join('; ');

  const skillsLine = (candidate.skills ?? []).slice(0, 12).join(', ');

  const profile = [
    `Name: ${candidate.name}`,
    `Headline: ${candidate.headline || '—'}`,
    `Location: ${candidate.location || '—'}`,
    expLines   ? `Experience: ${expLines}`  : null,
    skillsLine ? `Skills: ${skillsLine}`    : null,
    candidate.summary ? `Summary: ${candidate.summary.slice(0, 400)}` : null,
  ].filter(Boolean).join('\n');

  const prompt = `You are a talent analyst. A recruiter searched for: "${query}"

Here is a candidate's LinkedIn profile:
${profile}
${enrichedContext ? `\nStructured signals extracted from their profile:\n${enrichedContext}` : ''}

Write exactly 2 sentences highlighting what is most relevant about this candidate for the search.
- Sentence 1: the strongest relevant aspect of their background (role, experience, or skills)
- Sentence 2: one specific detail — preferably from the structured signals above if available — that stands out in the context of this search (e.g. tenure stability, builder score, key achievement, outlier signal)

Rules:
- Only reference information explicitly in the profile or structured signals above. Do not infer or invent.
- Do NOT render a verdict, say whether they are suitable or not, or point out gaps/mismatches. Surface relevant strengths only.
- Be specific and factual. No filler phrases like "Overall," or "In summary,".
- Wrap 3–5 key phrases that directly match the search criteria in **double asterisks** — e.g. **senior product manager**, **Bangalore**, **B2B SaaS**. Only bold phrases genuinely present in the profile.
- Maximum 70 words total.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 120,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    return new Response('Failed to generate summary', { status: 500 });
  }

  // Forward the SSE stream, extracting just the text deltas
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) { controller.close(); break; }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') { controller.close(); return; }
          try {
            const parsed = JSON.parse(data);
            const text = parsed?.delta?.text;
            if (text) controller.enqueue(encoder.encode(text));
          } catch { /* skip malformed */ }
        }
      }
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
