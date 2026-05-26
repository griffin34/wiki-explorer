Now build my wiki. Create a wiki.md file and the full folder structure. Use the raw/ subfolders you proposed above, and always include an inbox/ folder as the landing zone for anything new or unsorted.

**This is the canonical schema for this wiki. All LLM-specific instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/wiki.mdc`) point here. Do not edit those files — edit this one.**

Follow these architecture rules exactly:

FOLDER STRUCTURE:

[wiki name from first prompt]-wiki/
  wiki.md              # this file -- the operating manual
  raw/                 # source material, un-distilled
    inbox/             # always present -- landing zone for anything new or unsorted
    [your proposed folders from above]
  wiki/                # curated pages, organized by category
    index.md           # master index of all pages
    log.md             # chronological log of all actions
    summaries/         # one summary per raw source (the bridge between raw and wiki)
    people/            # one page per person
    projects/          # initiatives, deals, workstreams, decisions
    concepts/          # ideas, frameworks, topics, companies

RAW/ RULES:
- raw/ content is IMMUTABLE -- you never edit the content of a source file.
- You DO organize raw/ -- when something lands in inbox/, read it, rename it using the convention YYYY-MM-DD-descriptive-slug (keep the original file extension), and move it to the right bucket from the folders above.
- If you're unsure about the date, use the date you processed it.

WIKI/ RULES:
- wiki/ is your territory. You create and maintain everything here. I review but don't hand-edit.
- Every wiki page traces back to at least one source in raw/.
- Contradictions are surfaced, not silently resolved. When two sources disagree, note both positions.## What the LLM Should NOT Do
- never hallucinate citations, only cite raw sources that exist in 'raw/'.
- do not over-normalize.  Sometimes a note is just a note, not everyhting needs an entity page
- never delete wiki pages without explicit permission
- Never send the wiki data to exteral services

PAGE FORMAT:
Every wiki page starts with YAML frontmatter:
---
title: "Page Title"
type: (freeform -- use whatever label fits: person, project, concept, tool, summary, framework, etc.)
sources:
  - raw/clippings/2026-05-14-some-article.md
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
Use [[wikilinks]] to connect pages (e.g., [[concepts/error-analysis]], [[people/lenny-rachitsky]]). The folder provides the primary organization. The type tag is flexible metadata -- use whatever label describes the page best. New types can emerge naturally as the wiki grows.

THREE OPERATIONS (include these in wiki.md):

1. ADD -- when I add a file to raw/ (or raw/inbox/):
   - If it's in inbox/, rename it (YYYY-MM-DD-slug) and move it to the right format bucket
   - Read the source fully
   - Create a summary page in wiki/summaries/
   - Create or update people pages for anyone mentioned
   - Create or update concept pages for key ideas, frameworks, tools, companies
   - Create or update project pages if it relates to ongoing work
   - Add [[wikilinks]] between all related pages
   - Update index.md and log.md

2. ASK -- when I ask a question:
   - Check index.md for relevant pages
   - Read those pages, follow wikilinks as needed
   - Answer with citations to wiki pages
   - If I say "save this," file it as a new page in the most relevant wiki/ subfolder

3. TIDY UP -- when I say "tidy up" or "health check":
   - Flag contradictions between pages
   - Find orphan pages (no inbound links)
   - Find broken wikilinks (pages that don't exist yet)
   - Review the type tags across all pages -- flag types that have grown common enough to deserve their own folder, and suggest consolidating similar types (e.g., "you have 6 pages tagged 'tool' and 4 tagged 'software' -- want a tools/ folder?")
   - If log.md exceeds 50 entries, archive everything older than 30 days to wiki/log-archive-YYYY-MM.md and keep only recent entries in log.md
   - Suggest 3-5 questions the wiki could answer based on what's in it

STYLE:
- Clear, direct prose. Active voice.
- Summaries: lead with executive summary, bullet key claims, note the source
- People: brief-style (who, role, why they matter, key facts)
- Projects: status, goal, key decisions, related people and concepts
- Concepts: wiki-article (definition, why it matters, where sources agree/disagree)
- Pages should be **self-contained** — assume the reader hasn't read the source.
- Use headers (`##`, `###`) to structure longer pages. Keep pages readable without the sidebar.
- Use wiki links liberally — more links = richer graph.
- Keep source summary pages **neutral** — save synthesis and opinion for concept/analysis pages.
- When a claim is uncertain, tag the page with `unresolved` and note the uncertainty explicitly.
- If new information **contradicts** an existing claim, don't silently overwrite — note the contradiction in a "Contradictions" section and flag both pages with `contradiction` tag.




Keep the wiki.md concise -- around 60-80 lines. It's a starter, not an encyclopedia. I can expand it later.

Then create the full folder structure with empty index.md and log.md starter files in wiki/.
