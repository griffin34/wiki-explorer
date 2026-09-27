from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, date
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class ChangelogEntry:
    """Represents a single changelog entry."""

    def __init__(
        self,
        id: str,
        timestamp: str,
        type: str,
        instruction: Optional[str],
        changes: list[dict],
        affected_pages: list[str],
        user: str = "ai_agent",
    ) -> None:
        self.id = id
        self.timestamp = timestamp
        self.type = type
        self.instruction = instruction
        self.changes = changes
        self.affected_pages = affected_pages
        self.user = user

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "type": self.type,
            "instruction": self.instruction,
            "changes": self.changes,
            "affected_pages": self.affected_pages,
            "user": self.user,
        }


class ChangelogService:
    """Service for recording and reading edit history in wiki/.changelog/ directory.
    
    Changelog structure:
    wiki/.changelog/
        index.json         - summary index of all edits
        YYYY-MM-DD.json    - detailed entries for each day
    """

    def _changelog_dir(self, wiki_path: Path) -> Path:
        """Get the .changelog directory path for a wiki."""
        return wiki_path / "wiki" / ".changelog"

    async def _ensure_changelog_dir(self, wiki_path: Path) -> Path:
        """Ensure the .changelog directory exists."""
        changelog_dir = self._changelog_dir(wiki_path)
        await asyncio.to_thread(changelog_dir.mkdir, parents=True, exist_ok=True)
        return changelog_dir

    async def record_edit(self, wiki_path: Path, edit_entry: ChangelogEntry) -> None:
        """Append an edit entry to the day's changelog file.
        
        Args:
            wiki_path: Path to the wiki content root
            edit_entry: The changelog entry to record
        """
        changelog_dir = await self._ensure_changelog_dir(wiki_path)
        
        # Determine filename from timestamp
        entry_date = datetime.fromisoformat(edit_entry.timestamp.replace("Z", "+00:00"))
        date_str = entry_date.strftime("%Y-%m-%d")
        day_file = changelog_dir / f"{date_str}.json"
        
        # Read existing entries for the day
        entries: list[dict] = []
        if await asyncio.to_thread(day_file.exists):
            try:
                raw = await asyncio.to_thread(day_file.read_text, "utf-8")
                data = json.loads(raw)
                # Handle both Express format (direct array) and Python format (wrapped object)
                if isinstance(data, list):
                    entries = data
                else:
                    entries = data.get("entries", [])
            except (json.JSONDecodeError, Exception) as exc:
                logger.warning("Could not read %s: %s", day_file, exc)
                entries = []
        
        # Append new entry
        entries.append(edit_entry.to_dict())
        
        # Write back in Express-compatible format (plain array for easier compatibility)
        await asyncio.to_thread(
            day_file.write_text,
            json.dumps(entries, indent=2),
            "utf-8",
        )
        logger.info("Recorded edit %s to %s", edit_entry.id, day_file)
        
        # Update index.json
        await self._update_index(wiki_path, edit_entry)

    async def _update_index(self, wiki_path: Path, edit_entry: ChangelogEntry) -> None:
        """Update the index.json summary file."""
        changelog_dir = self._changelog_dir(wiki_path)
        index_file = changelog_dir / "index.json"
        
        # Read existing index
        index_data: dict = {"total_edits": 0, "pages": {}, "recent": []}
        if await asyncio.to_thread(index_file.exists):
            try:
                raw = await asyncio.to_thread(index_file.read_text, "utf-8")
                index_data = json.loads(raw)
            except (json.JSONDecodeError, Exception) as exc:
                logger.warning("Could not read index.json: %s", exc)
        
        # Update stats
        index_data["total_edits"] = index_data.get("total_edits", 0) + 1
        
        # Track per-page revision counts
        pages = index_data.get("pages", {})
        for page in edit_entry.affected_pages:
            pages[page] = pages.get(page, 0) + 1
        index_data["pages"] = pages
        
        # Update recent edits (keep last 50)
        recent = index_data.get("recent", [])
        recent.insert(0, {
            "id": edit_entry.id,
            "timestamp": edit_entry.timestamp,
            "type": edit_entry.type,
            "affected_pages": edit_entry.affected_pages,
            "instruction": edit_entry.instruction[:100] if edit_entry.instruction else None,
        })
        index_data["recent"] = recent[:50]
        
        # Write back
        await asyncio.to_thread(
            index_file.write_text,
            json.dumps(index_data, indent=2),
            "utf-8",
        )

    async def get_history(
        self,
        wiki_path: Path,
        page: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict]:
        """Get changelog entries, optionally filtered by page.
        
        Args:
            wiki_path: Path to the wiki content root
            page: Optional page slug to filter by
            limit: Maximum number of entries to return
            
        Returns:
            List of changelog entries, most recent first
        """
        changelog_dir = self._changelog_dir(wiki_path)
        
        if not await asyncio.to_thread(changelog_dir.exists):
            return []
        
        # Get all day files, sorted newest first
        day_files = sorted(
            [f for f in await asyncio.to_thread(list, changelog_dir.glob("????-??-??.json"))],
            reverse=True,
        )
        
        results: list[dict] = []
        for day_file in day_files:
            if len(results) >= limit:
                break
            
            try:
                raw = await asyncio.to_thread(day_file.read_text, "utf-8")
                data = json.loads(raw)
                
                # Handle both Express format (direct array) and Python format (wrapped object)
                if isinstance(data, list):
                    entries = data
                else:
                    entries = data.get("entries", [])
                
                # Filter by page if specified
                if page:
                    entries = [
                        e for e in entries
                        if page in e.get("affected_pages", [])
                    ]
                
                # Add entries, most recent first (reverse within day)
                for entry in reversed(entries):
                    results.append(entry)
                    if len(results) >= limit:
                        break
            except (json.JSONDecodeError, Exception) as exc:
                logger.warning("Could not read %s: %s", day_file, exc)
                continue
        
        return results[:limit]

    async def get_page_revisions(
        self,
        wiki_path: Path,
        page_slug: str,
    ) -> list[dict]:
        """Get all revisions for a specific page.
        
        Args:
            wiki_path: Path to the wiki content root
            page_slug: The page slug (e.g., "project-team.md")
            
        Returns:
            List of changelog entries affecting this page, ordered by timestamp
        """
        # Normalize page_slug to include .md extension
        if not page_slug.endswith(".md"):
            page_slug = f"{page_slug}.md"
        
        all_entries = await self.get_history(wiki_path, page=page_slug, limit=1000)
        
        # Extract just the hunks for this specific page
        revisions: list[dict] = []
        for entry in all_entries:
            page_changes = [
                c for c in entry.get("changes", [])
                if c.get("page") == page_slug
            ]
            if page_changes:
                revisions.append({
                    "id": entry.get("id"),
                    "timestamp": entry.get("timestamp"),
                    "type": entry.get("type"),
                    "instruction": entry.get("instruction"),
                    "user": entry.get("user"),
                    "revision": page_changes[0].get("revision"),
                    "hunks": page_changes[0].get("hunks", []),
                })
        
        return revisions
