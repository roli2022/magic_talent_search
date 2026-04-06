import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { candidate, query } = await req.json();

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

Write exactly 2 sentences explaining why this candidate is or isn't a good fit for the search.
- Sentence 1: their overall fit for the role/search
- Sentence 2: one specific standout signal (strength or gap) from their actual profile

Rules:
- Only reference information explicitly in the profile above. Do not infer or invent.
- Be direct and specific. No filler phrases like "Overall," or "In summary,".
- Maximum 60 words total.`;

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
