---
name: create-wiki
description: Creates a personal second-brain wiki. Use when the user says "create my wiki", "set up my wiki", or "/create-wiki". Walks through 3 steps: personalizing the template with the user's details, approving the proposed folder structure, then building the full wiki and installing AI assistant rules for future use.
disable-model-invocation: true
---

# Create Wiki

Builds a personal second-brain wiki from the templates in `.prompts/`. Three steps — do not skip ahead or combine steps.

## Step 1: Personalize

Read `.prompts/initial-prompt.md`.

Display the template and ask the user to provide three things:

- **Wiki name** — what to call the wiki folder (e.g. "my-wiki", "work-brain", "pm-notes")
- **3–5 topics I care about** — the domains this wiki should cover
- **What I'd drop into it** — the types of source material they'll capture

Replace the three bracketed placeholders with their answers and submit the completed prompt. Present the AI's proposed `raw/` subfolder structure to the user.

**Stop here. Wait for the user to explicitly approve the proposed folders before continuing.**

## Step 2: Build the wiki

Once the user approves the folder structure, read `.prompts/second-prompt.md` and execute its full contents as a prompt.

Use the wiki name provided in Step 1 as the root folder name (e.g. if they said "pm-notes", create `pm-notes/` instead of `ai-memory-wiki/`). Apply this substitution consistently across all files and paths created in this step.

This creates:
- `<wiki-name>/wiki.md` — the operating manual
- Full `raw/` and `wiki/` folder structure
- Starter `wiki/index.md` and `wiki/log.md` files

## Step 3: Install the AI rules

Read `.prompts/llm-rules.md`. Write its contents to all three locations below (under `<wiki-name>/`) so the wiki works regardless of which AI assistant the user opens it with later.

**CLAUDE.md** — for Claude Code:
Create `<wiki-name>/CLAUDE.md` in the wiki root (or append if it already exists).

**.cursor/rules/wiki-assistant.mdc** — for Cursor:
Create `<wiki-name>/.cursor/rules/wiki-assistant.mdc` with this frontmatter, then the rules content:

```
---
description: Operating rules for the <wiki-name> second-brain
alwaysApply: true
---
```

**.github/copilot-instructions.md** — for GitHub Copilot:
Create `<wiki-name>/.github/copilot-instructions.md` in the wiki root (or append if it already exists).
