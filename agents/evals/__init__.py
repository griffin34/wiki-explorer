"""
AI Agent Evaluation Suite for wiki-explorer.

This package provides comprehensive testing for:
- Search Agent (semantic search + RAG)
- Wiki Agent (page generation)
- Edit Agent (AI bulk edits)

Run evaluations:
    ./run_evals.sh              # Mocked mode (fast)
    ./run_evals.sh --live       # Live Ollama mode

See README.md for full documentation.
"""

from evals.metrics import (
    aggregate_edit_results,
    aggregate_search_results,
    aggregate_wiki_results,
    compute_diff,
    evaluate_edit,
    evaluate_search,
    evaluate_wiki_page,
    extract_hunks,
    f1_score,
    precision,
    recall,
)

__all__ = [
    "precision",
    "recall",
    "f1_score",
    "evaluate_search",
    "evaluate_wiki_page",
    "evaluate_edit",
    "aggregate_search_results",
    "aggregate_wiki_results",
    "aggregate_edit_results",
    "compute_diff",
    "extract_hunks",
]
