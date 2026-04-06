# Design Decisions

A chronological log of architectural and product decisions for the candidate search app.

---

## 2026-04-05

### 1. Framework: Next.js 14+ (App Router)
**Decision:** Use Next.js as the full-stack framework.
**Reason:** Gives us both the frontend and API routes in a single project. No separate backend needed. Simple to deploy later.
**Alternatives considered:** Plain HTML + Express, Python Flask, Vite + separate Node API.

---

### 2. Embedding model: Voyage AI `voyage-3`
**Decision:** Use Voyage AI for generating embeddings, not OpenAI or a local model.
**Reason:** Voyage AI is Anthropic's recommended embeddings partner. `voyage-3` produces 1024-dimensional vectors and supports asymmetric embeddings (different treatment for documents vs queries), which improves retrieval accuracy.
**Alternatives considered:** OpenAI `text-embedding-3-small`, Cohere.
**Cost:** ~$0.06/1M tokens. Full ingestion of 30K profiles cost ~$0.60, covered by the free $10 credit.
**Note:** Voyage AI requires a payment method on file to unlock standard rate limits (3 RPM free vs 300+ RPM with card). Add card at dashboard.voyageai.com.

---

### 3. Vector database: Supabase with pgvector
**Decision:** Use Supabase (PostgreSQL + pgvector extension) for storing and searching vectors.
**Reason:** Simple to set up, generous free tier, built-in REST API, and pgvector handles similarity search natively in SQL. No separate vector DB needed.
**Alternatives considered:** Pinecone, Weaviate, Qdrant.

---

### 4. Vector index: HNSW (not IVFFlat)
**Decision:** Use HNSW index with `m=16, ef_construction=64`.
**Reason:** HNSW requires no training step (IVFFlat does), better for datasets under 1M rows, and gives faster queries. At 30K rows, queries complete in under 50ms.
**SQL:** `create index candidates_embedding_hnsw on candidates using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);`

---

### 5. Similarity metric: Cosine similarity
**Decision:** Use cosine distance (`<=>` operator in pgvector) for ranking.
**Reason:** Cosine measures the angle between vectors, which captures semantic meaning regardless of text length. Voyage AI optimizes for cosine similarity. It's the standard for text retrieval.
**Alternatives available in pgvector:** Euclidean distance (`<->`), Inner product (`<#>`).

---

### 6. Text representation for embedding
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

### 7. Ingestion approach: Streaming + batching
**Decision:** Stream the 207MB JSONL file line-by-line, embed in batches of 128, upsert to Supabase in chunks.
**Reason:** Loading 207MB into memory would be wasteful. Streaming keeps peak memory under 50MB. Voyage AI's batch limit is 128 inputs per request.
**Resume support:** On startup, fetch all existing UIDs from Supabase into a Set and skip them. Safe to re-run after interruption.
**Bad record handling:** If a batch fails to embed or upsert, retry row-by-row and skip any problematic record rather than crashing.

---

### 8. SDK vs native fetch
**Decision:** Use Node.js native `fetch` for both Voyage AI and Supabase API calls in the ingestion script (not their SDKs).
**Reason:** Both `voyageai` and `@supabase/supabase-js` had ESM resolution issues on Node.js v25.9.0. Native fetch (available since Node 18) has zero dependencies and avoids the problem entirely.
**Note:** The Next.js API route still uses `@supabase/supabase-js` (works fine in the Next.js runtime), but calls Voyage AI directly via fetch.

---

### 9. Environment variable loading: `--env-file` flag
**Decision:** Use Node's built-in `--env-file=.env.local` flag instead of the `dotenv` package.
**Reason:** `dotenv` had the same ESM resolution issues on Node 25. The `--env-file` flag was added in Node 20.6.0 and works natively.
**Script:** `"ingest": "node --env-file=.env.local scripts/ingest.mjs"`

---

### 10. Supabase upsert: vector format
**Decision:** Send embedding vectors to Supabase as a string `"[0.1,0.2,...]"` not a JSON array.
**Reason:** PostgREST requires the pgvector literal format (a string) to correctly cast to the `vector(1024)` column type. A raw JSON array causes a `PGRST102` parse error.

---

### 11. Match score display: two scores side by side
**Decision:** Show two scores on each candidate card — "vs others" (blue) and "to query" (green).
- **"to query"** — raw cosine similarity × 100. Absolute measure of how semantically close the candidate is to the query. Comparable across different searches.
- **"vs others"** — rescaled score within the current result set. Best result = 100%, worst shown = 0%. Makes it easy to compare candidates within a search.
**Reason:** Raw cosine scores cluster in a narrow range (e.g. 53–57%) which makes them hard to use for ranking. The rescaled score gives intuitive relative ranking within a search.

---

### 12. Four-pass retrieval pipeline
**Decision:** Implement a four-pass pipeline: query rewrite → vector search → rerank → deterministic boost.

**Full pipeline:**
```
Pass 0 — Query rewrite (Claude Haiku)
         Fix typos, remove conversational filler, preserve all requirements
         ↓
Pass 1 — Embed rewritten query (Voyage voyage-3) → vector search top 200 (Supabase HNSW)
         ↓
Pass 2a — Rerank top 200 → top 50 (Voyage rerank-2-lite)
          Cross-attention pass over query + each candidate snippet
         ↓
Pass 2b — Deterministic must-have boost
          Normalise text, expand aliases, float must-have matches to top
         ↓
Return top 20
```

**Pass 0 — Query rewrite:**
Raw user input is messy — typos, conversational phrasing ("yeah they should have..."), repeated terms. Claude Haiku rewrites the composed query into clean, professional language before embedding. This improves embedding quality since the model encodes intent more precisely from clean text. Graceful fallback: if the Claude call fails, the original query is used and search continues.

**Pass 1 — Vector search pool: 50 → 200:**
Increased retrieval pool from 50 to 200. The reranker can only surface candidates within this initial pool — a strong match at rank #51 was previously invisible. 200 gives far more headroom for the reranker and deterministic pass to work with, at acceptable latency.

**Pass 2a — Rerank:**
Voyage `rerank-2-lite` cross-encodes the query against each of the 200 candidate snippets, returning top 50 ordered by true relevance (not just vector proximity). More accurate than cosine similarity alone.

**Pass 2b — Deterministic must-have boost:**
After reranking, a lightweight in-memory pass applies hard recruiter requirements:
- **Normalise:** lowercase, collapse hyphens/punctuation to spaces before any comparison
- **Alias expansion:** common Indian job-market synonyms mapped (e.g. Bengaluru/Bangalore/BLR, BFSI/insurance/banking/underwriting, Hyd/Hyderabad, Delhi/NCR/Gurgaon, fintech/fin-tech)
- **Stable sort:** must-have matches float to top; reranker order preserved within each group; non-matches still shown below, not discarded
- No additional API calls — runs in memory on the 50 reranked results

**Snippet format sent to reranker:** `{name}. {headline}. Skills: {skill1, skill2...}. {top_exp_title} at {company}.`
**Models:** Claude Haiku (rewrite), voyage-3 (embed), rerank-2-lite (rerank). Upgrade rerank-2-lite → rerank-2 for higher accuracy if needed.

### 13. Score display: what the numbers actually mean
**Decision:** Show two scores per card — purple "Relevance" (rerank) and green "Similarity" (cosine).
**Important caveat documented here:**
- **Similarity %** — closer to absolute. Raw cosine score × 100. Comparable across different searches. A strong match like an exact title query ("AI Engineer") will still only score ~56% because the 2-word query vector is compared against a full rich profile embedding — the angle between them is never close to 1.0. This is normal; 50–60% is a strong match in this system.
- **Relevance %** — relative to the pool of 50 retrieved candidates. It does NOT mean "X% of perfect." A 66% Relevance for a perfect title match is expected and correct. These scores are only meaningful for ordering within a single search, not comparing across searches.
**Pending:** Consider replacing raw % with a bar, a bucketed label (Strong/Good/Partial), or rank position (#1, #2...) to avoid the misleading "% of perfect" implication.

---

## Decisions Pending / Under Consideration

- **Score display UX:** Raw % numbers are misleading (56% looks weak but is actually a strong match). Options: progress bar, bucketed labels (Strong/Good/Partial), or rank position (#1, #2...).
- **Exclusions nudge:** Add a dedicated "Anyone to exclude?" step in the nudge flow. Drive a keyword hard-filter at the Supabase query level (pre-vector) and a soft signal in the query for the reranker. Fuzzy alias matching already in place for must-haves; same logic applies to exclusions.
- **Multi-vector search:** Embed the query as separate chunks (role, location, skills, education) and blend scores with per-dimension weights. Gives finer control over what matters most per search. Current architecture handles this well already via the must-have boost; full multi-vector is the next ceiling.
- **Hybrid search:** Combine vector similarity with Postgres full-text search on `headline` and `skills` columns. Helps exact keyword matches (e.g. "IIT Bombay", "Kubernetes").
- **Feedback loop:** No signal on which results were actually good. Click/hire data would allow ranking to improve over time.
- **Embedding model upgrade:** `voyage-3-large` for higher accuracy, or `voyage-code-2` for tech profiles specifically.
