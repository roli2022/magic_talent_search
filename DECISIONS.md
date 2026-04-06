# Design Decisions

A chronological log of architectural and product decisions for the candidate search app.

> **How to use this file:**
> - Scan the **Quick Reference** table below to find what you need
> - Jump to any numbered section for full detail
> - Categories: `[INFRA]` stack/hosting · `[SEARCH]` retrieval/ranking · `[UX]` UI/flows · `[DEV]` tooling/scripts
> - Status: ✅ Live · ⚠️ Superseded · ⏳ Pending

---

## Quick Reference

| # | Decision | Category | Status |
|---|----------|----------|--------|
| 1 | Next.js App Router as full-stack framework | `[INFRA]` | ✅ Live |
| 2 | Voyage AI `voyage-3` for embeddings | `[SEARCH]` | ✅ Live |
| 3 | Supabase + pgvector as vector database | `[INFRA]` | ✅ Live |
| 4 | HNSW index (not IVFFlat) | `[SEARCH]` | ✅ Live |
| 5 | Cosine similarity as ranking metric | `[SEARCH]` | ✅ Live |
| 6 | Flatten candidate profile to plain text for embedding | `[SEARCH]` | ✅ Live |
| 7 | Streaming + batching for ingestion | `[DEV]` | ✅ Live |
| 8 | Native `fetch` instead of SDKs | `[DEV]` | ✅ Live |
| 9 | `--env-file` flag instead of `dotenv` | `[DEV]` | ✅ Live |
| 10 | Vector format: string `"[0.1,0.2,...]"` for Supabase | `[DEV]` | ✅ Live |
| 11 | Dual score display (raw % badges) | `[UX]` | ⚠️ Superseded by #13 |
| 12 | Four-pass retrieval pipeline | `[SEARCH]` | ✅ Live |
| 13 | Normalised label display (Excellent/Strong/OK/Partial) | `[UX]` | ✅ Live |
| 14 | AI fitment summary per card (streaming, Claude Haiku) | `[UX]` | ✅ Live |

---

## Decisions

### 1. `[INFRA]` Framework: Next.js App Router

**TL;DR:** Next.js gives us frontend + API routes in one project — no separate backend.

**Status:** ✅ Live

**Decision:** Use Next.js as the full-stack framework.
**Reason:** Gives us both the frontend and API routes in a single project. No separate backend needed. Simple to deploy on Vercel.
**Alternatives considered:** Plain HTML + Express, Python Flask, Vite + separate Node API.

---

### 2. `[SEARCH]` Embedding model: Voyage AI `voyage-3`

**TL;DR:** Voyage `voyage-3` is Anthropic's recommended partner, supports asymmetric embeddings, costs ~$0.60 for full ingestion.

**Status:** ✅ Live

**Decision:** Use Voyage AI for generating embeddings, not OpenAI or a local model.
**Reason:** Voyage AI is Anthropic's recommended embeddings partner. `voyage-3` produces 1024-dimensional vectors and supports asymmetric embeddings (`input_type: 'document'` for ingestion, `input_type: 'query'` for search), which improves retrieval accuracy.
**Alternatives considered:** OpenAI `text-embedding-3-small`, Cohere.
**Cost:** ~$0.06/1M tokens. Full ingestion of 30K profiles cost ~$0.60, covered by the free $10 credit.
**Note:** Requires a payment method on file to unlock standard rate limits (3 RPM free → 300+ RPM with card). Add card at dashboard.voyageai.com. Upgrade path: `voyage-3-large` for higher accuracy.

---

### 3. `[INFRA]` Vector database: Supabase + pgvector

**TL;DR:** Supabase = PostgreSQL + pgvector + REST API in one, generous free tier, no separate vector DB.

**Status:** ✅ Live

**Decision:** Use Supabase (PostgreSQL + pgvector extension) for storing and searching vectors.
**Reason:** Simple to set up, generous free tier, built-in REST API (PostgREST), and pgvector handles similarity search natively in SQL. No separate vector DB needed.
**Alternatives considered:** Pinecone, Weaviate, Qdrant.

---

### 4. `[SEARCH]` Vector index: HNSW

**TL;DR:** HNSW needs no training step, queries complete under 50ms at 30K rows.

**Status:** ✅ Live

**Decision:** Use HNSW index with `m=16, ef_construction=64`.
**Reason:** HNSW requires no training step (IVFFlat does), better for datasets under 1M rows, and gives faster queries. At 30K rows, queries complete in under 50ms.
**SQL:**
```sql
create index candidates_embedding_hnsw
  on candidates using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
```

---

### 5. `[SEARCH]` Similarity metric: Cosine similarity

**TL;DR:** Cosine (`<=>`) measures semantic meaning regardless of text length — Voyage AI optimises for it.

**Status:** ✅ Live

**Decision:** Use cosine distance (`<=>` operator in pgvector) for ranking.
**Reason:** Cosine measures the angle between vectors, capturing semantic meaning regardless of text length. Voyage AI optimizes for cosine similarity. It's the standard for text retrieval.
**Alternatives available in pgvector:** Euclidean distance (`<->`), Inner product (`<#>`).

---

### 6. `[SEARCH]` Text representation for embedding

**TL;DR:** Flatten each candidate's JSONL into a structured plain-text string; headline + skills carry most signal.

**Status:** ✅ Live

**Decision:** Flatten each candidate's nested JSONL record into a structured plain-text string before embedding.
**Format:**
```
Name: {name}
Headline: {headline}
Location: {address}
Summary: {summary}            ← HTML-stripped
Skills: {skill1}, {skill2}, ... ← up to 20
Experience 1: {title} at {company} ({date}). {description_500chars}
... ← up to 5 experiences
Education: {degree} at {school} ({date}) ← first entry only
```
**Reason:** Headline and skills carry the highest semantic signal. Descriptions are truncated at 500 chars to avoid diluting the embedding with boilerplate. Experience limited to 5 most recent.

---

### 7. `[DEV]` Ingestion: Streaming + batching

**TL;DR:** Stream 207MB JSONL line-by-line, embed in batches of 128, resume-safe via UID pre-fetch.

**Status:** ✅ Live

**Decision:** Stream the 207MB JSONL file line-by-line, embed in batches of 128, upsert to Supabase in chunks.
**Reason:** Loading 207MB into memory would be wasteful. Streaming keeps peak memory under 50MB. Voyage AI's batch limit is 128 inputs per request.
**Resume support:** On startup, fetch all existing UIDs from Supabase into a Set and skip them. Safe to re-run after interruption.
**Bad record handling:** If a batch fails to embed or upsert, retry row-by-row and skip any problematic record rather than crashing.

---

### 8. `[DEV]` Native `fetch` instead of SDKs

**TL;DR:** Both `voyageai` and `dotenv` SDKs had ESM failures on Node 25 — native `fetch` has zero deps and just works.

**Status:** ✅ Live

**Decision:** Use Node.js native `fetch` for all API calls in the ingestion script (not their SDKs).
**Reason:** Both `voyageai` and `@supabase/supabase-js` had ESM resolution issues on Node.js v25.9.0. Native fetch (available since Node 18) has zero dependencies and avoids the problem entirely.
**Note:** The Next.js API routes also call Voyage AI and Anthropic via native fetch.

---

### 9. `[DEV]` Environment variables: `--env-file` flag

**TL;DR:** Node 20.6+ has a built-in `--env-file` flag — no `dotenv` package needed.

**Status:** ✅ Live

**Decision:** Use Node's built-in `--env-file=.env.local` flag instead of the `dotenv` package.
**Reason:** `dotenv` had ESM resolution issues on Node 25. The `--env-file` flag was added in Node 20.6.0 and works natively.
**Script:** `"ingest": "node --env-file=.env.local scripts/ingest.mjs"`

---

### 10. `[DEV]` Supabase vector format: string not array

**TL;DR:** PostgREST requires `"[0.1,0.2,...]"` as a string — a JSON array causes PGRST102 error.

**Status:** ✅ Live

**Decision:** Send embedding vectors to Supabase as a string `"[0.1,0.2,...]"` not a JSON array.
**Reason:** PostgREST requires the pgvector literal format (a string) to correctly cast to the `vector(1024)` column type. A raw JSON array causes a `PGRST102` parse error.

---

### 11. `[UX]` Score display: dual raw % badges

**TL;DR:** Showing raw % scores was misleading — 56% looks weak but is a strong match. Replaced by Decision 13.

**Status:** ⚠️ Superseded by Decision 13

**Decision (original):** Show two score badges per card — purple "Relevance" (reranker × 100) and green "Similarity" (cosine × 100).
**Why it was replaced:** Raw percentages implied "X% of perfect" which confused users. A perfect title match ("AI Engineer") scores only 66% relevance because reranker scores are relative to the 50-candidate pool — not absolute. The numbers looked weak even for excellent matches.

---

### 12. `[SEARCH]` Four-pass retrieval pipeline

**TL;DR:** Query rewrite → embed top 200 → rerank top 50 → deterministic must-have boost → show top 50 (paginated at 10).

**Status:** ✅ Live

**Full pipeline:**
```
Pass 0 — Query rewrite (Claude Haiku)
         Fix typos, remove filler, preserve all requirements
         ↓
Pass 1 — Embed rewritten query (Voyage voyage-3)
         Vector search top 200 from Supabase HNSW
         ↓
Pass 2a — Rerank top 200 → top 50 (Voyage rerank-2-lite)
          Cross-attention pass: query vs each candidate snippet
         ↓
Pass 2b — Deterministic must-have boost (in-memory)
          Normalise text, expand aliases, float must-have matches to top
         ↓
Return top 50, paginated at 10/page
```

**Pass 0 — Query rewrite:** Claude Haiku cleans messy user input (typos, conversational filler) into professional language before embedding. Graceful fallback: if the Claude call fails, the original query is used.

**Pass 1 — Pool size 200:** Increased from 50 to 200. A strong match at rank #51 was previously invisible to the reranker.

**Pass 2a — Rerank:** Voyage `rerank-2-lite` cross-encodes query against each of 200 candidate snippets, returning top 50 ordered by true relevance. Upgrade path: `rerank-2` for higher accuracy.

**Pass 2b — Deterministic boost:**
- Normalise: lowercase, collapse hyphens/punctuation
- Alias expansion: Bengaluru/Bangalore/BLR, BFSI/insurance/banking, Hyd/Hyderabad, Delhi/NCR/Gurgaon, fintech/fin-tech
- Stable sort: must-have matches float to top; reranker order preserved within groups; non-matches still shown
- No additional API calls — runs in-memory in milliseconds

**Snippet sent to reranker:** `{name}. {headline}. Skills: {skills}. {top_exp_title} at {company}.`

---

### 13. `[UX]` Score display: normalised labels

**TL;DR:** Normalise scores within the pool-of-50 range, then bucket into Excellent/Strong/OK/Partial — no misleading %.

**Status:** ✅ Live

**Decision:** Replace raw % badges with human-readable labels derived from normalised position within the result pool.

**How it works:**
1. `poolMin` = reranker score of the 50th result; `poolMax` = score of the 1st result
2. `normStrength = (score − poolMin) / (poolMax − poolMin)` → 0 to 1 scale
3. Label buckets: ≥0.75 → **Excellent** (gold) · ≥0.50 → **Strong** (silver) · ≥0.25 → **OK** (pink) · <0.25 → **Partial** (blue)
4. A relative strength bar at the bottom of each card shows `score / poolMax` as a visual fill

**Important caveat:** Labels reflect relative position within this search's result set — not absolute quality. A "Partial" match here may still be a genuinely good candidate for a different query. Results below 30% normStrength are hidden entirely.

---

### 14. `[UX]` AI fitment summary per card

**TL;DR:** Replace skill chips + criterion pills with a 2-sentence Claude Haiku summary streamed per card — grounded in profile data only.

**Status:** ✅ Live

**Decision:** Each candidate card shows a streaming AI-generated summary explaining why that candidate fits (or partially fits) the search query.

**Why:** Skill chips were inconsistent (missing from many profiles). Criterion pills (✓/✗ per field) conflicted with the AI match score — a candidate could be "Excellent" but show ✗ Location because keyword matching doesn't understand synonyms. An AI summary is more useful and eliminates the contradiction.

**Implementation:**
- `POST /api/summarize` — streaming endpoint, called per card on mount
- Prompt is strictly grounded in the candidate's actual profile text — no inference beyond what's written
- Streams word-by-word; "Analysing fit…" placeholder shown while loading
- Fallback: if call fails, no summary shown (card still renders correctly)
- Model: `claude-haiku-4-5` (fast, cheap, good enough for 2-sentence summaries)

**Tradeoffs:** 10 parallel Haiku calls per page load adds latency (hidden by streaming). Cost is ~$0.001 per summary. Hallucination risk is low when prompt is tightly grounded.

---

## Pending / Under Consideration

| Priority | Item | Notes |
|----------|------|-------|
| 🔴 High | **Exclusions nudge** | "Anyone to exclude?" step in nudge flow → keyword hard-filter pre-vector + soft signal in query for reranker. Fuzzy alias matching already in place for must-haves; same logic applies. |
| 🟡 Medium | **Hybrid search** | Combine vector similarity with Postgres full-text search on `headline` + `skills`. Helps exact keyword matches (company names, school names, specific tools). |
| 🟡 Medium | **Multi-vector search** | Embed query as separate chunks (role, location, skills) and blend scores with per-dimension weights. Next ceiling after must-have boost. |
| 🟢 Low | **Embedding model upgrade** | `voyage-3-large` for higher accuracy; `voyage-code-2` for tech-heavy profiles. |
| 🟢 Low | **Feedback loop** | No signal on which results were good. Click/hire data would allow ranking to improve over time. |
| 🟢 Low | **Retrieval pool expansion** | Increase from 200 → 500 for rare must-have criteria (e.g. very specific location + niche role). |
