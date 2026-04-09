# Ideas

## Search & Results

### Use enriched fields in AI summaries
Currently the summarize API only reads raw profile fields (headline, summary, skills, top_experience).
It doesn't have access to the 83 enriched fields (mobility_likelihood, avg_tenure_years, builder_score, ownership_score, etc.).
Updating the summarize API to fetch and pass enriched fields to Claude would allow summaries to say things like:
- "Stable tenure averaging 4 years per role"
- "Builder score 8/10 with two 0-to-1 products"
- "High mobility likelihood — recently changed roles twice in 18 months"
