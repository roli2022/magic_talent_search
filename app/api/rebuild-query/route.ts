import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { requirements } = await req.json();

    if (!Array.isArray(requirements) || requirements.length === 0) {
      return NextResponse.json({ query: '' });
    }

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
          content: `You are helping a recruiter search for candidates. Given these role requirements, write a concise candidate search query (2-4 sentences) that captures what the ideal candidate looks like.

Requirements:
${requirements.map((r: string, i: number) => `${i + 1}. ${r}`).join('\n')}

Return only the search query as plain text. No explanation, no preamble.`,
        }],
      }),
    });

    if (!res.ok) {
      console.error('rebuild-query error:', res.status, await res.text());
      return NextResponse.json({ error: 'Failed to rebuild query' }, { status: 500 });
    }

    const data = await res.json();
    const query = data.content?.[0]?.text?.trim() || '';
    return NextResponse.json({ query });

  } catch (err) {
    console.error('rebuild-query error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
