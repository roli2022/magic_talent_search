// One-time ingestion script. Run with: npm run ingest
// Uses native fetch — no SDK dependencies needed.

import { createReadStream } from 'fs';
import { createInterface } from 'readline';

// ── Config ─────────────────────────────────────────────────────────────────
const JSONL_PATH     = process.env.JSONL_PATH || '../india_samples_30K_20260312.jsonl';
const BATCH_SIZE     = 128;
const UPSERT_CHUNK   = 5;
const BATCH_DELAY_MS = 500; // 0.5s pause between batches
const VOYAGE_MODEL   = 'voyage-3';
const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY     = process.env.VOYAGE_API_KEY;

// ── Voyage AI embed via fetch ──────────────────────────────────────────────
async function embedOne(text) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${VOYAGE_KEY}` },
    body: JSON.stringify({ model: VOYAGE_MODEL, input: [text], input_type: 'document' }),
  });
  if (!res.ok) return null; // skip bad record
  const data = await res.json();
  return data.data[0].embedding;
}

async function embedBatch(texts, retries = 5) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${VOYAGE_KEY}` },
      body: JSON.stringify({ model: VOYAGE_MODEL, input: texts, input_type: 'document' }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn(`Voyage API status ${res.status}: ${err}`);
      if (res.status === 429 || res.status === 503) {
        const wait = Math.pow(2, attempt + 2) * 1000;
        console.warn(`Rate limited. Retrying in ${wait / 1000}s… (attempt ${attempt + 1}/5)`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      // Bad data in batch — fall back to one-by-one
      console.warn('Batch embed failed, retrying individually…');
      return Promise.all(texts.map(embedOne));
    }

    const data = await res.json();
    return data.data.map(d => d.embedding);
  }
  throw new Error('Embedding failed after max retries');
}

// ── Supabase upsert via fetch ──────────────────────────────────────────────
async function upsertOne(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/candidates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify([row]),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase upsert error ${res.status}: ${err}`);
  }
}

async function upsertRows(rows) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/candidates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      // Batch failed — retry row by row to skip bad records
      console.warn(`Batch upsert failed, retrying individually for ${chunk.length} rows…`);
      for (const row of chunk) {
        try {
          await upsertOne(row);
        } catch (err) {
          console.warn(`Skipping bad record ${row.uid}: ${err.message}`);
        }
      }
    }
  }
}

// ── Fetch already-ingested UIDs for resume support ────────────────────────
async function fetchIngestedUids() {
  const seen = new Set();
  let offset = 0;
  const limit = 1000;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/candidates?select=uid&limit=${limit}&offset=${offset}`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    if (!res.ok) throw new Error(`Failed to fetch UIDs: ${await res.text()}`);
    const data = await res.json();
    if (!data.length) break;
    data.forEach(r => seen.add(r.uid));
    if (data.length < limit) break;
    offset += limit;
  }
  return seen;
}

// ── Text helpers ───────────────────────────────────────────────────────────
function sanitize(text) {
  if (!text) return '';
  return text
    .replace(/\0/g, '')                          // null bytes
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // control chars
    .replace(/[\uD800-\uDFFF]/g, '')             // unpaired surrogates (invalid UTF-16)
    .replace(/[\uFFFE\uFFFF]/g, '');             // non-characters
}

function stripHtml(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#x[0-9a-fA-F]+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function buildText(record) {
  const mp  = record.miniprofile || {};
  const loc = mp.location || {};
  const lines = [];
  lines.push(`Name: ${mp.name || ''}`);
  lines.push(`Headline: ${mp.headline || ''}`);
  if (loc.address) lines.push(`Location: ${loc.address}`);
  if (mp.summary)  lines.push(`Summary: ${stripHtml(mp.summary)}`);
  const skills = (record.skill || []).slice(0, 20);
  if (skills.length) lines.push(`Skills: ${skills.join(', ')}`);
  (record.experience || []).slice(0, 5).forEach((exp, i) => {
    const title   = exp.title || '';
    const company = (exp.company || {}).name || '';
    const date    = exp.date1 || '';
    const desc    = stripHtml(exp.description || '').slice(0, 500);
    lines.push(`Experience ${i + 1}: ${title} at ${company} (${date})${desc ? '. ' + desc : ''}`);
  });
  (record.education || []).slice(0, 1).forEach(edu => {
    const school = (edu.school || {}).name || '';
    const degree = (edu.degree || [])[0] || '';
    if (school || degree) lines.push(`Education: ${degree} at ${school} (${edu.date1 || ''})`);
  });
  return lines.join('\n');
}

function buildRow(record, embedding) {
  const mp  = record.miniprofile || {};
  const loc = mp.location || {};
  return {
    uid:            record.uid,
    url:            record.url,
    image_url:      record.image_url || null,
    name:           sanitize(mp.name     || '') || null,
    headline:       sanitize(mp.headline || '') || null,
    summary:        mp.summary ? sanitize(stripHtml(mp.summary)).slice(0, 500) : null,
    location:       sanitize(loc.address || '') || null,
    region:         sanitize(loc.region  || '') || null,
    connections:    mp.connections || null,
    followers:      mp.followers   || null,
    skills:         (record.skill || []).slice(0, 50),
    top_experience: (record.experience || []).slice(0, 3).map(e => ({
      title:    e.title || '',
      company:  (e.company || {}).name || '',
      date:     e.date1 || '',
      location: e.location || '',
    })),
    embedding: `[${embedding.join(',')}]`,
    updated_at: record.updated_at || null,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY || !VOYAGE_KEY) {
    throw new Error('Missing env vars — check .env.local');
  }

  console.log('Fetching already-ingested UIDs…');
  const ingestedUids = await fetchIngestedUids();
  console.log(`${ingestedUids.size} already ingested — skipping those.\n`);

  const rl = createInterface({
    input: createReadStream(JSONL_PATH, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let pending   = [];
  let processed = 0;
  let skipped   = 0;
  let batchNum  = 0;
  const start   = Date.now();

  async function flush() {
    if (!pending.length) return;
    batchNum++;
    const embeddings = await embedBatch(pending.map(buildText));
    const rows = pending
      .map((r, i) => embeddings[i] ? buildRow(r, embeddings[i]) : null)
      .filter(Boolean);
    await upsertRows(rows);
    processed += pending.length;
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const rate    = (processed / ((Date.now() - start) / 1000)).toFixed(1);
    console.log(`Batch ${batchNum} | ${processed} processed | ${skipped} skipped | ${rate} rec/s | ${elapsed}s`);
    pending = [];
    await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
  }

  for await (const line of rl) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { console.warn('Skipping malformed line'); continue; }
    if (!record.uid) { console.warn('Skipping record with no uid'); continue; }
    if (ingestedUids.has(record.uid)) { skipped++; continue; }
    pending.push(record);
    if (pending.length >= BATCH_SIZE) await flush();
  }

  await flush();
  console.log(`\nDone! ${processed} ingested, ${skipped} skipped in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
