# AI Agent Evaluation Suite

> Comprehensive testing framework for wiki-explorer AI agents (Search, Wiki Generation, Edit)

## Overview

This eval suite provides both **deterministic testing** (mocked Ollama responses) and **live testing** (real Ollama inference) to measure AI agent quality over time.

## Directory Structure

```
agents/evals/
├── README.md                 # This file
├── run_evals.sh              # Main eval runner script
├── conftest.py               # Pytest fixtures and configuration
├── metrics.py                # Evaluation metrics and LLM-as-judge utilities
│
├── eval_search.py            # Search agent evaluations
├── eval_wiki_generation.py   # Wiki page generation evaluations
├── eval_edit.py              # AI bulk edit evaluations
│
└── test_data/
    └── sample_wiki/          # Sample wiki with realistic content
        ├── index.md
        ├── project-overview.md
        ├── team-members.md
        ├── quarterly-review-q2-2026.md
        ├── machine-learning-basics.md
        ├── data-pipeline-architecture.md
        ├── meeting-notes-july-2026.md
        ├── company-policies.md
        └── product-roadmap.md
```

## Running Evaluations

### Quick Start

```bash
# Run all evals with mocked Ollama (fast, deterministic)
./agents/evals/run_evals.sh

# Run with live Ollama (requires running Ollama service)
./agents/evals/run_evals.sh --live

# Run specific eval suite
./agents/evals/run_evals.sh --suite search
./agents/evals/run_evals.sh --suite wiki
./agents/evals/run_evals.sh --suite edit

# Output results to JSON
./agents/evals/run_evals.sh --output results/eval-$(date +%Y%m%d).json
```

### Prerequisites

```bash
# Install eval dependencies
cd agents
pip install -r requirements.txt
pip install pytest pytest-asyncio pytest-json-report

# For live mode, ensure Ollama is running
ollama serve
ollama pull qwen3:8b
ollama pull nomic-embed-text
```

## Evaluation Modes

### Mocked Mode (Default)

- Uses predetermined responses from `MockOllamaService`
- Fast execution (~10 seconds for full suite)
- Deterministic results for CI/CD
- Tests agent logic, not LLM quality

### Live Mode (`--live`)

- Uses real Ollama inference
- Slower execution (~2-5 minutes)
- Non-deterministic but measures actual quality
- Use for benchmarking model changes

## Eval Suites

### Search Agent (`eval_search.py`)

Tests semantic search and RAG answer quality.

| Test Category | Description | Metrics |
|---------------|-------------|---------|
| Factual queries | Simple "what is X?" questions | Precision, Recall |
| Multi-hop queries | Queries requiring info from multiple sources | Source coverage |
| No-information queries | Queries outside wiki scope | Appropriate "I don't know" |
| Edge cases | Empty, very long, or malformed queries | Graceful handling |

**Metrics:**
- **Precision**: Fraction of returned sources that are relevant
- **Recall**: Fraction of relevant sources that were returned
- **Answer relevance**: LLM-as-judge score (1-5)
- **Citation accuracy**: Do citations match actual sources?

### Wiki Generation (`eval_wiki_generation.py`)

Tests wiki page synthesis quality.

| Test Category | Description | Metrics |
|---------------|-------------|---------|
| PDF-like content | Technical documents, reports | Frontmatter correctness |
| Meeting notes | Conversational, action-item style | Wikilink extraction |
| Technical docs | API docs, architecture specs | Summary quality |

**Metrics:**
- **Frontmatter valid**: Required fields present (`title`, `type`, `tags`, `created`)
- **Type classification**: Correct page type assigned
- **Wikilink syntax**: Valid `[[WikiLink]]` format
- **Content coverage**: Key facts from source preserved
- **Summary quality**: LLM-as-judge score (1-5)

### Edit Agent (`eval_edit.py`)

Tests AI bulk edit capabilities.

| Test Category | Description | Metrics |
|---------------|-------------|---------|
| Entity replacement | "Replace X with Y" | Correct pages identified |
| Role changes | "X is now Y's role" | Context-aware updates |
| Date updates | "Update 2025 to 2026" | Historical preservation |
| Complex edits | Multi-entity changes | No unintended changes |

**Metrics:**
- **Page identification**: Correct pages selected for edit
- **Edit precision**: Only intended changes made
- **Historical accuracy**: Past events preserved correctly
- **Transition notes**: Helpful context added where appropriate

## Metrics Deep Dive

### Precision & Recall

```
Precision = |Relevant ∩ Retrieved| / |Retrieved|
Recall = |Relevant ∩ Retrieved| / |Relevant|
F1 = 2 * (Precision * Recall) / (Precision + Recall)
```

### LLM-as-Judge

For subjective quality assessments, we use the LLM itself as a judge:

```python
JUDGE_PROMPT = """
Rate the following AI response on a scale of 1-5:
1 = Completely wrong or unhelpful
2 = Partially correct but missing key information
3 = Adequate but could be improved
4 = Good response with minor issues
5 = Excellent, comprehensive response

Question: {question}
Expected: {expected}
Actual: {actual}

Score (1-5):
"""
```

### Diff Comparison

For edit evaluations, we compute:
- **Hunk match rate**: Expected changes vs actual changes
- **Unintended changes**: Lines modified that shouldn't be
- **Context preservation**: Surrounding content unchanged

## JSON Output Format

Results are saved in a structured JSON format for tracking:

```json
{
  "metadata": {
    "timestamp": "2026-07-24T14:30:00Z",
    "mode": "live",
    "ollama_model": "qwen3:8b",
    "embed_model": "nomic-embed-text",
    "git_commit": "abc1234"
  },
  "summary": {
    "total_tests": 45,
    "passed": 42,
    "failed": 3,
    "duration_seconds": 127.5
  },
  "suites": {
    "search": {
      "precision_avg": 0.85,
      "recall_avg": 0.78,
      "answer_relevance_avg": 4.2,
      "tests": [...]
    },
    "wiki_generation": {
      "frontmatter_valid_rate": 0.95,
      "summary_quality_avg": 4.0,
      "tests": [...]
    },
    "edit": {
      "page_identification_accuracy": 0.90,
      "edit_precision": 0.88,
      "tests": [...]
    }
  }
}
```

## Adding New Evaluations

### Adding a Test Case

```python
# In eval_search.py
@pytest.mark.eval
async def test_search_new_scenario(search_agent, sample_wiki):
    """Test description."""
    response = await search_agent.search(
        wiki_id=sample_wiki.id,
        query="your test query"
    )
    
    # Assert expected behavior
    assert response.answer != ""
    assert len(response.sources) > 0
    
    # Record metrics
    metrics.record_search_result(
        query="your test query",
        expected_sources=["expected-page.md"],
        actual_sources=[s.file for s in response.sources],
        answer=response.answer
    )
```

### Adding a New Metric

```python
# In metrics.py
def compute_new_metric(expected: T, actual: T) -> float:
    """Compute your new metric."""
    # Implementation
    return score
```

## CI Integration

Add to GitHub Actions:

```yaml
- name: Run AI Evals
  run: |
    cd agents
    ./evals/run_evals.sh --output results.json
    
- name: Upload Eval Results
  uses: actions/upload-artifact@v3
  with:
    name: eval-results
    path: agents/results.json
```

## Troubleshooting

### "Ollama not available"

Ensure Ollama is running:
```bash
ollama serve
```

### "ChromaDB connection failed"

For eval mode, we use embedded ChromaDB (no server needed). If you see connection errors, ensure you're using the test fixtures properly.

### Slow test execution

Use mocked mode for quick iteration:
```bash
./agents/evals/run_evals.sh  # Uses mocks by default
```

## Best Practices

1. **Run mocked tests frequently** during development
2. **Run live tests** before major releases or model changes
3. **Track metrics over time** to detect regressions
4. **Add failing test cases first** when bugs are reported
5. **Keep sample wiki realistic** to catch real-world edge cases
