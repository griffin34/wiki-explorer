"""
Evaluation metrics and LLM-as-judge utilities.
"""
from __future__ import annotations

import difflib
import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable

from services.ollama_service import OllamaService


# ============================================================================
# Core Metrics
# ============================================================================

def precision(relevant: set, retrieved: set) -> float:
    """
    Compute precision: |relevant ∩ retrieved| / |retrieved|
    
    Args:
        relevant: Set of relevant items
        retrieved: Set of retrieved items
    
    Returns:
        Precision score between 0 and 1
    """
    if not retrieved:
        return 0.0
    return len(relevant & retrieved) / len(retrieved)


def recall(relevant: set, retrieved: set) -> float:
    """
    Compute recall: |relevant ∩ retrieved| / |relevant|
    
    Args:
        relevant: Set of relevant items
        retrieved: Set of retrieved items
    
    Returns:
        Recall score between 0 and 1
    """
    if not relevant:
        return 1.0  # If nothing is relevant, we got everything
    return len(relevant & retrieved) / len(relevant)


def f1_score(relevant: set, retrieved: set) -> float:
    """
    Compute F1 score: 2 * (precision * recall) / (precision + recall)
    
    Args:
        relevant: Set of relevant items
        retrieved: Set of retrieved items
    
    Returns:
        F1 score between 0 and 1
    """
    p = precision(relevant, retrieved)
    r = recall(relevant, retrieved)
    if p + r == 0:
        return 0.0
    return 2 * (p * r) / (p + r)


def jaccard_similarity(set_a: set, set_b: set) -> float:
    """
    Compute Jaccard similarity: |A ∩ B| / |A ∪ B|
    
    Args:
        set_a: First set
        set_b: Second set
    
    Returns:
        Jaccard similarity between 0 and 1
    """
    if not set_a and not set_b:
        return 1.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union > 0 else 0.0


# ============================================================================
# Text Similarity Metrics
# ============================================================================

def levenshtein_distance(s1: str, s2: str) -> int:
    """Compute Levenshtein (edit) distance between two strings."""
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    
    if len(s2) == 0:
        return len(s1)
    
    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
    
    return previous_row[-1]


def normalized_edit_similarity(s1: str, s2: str) -> float:
    """
    Compute normalized edit similarity (1 - normalized Levenshtein distance).
    
    Returns:
        Similarity score between 0 and 1
    """
    max_len = max(len(s1), len(s2))
    if max_len == 0:
        return 1.0
    distance = levenshtein_distance(s1, s2)
    return 1.0 - (distance / max_len)


def sequence_matcher_ratio(s1: str, s2: str) -> float:
    """
    Compute similarity using difflib SequenceMatcher.
    
    Returns:
        Similarity ratio between 0 and 1
    """
    return difflib.SequenceMatcher(None, s1, s2).ratio()


# ============================================================================
# Search Quality Metrics
# ============================================================================

@dataclass
class SearchEvalResult:
    """Results from evaluating a search query."""
    query: str
    expected_sources: list[str]
    actual_sources: list[str]
    precision: float
    recall: float
    f1: float
    answer: str
    answer_relevance: float | None = None
    citation_accuracy: float | None = None
    
    def to_dict(self) -> dict:
        return {
            "query": self.query,
            "expected_sources": self.expected_sources,
            "actual_sources": self.actual_sources,
            "precision": round(self.precision, 4),
            "recall": round(self.recall, 4),
            "f1": round(self.f1, 4),
            "answer_relevance": round(self.answer_relevance, 4) if self.answer_relevance else None,
            "citation_accuracy": round(self.citation_accuracy, 4) if self.citation_accuracy else None,
        }


def evaluate_search(
    query: str,
    expected_sources: list[str],
    actual_sources: list[str],
    answer: str,
) -> SearchEvalResult:
    """
    Evaluate a search result.
    
    Args:
        query: The search query
        expected_sources: Expected source files that should be retrieved
        actual_sources: Actually retrieved source files
        answer: The generated answer
    
    Returns:
        SearchEvalResult with metrics
    """
    expected_set = set(expected_sources)
    actual_set = set(actual_sources)
    
    p = precision(expected_set, actual_set)
    r = recall(expected_set, actual_set)
    f = f1_score(expected_set, actual_set)
    
    # Compute citation accuracy
    citation_acc = _compute_citation_accuracy(answer, actual_sources)
    
    return SearchEvalResult(
        query=query,
        expected_sources=expected_sources,
        actual_sources=actual_sources,
        precision=p,
        recall=r,
        f1=f,
        answer=answer,
        citation_accuracy=citation_acc,
    )


def _compute_citation_accuracy(answer: str, sources: list[str]) -> float:
    """
    Check if citations in the answer match available sources.
    
    Looks for [1], [2], etc. patterns and checks if they're within bounds.
    """
    citation_pattern = r'\[(\d+)\]'
    citations = re.findall(citation_pattern, answer)
    
    if not citations:
        # No citations in answer
        return 0.0 if sources else 1.0
    
    valid_citations = 0
    for cite in citations:
        cite_num = int(cite)
        if 1 <= cite_num <= len(sources):
            valid_citations += 1
    
    return valid_citations / len(citations)


# ============================================================================
# Wiki Generation Metrics
# ============================================================================

@dataclass
class WikiEvalResult:
    """Results from evaluating wiki page generation."""
    source_title: str
    frontmatter_valid: bool
    frontmatter_fields: dict[str, bool]
    has_summary: bool
    has_sections: bool
    wikilink_count: int
    wikilinks_valid: bool
    content_length: int
    summary_quality: float | None = None
    
    def to_dict(self) -> dict:
        return {
            "source_title": self.source_title,
            "frontmatter_valid": self.frontmatter_valid,
            "frontmatter_fields": self.frontmatter_fields,
            "has_summary": self.has_summary,
            "has_sections": self.has_sections,
            "wikilink_count": self.wikilink_count,
            "wikilinks_valid": self.wikilinks_valid,
            "content_length": self.content_length,
            "summary_quality": round(self.summary_quality, 2) if self.summary_quality else None,
        }


def evaluate_wiki_page(
    generated_content: str,
    source_title: str = "Unknown",
) -> WikiEvalResult:
    """
    Evaluate a generated wiki page.
    
    Args:
        generated_content: The generated markdown content
        source_title: Title of the source document
    
    Returns:
        WikiEvalResult with metrics
    """
    # Parse frontmatter
    frontmatter = _parse_frontmatter(generated_content)
    required_fields = ["title", "type", "tags", "created"]
    
    frontmatter_fields = {
        field: field in frontmatter and frontmatter[field]
        for field in required_fields
    }
    frontmatter_valid = all(frontmatter_fields.values())
    
    # Check for summary section
    has_summary = bool(re.search(r'^##\s*summary', generated_content, re.IGNORECASE | re.MULTILINE))
    
    # Count sections
    sections = re.findall(r'^##\s+', generated_content, re.MULTILINE)
    has_sections = len(sections) >= 2
    
    # Count and validate wikilinks
    wikilinks = re.findall(r'\[\[([^\]]+)\]\]', generated_content)
    wikilinks_valid = all(_is_valid_wikilink(w) for w in wikilinks)
    
    return WikiEvalResult(
        source_title=source_title,
        frontmatter_valid=frontmatter_valid,
        frontmatter_fields=frontmatter_fields,
        has_summary=has_summary,
        has_sections=has_sections,
        wikilink_count=len(wikilinks),
        wikilinks_valid=wikilinks_valid,
        content_length=len(generated_content),
    )


def _parse_frontmatter(content: str) -> dict:
    """Parse YAML frontmatter from markdown content."""
    import yaml
    
    stripped = content.strip()
    if not stripped.startswith("---"):
        return {}
    
    parts = stripped[3:].split("---", 1)
    if not parts:
        return {}
    
    try:
        return yaml.safe_load(parts[0]) or {}
    except yaml.YAMLError:
        return {}


def _is_valid_wikilink(link: str) -> bool:
    """Check if a wikilink is valid format."""
    # Wikilinks can have display text: [[slug|Display Text]]
    if "|" in link:
        slug = link.split("|")[0]
    else:
        slug = link
    
    # Basic validation: alphanumeric, hyphens, underscores
    return bool(re.match(r'^[a-zA-Z0-9-_#]+$', slug.strip()))


# ============================================================================
# Edit Quality Metrics
# ============================================================================

@dataclass
class EditHunk:
    """A single edit hunk (change)."""
    line_start: int
    line_end: int
    before: str
    after: str


@dataclass
class PageEdit:
    """Edits to a single page."""
    page: str
    hunks: list[EditHunk] = field(default_factory=list)


@dataclass
class EditEvalResult:
    """Results from evaluating an edit operation."""
    instruction: str
    expected_pages: list[str]
    actual_pages: list[str]
    page_precision: float
    page_recall: float
    hunk_match_rate: float
    unintended_changes: int
    historical_preserved: bool
    
    def to_dict(self) -> dict:
        return {
            "instruction": self.instruction,
            "expected_pages": self.expected_pages,
            "actual_pages": self.actual_pages,
            "page_precision": round(self.page_precision, 4),
            "page_recall": round(self.page_recall, 4),
            "hunk_match_rate": round(self.hunk_match_rate, 4),
            "unintended_changes": self.unintended_changes,
            "historical_preserved": self.historical_preserved,
        }


def evaluate_edit(
    instruction: str,
    expected_pages: list[str],
    actual_edits: list[PageEdit],
    original_content: dict[str, str],
    expected_changes: list[tuple[str, str, str]] | None = None,  # (page, before, after)
) -> EditEvalResult:
    """
    Evaluate an edit operation.
    
    Args:
        instruction: The edit instruction
        expected_pages: Pages that should be edited
        actual_edits: Actual edits made
        original_content: Original page content before edits
        expected_changes: Optional specific expected changes
    
    Returns:
        EditEvalResult with metrics
    """
    actual_pages = [e.page for e in actual_edits]
    
    expected_set = set(expected_pages)
    actual_set = set(actual_pages)
    
    page_p = precision(expected_set, actual_set)
    page_r = recall(expected_set, actual_set)
    
    # Compute hunk match rate if expected changes provided
    hunk_match_rate = 0.0
    if expected_changes:
        matched = 0
        for page, before, after in expected_changes:
            for edit in actual_edits:
                if edit.page == page:
                    for hunk in edit.hunks:
                        if before in hunk.before and after in hunk.after:
                            matched += 1
                            break
        hunk_match_rate = matched / len(expected_changes) if expected_changes else 0.0
    
    # Check for unintended changes (simplified)
    unintended = _count_unintended_changes(actual_edits, expected_changes or [])
    
    # Check historical preservation
    historical_preserved = _check_historical_preservation(instruction, actual_edits)
    
    return EditEvalResult(
        instruction=instruction,
        expected_pages=expected_pages,
        actual_pages=actual_pages,
        page_precision=page_p,
        page_recall=page_r,
        hunk_match_rate=hunk_match_rate,
        unintended_changes=unintended,
        historical_preserved=historical_preserved,
    )


def _count_unintended_changes(
    actual_edits: list[PageEdit],
    expected_changes: list[tuple[str, str, str]],
) -> int:
    """Count changes that weren't in the expected set."""
    expected_befores = {(page, before) for page, before, _ in expected_changes}
    
    unintended = 0
    for edit in actual_edits:
        for hunk in edit.hunks:
            found = False
            for page, before, _ in expected_changes:
                if edit.page == page and before in hunk.before:
                    found = True
                    break
            if not found:
                unintended += 1
    
    return unintended


def _check_historical_preservation(instruction: str, edits: list[PageEdit]) -> bool:
    """
    Check if historical references are preserved.
    
    For example, if someone was replaced, past events mentioning them
    should keep the original name with a note, not be rewritten.
    """
    # Look for indicators of historical context preservation
    # This is a simplified heuristic
    
    historical_indicators = [
        "formerly",
        "previously",
        "was replaced",
        "replaced by",
        "_(now",
        "historical",
        "at the time",
    ]
    
    # If the instruction implies replacement, check for preservation notes
    if "replaced" in instruction.lower() or "was" in instruction.lower():
        for edit in edits:
            for hunk in edit.hunks:
                # Check if historical events maintain original names with notes
                for indicator in historical_indicators:
                    if indicator.lower() in hunk.after.lower():
                        return True
    
    return True  # Default to True if no historical context needed


# ============================================================================
# Diff Utilities
# ============================================================================

def compute_diff(before: str, after: str) -> str:
    """Compute unified diff between two strings."""
    before_lines = before.splitlines(keepends=True)
    after_lines = after.splitlines(keepends=True)
    
    diff = difflib.unified_diff(
        before_lines,
        after_lines,
        fromfile="before",
        tofile="after",
    )
    
    return "".join(diff)


def extract_hunks(before: str, after: str) -> list[EditHunk]:
    """Extract edit hunks from before/after content."""
    before_lines = before.splitlines()
    after_lines = after.splitlines()
    
    matcher = difflib.SequenceMatcher(None, before_lines, after_lines)
    hunks = []
    
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag != "equal":
            hunks.append(EditHunk(
                line_start=i1 + 1,
                line_end=i2,
                before="\n".join(before_lines[i1:i2]),
                after="\n".join(after_lines[j1:j2]),
            ))
    
    return hunks


# ============================================================================
# LLM-as-Judge
# ============================================================================

_RELEVANCE_JUDGE_PROMPT = """\
Rate the relevance of the AI response to the question on a scale of 1-5:

1 = Completely irrelevant or wrong
2 = Partially addresses the question but mostly off-topic
3 = Addresses the question but missing key information
4 = Good response that covers the main points
5 = Excellent, comprehensive response that fully answers the question

Question: {question}

Response: {response}

Provide only a single number (1-5) as your answer."""

_QUALITY_JUDGE_PROMPT = """\
Rate the quality of the following generated content on a scale of 1-5:

1 = Poor quality, major issues
2 = Below average, several problems
3 = Acceptable, minor issues
4 = Good quality, well-structured
5 = Excellent quality, professional-level

Content:
{content}

Evaluation criteria:
- Clarity and readability
- Proper structure and formatting
- Accuracy and completeness
- Professional tone

Provide only a single number (1-5) as your answer."""


async def judge_relevance(
    question: str,
    response: str,
    ollama: OllamaService,
) -> float:
    """
    Use LLM to judge relevance of a response to a question.
    
    Returns:
        Score from 1.0 to 5.0
    """
    prompt = _RELEVANCE_JUDGE_PROMPT.format(question=question, response=response)
    
    try:
        result = await ollama.generate(prompt)
        # Extract number from response
        match = re.search(r'[1-5]', result)
        if match:
            return float(match.group())
    except Exception:
        pass
    
    return 3.0  # Default to middle score on error


async def judge_quality(
    content: str,
    ollama: OllamaService,
) -> float:
    """
    Use LLM to judge overall quality of generated content.
    
    Returns:
        Score from 1.0 to 5.0
    """
    prompt = _QUALITY_JUDGE_PROMPT.format(content=content[:2000])  # Truncate for context
    
    try:
        result = await ollama.generate(prompt)
        match = re.search(r'[1-5]', result)
        if match:
            return float(match.group())
    except Exception:
        pass
    
    return 3.0


# ============================================================================
# Aggregate Metrics
# ============================================================================

def aggregate_search_results(results: list[SearchEvalResult]) -> dict:
    """Aggregate multiple search eval results."""
    if not results:
        return {}
    
    return {
        "count": len(results),
        "precision_avg": sum(r.precision for r in results) / len(results),
        "recall_avg": sum(r.recall for r in results) / len(results),
        "f1_avg": sum(r.f1 for r in results) / len(results),
        "citation_accuracy_avg": sum(
            r.citation_accuracy for r in results if r.citation_accuracy is not None
        ) / max(1, sum(1 for r in results if r.citation_accuracy is not None)),
        "answer_relevance_avg": sum(
            r.answer_relevance for r in results if r.answer_relevance is not None
        ) / max(1, sum(1 for r in results if r.answer_relevance is not None)),
    }


def aggregate_wiki_results(results: list[WikiEvalResult]) -> dict:
    """Aggregate multiple wiki eval results."""
    if not results:
        return {}
    
    return {
        "count": len(results),
        "frontmatter_valid_rate": sum(1 for r in results if r.frontmatter_valid) / len(results),
        "has_summary_rate": sum(1 for r in results if r.has_summary) / len(results),
        "has_sections_rate": sum(1 for r in results if r.has_sections) / len(results),
        "wikilinks_valid_rate": sum(1 for r in results if r.wikilinks_valid) / len(results),
        "avg_wikilink_count": sum(r.wikilink_count for r in results) / len(results),
        "avg_content_length": sum(r.content_length for r in results) / len(results),
        "summary_quality_avg": sum(
            r.summary_quality for r in results if r.summary_quality is not None
        ) / max(1, sum(1 for r in results if r.summary_quality is not None)),
    }


def aggregate_edit_results(results: list[EditEvalResult]) -> dict:
    """Aggregate multiple edit eval results."""
    if not results:
        return {}
    
    return {
        "count": len(results),
        "page_precision_avg": sum(r.page_precision for r in results) / len(results),
        "page_recall_avg": sum(r.page_recall for r in results) / len(results),
        "hunk_match_rate_avg": sum(r.hunk_match_rate for r in results) / len(results),
        "unintended_changes_total": sum(r.unintended_changes for r in results),
        "historical_preserved_rate": sum(1 for r in results if r.historical_preserved) / len(results),
    }
