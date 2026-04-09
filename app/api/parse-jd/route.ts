import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are supported' }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 400 });
    }

    // Convert PDF to base64 for Claude's document content type
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 600,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: base64,
                },
              },
              {
                type: 'text',
                text: `You are helping a recruiter search for candidates that match this job description.

Read the job description and do two things:
1. Identify the 5-6 most important requirements for this role (skills, experience, background, seniority, domain).
2. Write a concise candidate search query (2-4 sentences) that a recruiter would use to find the best matches. Focus on what the ideal candidate looks like, not what the company is.

Return a JSON object with exactly these fields:
{
  "requirements": ["<requirement 1>", "<requirement 2>", ...],
  "query": "<the search query>"
}

Return only the JSON. No explanation, no preamble.`,
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Claude parse-jd error:', res.status, errText);
      return NextResponse.json({ error: 'Failed to analyse job description' }, { status: 500 });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text?.trim() || '';
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    let parsed: { requirements: string[]; query: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('parse-jd JSON parse error, raw:', text);
      return NextResponse.json({ error: 'Could not parse job description response' }, { status: 500 });
    }

    return NextResponse.json({
      requirements: parsed.requirements || [],
      query: parsed.query || '',
    });

  } catch (err) {
    console.error('parse-jd error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
