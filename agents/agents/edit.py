from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

import yaml

from agents.ingestion import find_content_root
from config import settings
from models.schemas import (
    WikiConfig,
    EditPreviewResponse,
    EditApplyResponse,
    PageChange,
    EditHunk,
)
from services.changelog_service import ChangelogService, ChangelogEntry
from services.chroma_service import ChromaService
from services.llm_router import LLMRouter

logger = logging.getLogger(__name__)

_PARSE_INSTRUCTION_SYSTEM = (
    "You are a precise text analysis assistant. Extract entities and intent "
    "from edit instructions. Respond ONLY with valid JSON."
)

_PARSE_INSTRUCTION_PROMPT = """\
Analyze this edit instruction and extract the relevant entities:

Instruction: {instruction}

Respond with JSON in this exact format:
{{
  "change_type": "replacement" | "addition" | "removal" | "update",
  "old_entity": "the entity being replaced/removed (null if addition)",
  "new_entity": "the new entity (null if removal)",
  "context": "additional context about the change",
  "search_terms": ["term1", "term2"]
}}
"""

_EDIT_PAGE_SYSTEM = (
    "You are a precise wiki editor. Make targeted changes while preserving "
    "historical accuracy. Output the complete updated page content."
)

_EDIT_PAGE_PROMPT = """\
You are editing a wiki page based on this instruction:
"{instruction}"

Current page content:
---
{page_content}
---

Entity mapping:
- Old: {old_entity}
- New: {new_entity}
- Change date: {change_date}

Rules:
1. Replace references to the old entity with the new entity
2. For historical facts (past events), keep the original name but add a note
3. For current roles/responsibilities, update to the new entity
4. Add transition notes where context is helpful
5. Preserve all other content exactly
6. Keep the frontmatter structure intact, only update 'modified' date

Output the complete updated page content (including frontmatter).
"""


def _extract_frontmatter(text: str) -> tuple[dict, str]:
    """Extract YAML frontmatter and body from a Markdown string."""
    stripped = text.strip()
    if not stripped.startswith("---"):
        return {}, text
    
    parts = stripped[3:].split("---", 1)
    if len(parts) < 2:
        return {}, text
    
    try:
        frontmatter = yaml.safe_load(parts[0]) or {}
    except yaml.YAMLError:
        frontmatter = {}
    
    body = parts[1].strip() if len(parts) > 1 else ""
    return frontmatter, body


def _reconstruct_page(frontmatter: dict, body: str) -> str:
    """Reconstruct a page with updated frontmatter."""
    if not frontmatter:
        return body
    
    fm_str = yaml.dump(frontmatter, default_flow_style=False, allow_unicode=True)
    return f"---\n{fm_str}---\n\n{body}"


def _compute_hunks(old_lines: list[str], new_lines: list[str]) -> list[EditHunk]:
    """Compute edit hunks by comparing old and new line lists."""
    hunks: list[EditHunk] = []
    
    # Simple diff: find contiguous regions of change
    i = 0
    while i < max(len(old_lines), len(new_lines)):
        # Skip matching lines
        if i < len(old_lines) and i < len(new_lines) and old_lines[i] == new_lines[i]:
            i += 1
            continue
        
        # Found a difference - collect the hunk
        hunk_start = i + 1  # 1-indexed
        old_hunk: list[str] = []
        new_hunk: list[str] = []
        
        # Collect differing lines
        while i < max(len(old_lines), len(new_lines)):
            old_line = old_lines[i] if i < len(old_lines) else None
            new_line = new_lines[i] if i < len(new_lines) else None
            
            if old_line == new_line:
                break
            
            if old_line is not None:
                old_hunk.append(old_line)
            if new_line is not None:
                new_hunk.append(new_line)
            i += 1
        
        if old_hunk or new_hunk:
            hunks.append(EditHunk(
                line_start=hunk_start,
                line_end=hunk_start + max(len(old_hunk), len(new_hunk)) - 1,
                before="\n".join(old_hunk),
                after="\n".join(new_hunk),
            ))
    
    return hunks


def _generate_edit_id() -> str:
    """Generate a unique edit ID."""
    return f"edit_{hashlib.md5(datetime.utcnow().isoformat().encode()).hexdigest()[:8]}"


class EditAgent:
    """Agent for AI-powered bulk edits and manual edits with change tracking."""

    def __init__(
        self,
        llm: LLMRouter,
        chroma: ChromaService,
        changelog: ChangelogService,
    ) -> None:
        self._llm = llm
        self._chroma = chroma
        self._changelog = changelog
        # Store pending edit previews by edit_id
        self._pending_edits: dict[str, dict] = {}

    async def _resolve_wiki_path(self, wiki_id: str) -> tuple[Path, WikiConfig]:
        """Resolve wiki path from vaults.json."""
        try:
            raw = await asyncio.to_thread(settings.vaults_file.read_text)
            data = json.loads(raw)
        except Exception as exc:
            raise RuntimeError(f"Could not read vaults.json: {exc}")

        for w in data.get("vaults", []):
            if w["id"] == wiki_id:
                wiki_config = WikiConfig(**w)
                content_root = await asyncio.to_thread(
                    find_content_root, Path(wiki_config.path)
                )
                if content_root is None:
                    raise RuntimeError(f"No content root for wiki {wiki_id}")
                return content_root, wiki_config

        raise RuntimeError(f"Wiki {wiki_id!r} not found in vaults.json")

    async def _parse_instruction(self, instruction: str) -> dict:
        """Parse an edit instruction to extract entities and intent."""
        prompt = _PARSE_INSTRUCTION_PROMPT.format(instruction=instruction)
        
        try:
            response = await self._llm.generate(prompt, system=_PARSE_INSTRUCTION_SYSTEM)
            # Extract JSON from response
            json_match = re.search(r'\{[\s\S]*\}', response)
            if not json_match:
                raise ValueError("No JSON found in response")
            return json.loads(json_match.group())
        except Exception as exc:
            logger.warning("Failed to parse instruction: %s", exc)
            # Fallback: use instruction as search term
            return {
                "change_type": "update",
                "old_entity": None,
                "new_entity": None,
                "context": instruction,
                "search_terms": instruction.split()[:5],
            }

    async def _find_affected_pages(
        self,
        wiki_id: str,
        content_root: Path,
        search_terms: list[str],
    ) -> list[tuple[str, str]]:
        """Find pages affected by the edit using semantic search and grep.
        
        Returns:
            List of (page_slug, page_content) tuples
        """
        wiki_dir = content_root / "wiki"
        if not await asyncio.to_thread(wiki_dir.exists):
            return []

        found_pages: dict[str, str] = {}

        # 1. Semantic search via ChromaDB
        for term in search_terms[:3]:  # Limit to top 3 terms
            try:
                query_embedding = await self._llm.embed(term)
                results = await self._chroma.query_chunks(
                    wiki_id,
                    query_embedding=query_embedding,
                    n_results=10,
                )
                
                metadatas = (results.get("metadatas") or [[]])[0]
                for meta in metadatas:
                    wiki_page = meta.get("wiki_page")
                    if wiki_page:
                        page_file = wiki_dir / f"{wiki_page}.md"
                        if await asyncio.to_thread(page_file.exists):
                            content = await asyncio.to_thread(page_file.read_text, "utf-8")
                            found_pages[wiki_page] = content
            except Exception as exc:
                logger.warning("Semantic search for '%s' failed: %s", term, exc)

        # 2. Direct grep of wiki files
        try:
            md_files = await asyncio.to_thread(list, wiki_dir.glob("**/*.md"))
            for md_file in md_files:
                if md_file.name.startswith("."):
                    continue
                    
                slug = md_file.stem
                if slug in found_pages:
                    continue
                
                content = await asyncio.to_thread(md_file.read_text, "utf-8")
                content_lower = content.lower()
                
                # Check if any search term appears in the content
                for term in search_terms:
                    if term.lower() in content_lower:
                        found_pages[slug] = content
                        break
        except Exception as exc:
            logger.warning("Grep search failed: %s", exc)

        return list(found_pages.items())

    async def preview_edit(
        self,
        wiki_id: str,
        instruction: str,
    ) -> EditPreviewResponse:
        """Parse instruction, find affected pages, and generate proposed edits.
        
        Args:
            wiki_id: The wiki ID
            instruction: Natural language edit instruction
            
        Returns:
            EditPreviewResponse with proposed changes
        """
        content_root, wiki_config = await self._resolve_wiki_path(wiki_id)
        
        # Parse the instruction
        parsed = await self._parse_instruction(instruction)
        logger.info("Parsed instruction: %s", parsed)
        
        old_entity = parsed.get("old_entity") or ""
        new_entity = parsed.get("new_entity") or ""
        search_terms = parsed.get("search_terms", [])
        
        # Add old_entity to search terms if present
        if old_entity and old_entity not in search_terms:
            search_terms.insert(0, old_entity)
        
        # Find affected pages
        affected_pages = await self._find_affected_pages(
            wiki_id, content_root, search_terms
        )
        
        if not affected_pages:
            edit_id = _generate_edit_id()
            return EditPreviewResponse(
                edit_id=edit_id,
                instruction=instruction,
                changes=[],
                affected_pages=[],
                preview_diff="No pages found matching the instruction.",
            )
        
        # Generate edits for each page
        changes: list[PageChange] = []
        change_date = datetime.utcnow().strftime("%Y-%m-%d")
        
        for slug, original_content in affected_pages:
            try:
                # Generate edited content via Ollama
                prompt = _EDIT_PAGE_PROMPT.format(
                    instruction=instruction,
                    page_content=original_content,
                    old_entity=old_entity or "(not specified)",
                    new_entity=new_entity or "(not specified)",
                    change_date=change_date,
                )
                
                edited_content = await self._llm.generate(
                    prompt, system=_EDIT_PAGE_SYSTEM
                )
                
                # Compute hunks
                old_lines = original_content.splitlines()
                new_lines = edited_content.splitlines()
                hunks = _compute_hunks(old_lines, new_lines)
                
                if hunks:  # Only include pages with actual changes
                    # Get current revision from frontmatter
                    fm, _ = _extract_frontmatter(original_content)
                    current_revision = fm.get("revision", 0)
                    
                    changes.append(PageChange(
                        page=f"{slug}.md",
                        revision=current_revision + 1,
                        hunks=hunks,
                        original_content=original_content,
                        edited_content=edited_content,
                    ))
            except Exception as exc:
                logger.error("Failed to generate edit for %s: %s", slug, exc)
                continue
        
        # Generate unified diff preview
        diff_lines: list[str] = []
        for change in changes:
            diff_lines.append(f"--- {change.page}")
            diff_lines.append(f"+++ {change.page} (revision {change.revision})")
            for hunk in change.hunks:
                diff_lines.append(f"@@ -{hunk.line_start},{hunk.line_end} @@")
                for line in hunk.before.splitlines():
                    diff_lines.append(f"- {line}")
                for line in hunk.after.splitlines():
                    diff_lines.append(f"+ {line}")
            diff_lines.append("")
        
        edit_id = _generate_edit_id()
        
        # Store pending edit for later application
        self._pending_edits[edit_id] = {
            "wiki_id": wiki_id,
            "instruction": instruction,
            "changes": changes,
            "content_root": str(content_root),
        }
        
        return EditPreviewResponse(
            edit_id=edit_id,
            instruction=instruction,
            changes=changes,
            affected_pages=[c.page for c in changes],
            preview_diff="\n".join(diff_lines),
        )

    async def apply_edit(
        self,
        wiki_id: str,
        edit_id: str,
        selected_pages: Optional[list[str]] = None,
    ) -> EditApplyResponse:
        """Apply approved changes from a preview.
        
        Args:
            wiki_id: The wiki ID
            edit_id: The edit ID from preview_edit
            selected_pages: Optional list of pages to apply (if None, apply all)
            
        Returns:
            EditApplyResponse with applied changes
        """
        # Retrieve pending edit
        pending = self._pending_edits.get(edit_id)
        if not pending:
            raise RuntimeError(f"Edit {edit_id!r} not found or expired")
        
        if pending["wiki_id"] != wiki_id:
            raise RuntimeError(f"Edit {edit_id!r} belongs to different wiki")
        
        content_root = Path(pending["content_root"])
        wiki_dir = content_root / "wiki"
        changes: list[PageChange] = pending["changes"]
        instruction = pending["instruction"]
        
        # Filter to selected pages if specified
        if selected_pages:
            changes = [c for c in changes if c.page in selected_pages]
        
        applied_pages: list[str] = []
        timestamp = datetime.utcnow().isoformat() + "Z"
        
        for change in changes:
            page_file = wiki_dir / change.page
            
            try:
                # Update frontmatter
                fm, body = _extract_frontmatter(change.edited_content)
                fm["modified"] = datetime.utcnow().strftime("%Y-%m-%d")
                fm["revision"] = change.revision
                
                final_content = _reconstruct_page(fm, body)
                
                # Write the file
                await asyncio.to_thread(page_file.write_text, final_content, "utf-8")
                applied_pages.append(change.page)
                logger.info("Applied edit to %s (revision %d)", change.page, change.revision)
                
            except Exception as exc:
                logger.error("Failed to apply edit to %s: %s", change.page, exc)
                continue
        
        # Record in changelog
        changelog_entry = ChangelogEntry(
            id=edit_id,
            timestamp=timestamp,
            type="ai_bulk",
            instruction=instruction,
            changes=[
                {
                    "page": c.page,
                    "revision": c.revision,
                    "hunks": [h.model_dump() for h in c.hunks],
                }
                for c in changes
                if c.page in applied_pages
            ],
            affected_pages=applied_pages,
            user="ai_agent",
        )
        
        await self._changelog.record_edit(content_root, changelog_entry)
        
        # Update ChromaDB embeddings for changed pages
        for change in changes:
            if change.page not in applied_pages:
                continue
            try:
                # Re-embed the page content
                slug = change.page.replace(".md", "")
                embedding = await self._llm.embed(change.edited_content)
                
                # Note: Full re-indexing would require more complex logic
                # For now, we just log that embeddings should be updated
                logger.info("Page %s updated - consider reindexing wiki", change.page)
            except Exception as exc:
                logger.warning("Failed to update embeddings for %s: %s", change.page, exc)
        
        # Clean up pending edit
        del self._pending_edits[edit_id]
        
        return EditApplyResponse(
            edit_id=edit_id,
            applied_pages=applied_pages,
            revision_count=len(applied_pages),
            changelog_recorded=True,
        )

    async def apply_manual_edit(
        self,
        wiki_id: str,
        page_slug: str,
        new_content: str,
        reason: Optional[str] = None,
    ) -> EditApplyResponse:
        """Apply a manual edit to a single page.
        
        Args:
            wiki_id: The wiki ID
            page_slug: The page slug (without .md extension)
            new_content: The new page content
            reason: Optional reason for the edit
            
        Returns:
            EditApplyResponse with the applied change
        """
        content_root, _ = await self._resolve_wiki_path(wiki_id)
        wiki_dir = content_root / "wiki"
        
        # Normalize page slug
        if page_slug.endswith(".md"):
            page_slug = page_slug[:-3]
        
        page_file = wiki_dir / f"{page_slug}.md"
        
        if not await asyncio.to_thread(page_file.exists):
            raise RuntimeError(f"Page {page_slug!r} not found")
        
        # Read original content
        original_content = await asyncio.to_thread(page_file.read_text, "utf-8")
        
        # Get current revision
        fm, _ = _extract_frontmatter(original_content)
        current_revision = fm.get("revision", 0)
        new_revision = current_revision + 1
        
        # Update frontmatter in new content
        new_fm, new_body = _extract_frontmatter(new_content)
        new_fm["modified"] = datetime.utcnow().strftime("%Y-%m-%d")
        new_fm["revision"] = new_revision
        
        final_content = _reconstruct_page(new_fm, new_body)
        
        # Compute hunks
        old_lines = original_content.splitlines()
        new_lines = final_content.splitlines()
        hunks = _compute_hunks(old_lines, new_lines)
        
        # Write the file
        await asyncio.to_thread(page_file.write_text, final_content, "utf-8")
        
        # Record in changelog
        edit_id = _generate_edit_id()
        timestamp = datetime.utcnow().isoformat() + "Z"
        
        changelog_entry = ChangelogEntry(
            id=edit_id,
            timestamp=timestamp,
            type="manual",
            instruction=reason,
            changes=[
                {
                    "page": f"{page_slug}.md",
                    "revision": new_revision,
                    "hunks": [h.model_dump() for h in hunks],
                }
            ],
            affected_pages=[f"{page_slug}.md"],
            user="user",
        )
        
        await self._changelog.record_edit(content_root, changelog_entry)
        
        logger.info("Applied manual edit to %s (revision %d)", page_slug, new_revision)
        
        return EditApplyResponse(
            edit_id=edit_id,
            applied_pages=[f"{page_slug}.md"],
            revision_count=1,
            changelog_recorded=True,
        )

    async def get_edit_history(
        self,
        wiki_id: str,
        page: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict]:
        """Get edit history for a wiki or specific page.
        
        Args:
            wiki_id: The wiki ID
            page: Optional page slug to filter by
            limit: Maximum number of entries to return
            
        Returns:
            List of changelog entries
        """
        content_root, _ = await self._resolve_wiki_path(wiki_id)
        
        if page:
            return await self._changelog.get_page_revisions(content_root, page)
        else:
            return await self._changelog.get_history(content_root, limit=limit)
