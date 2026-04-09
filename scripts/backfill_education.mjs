// Backfill education data from the original JSONL into the candidates table
// Run with: node --env-file=.env.local scripts/backfill_education.mjs
//
// No AI calls — just reads JSONL and updates Supabase with structured education data.
// Resume-safe: only updates candidates where education column is null.

import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const JSONL_PATH    = process.env.JSONL_PATH || `${process.env.HOME}/Desktop/india_samples_30K_20260312.jsonl`;
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BATCH_SIZE    = 50;   // rows per Supabase update batch
const DELAY_MS      = 200;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ── Parse education from raw record ──────────────────────────────────────────

function parseEducation(record) {
  const edu = record.education || [];
  return edu.slice(0, 5).map(e => ({
    school:  (e.school || {}).name || null,
    degree:  Array.isArray(e.degree) ? e.degree[0] || null : e.degree || null,
    field:   Array.isArray(e.degree) ? e.degree[1] || null : null,
    date:    e.date1 || null,
    date_end: e.date2 || null,
  })).filter(e => e.school || e.degree);
}

// ── Fetch UIDs that already have education filled ─────────────────────────────

async function fetchEnrichedUids() {
  const seen = new Set();
  let offset = 0;
  const limit = 1000;
  console.log('  Fetching already-backfilled UIDs…');
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/candidates?education=not.is.null&select=uid&limit=${limit}&offset=${offset}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) throw new Error(`Supabase fetch failed: ${await res.text()}`);
    const data = await res.json();
    data.forEach(r => seen.add(r.uid));
    if (data.length < limit) break;
    offset += limit;
  }
  console.log(`  Already backfilled: ${seen.size} candidates\n`);
  return seen;
}

// ── Batch update Supabase ─────────────────────────────────────────────────────

async function flushBatch(batch) {
  await Promise.all(batch.map(async ({ uid, education }) => {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/candidates?uid=eq.${encodeURIComponent(uid)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ education }),
      }
    );
    if (!res.ok) {
      console.warn(`  Failed to update ${uid}: ${await res.text()}`);
    }
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n📚  Education backfill script');
  console.log(`   Source: ${JSONL_PATH}\n`);

  const alreadyDone = await fetchEnrichedUids();

  const rl = createInterface({
    input: createReadStream(JSONL_PATH),
    crlfDelay: Infinity,
  });

  let batch = [];
  let processed = 0;
  let skipped = 0;
  let noEdu = 0;
  let lineNum = 0;

  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const uid = record.uid;
    if (!uid) continue;

    if (alreadyDone.has(uid)) {
      skipped++;
      continue;
    }

    const education = parseEducation(record);
    if (education.length === 0) {
      noEdu++;
      continue;
    }

    batch.push({ uid, education });

    if (batch.length >= BATCH_SIZE) {
      await flushBatch(batch);
      processed += batch.length;
      batch = [];
      process.stdout.write(`\r  Updated: ${processed} | Skipped: ${skipped} | No edu data: ${noEdu}`);
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  // Flush remainder
  if (batch.length > 0) {
    await flushBatch(batch);
    processed += batch.length;
  }

  console.log(`\n\n✅  Done.`);
  console.log(`   Updated:      ${processed}`);
  console.log(`   Already done: ${skipped}`);
  console.log(`   No edu data:  ${noEdu}\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
