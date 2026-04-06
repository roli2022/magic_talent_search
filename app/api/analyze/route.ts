import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ detected: {} });
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
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Extract structured fields from this job search query. Return a JSON object only — no explanation.

Include a field only if it is explicitly and specifically stated. Do not infer or guess.

Fields to extract:
- location: city or region explicitly mentioned (e.g. "Mumbai", "Bangalore", "Delhi NCR")
- skills: specific skills, tools, or domain expertise explicitly mentioned (e.g. "Python", "BFSI", "B2B sales")
- experience: experience level or background type explicitly mentioned (e.g. "10+ years", "startup experience", "P&L ownership")
- education: educational requirements explicitly mentioned (e.g. "IIT", "MBA", "CS degree")
- musthave: hard requirements or deal-breakers explicitly stated (e.g. "must have BFSI background", "minimum 5 years required")

Return {} if no field applies. Values should be short phrases, not full sentences.

Query: ${query}`,
        }],
      }),
    });

    if (!res.ok) {
      console.error('Analyze API error:', res.status, await res.text());
      return NextResponse.json({ detected: {} });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text?.trim() || '{}';

    let detected: Record<string, string> = {};
    try {
      detected = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try { detected = JSON.parse(match[0]); } catch { /* ignore */ }
      }
    }

    // Strip empty values
    Object.keys(detected).forEach(k => {
      if (!detected[k] || typeof detected[k] !== 'string') delete detected[k];
    });

    return NextResponse.json({ detected });
  } catch (err) {
    console.error('Analyze error:', err);
    return NextResponse.json({ detected: {} });
  }
}
