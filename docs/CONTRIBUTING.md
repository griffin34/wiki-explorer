# Contributing to Wiki Explorer

This guide covers development setup and contribution workflow.

## Development Setup

### Prerequisites

**Git** is required to clone the repository. Everything else (Node.js, Python, Ollama) is auto-installed by the startup scripts.

```bash
# macOS
xcode-select --install

# Windows
winget install Git.Git
```

### Clone and Run

```bash
# Clone the repository
git clone https://github.com/griffin34/wiki-explorer.git
cd wiki-explorer

# Start development (auto-installs all dependencies)
./run
```

The `./run` script automatically:
- Installs Node.js, Python, Ollama if missing
- Pulls required Ollama models
- Sets up Python virtual environment
- Installs all dependencies
- Starts all services

### Running in Development Mode

**Full stack with AI services** (recommended):
```bash
./run
# or
./scripts/start-ai.sh
```

This starts:
- ChromaDB server (port 8001)
- Ollama (port 11434)
- Python agent service (port 8000)
- Express server (port 3001)
- Vite dev server (port 5173)

**Frontend only** (without AI features):
```bash
npm run dev
```

This starts the Express server and Vite dev server.

## Project Structure Overview

```
wiki-explorer/
├── src/              # React frontend (TypeScript)
│   ├── components/   # UI components
│   ├── hooks/        # Custom React hooks
│   ├── types/        # TypeScript type definitions
│   └── utils/        # Utility functions
├── server/           # Express backend (TypeScript)
│   └── index.ts      # API endpoints + WebSocket file watcher
├── agents/           # Python AI services
│   ├── agents/       # Ingestion, search, wiki agents
│   ├── models/       # Pydantic schemas
│   └── services/     # ChromaDB, Ollama, markitdown services
├── electron/         # Electron desktop app
│   ├── main.ts       # Main process
│   └── preload.ts    # Preload script
├── wiki-template/    # Template copied for new wikis
└── data/             # Runtime data (vaults.json)
```

## Development Workflow

1. **Create a feature branch** from `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** with frequent commits.

3. **Run tests** before committing:
   ```bash
   npm test
   ```

4. **Build to verify** changes work:
   ```bash
   npm run build
   ```

5. **Push and create a PR**:
   ```bash
   git push origin feature/your-feature-name
   ```

## Branch Naming Conventions

Use descriptive branch names with a type prefix:

| Prefix | Use Case |
|--------|----------|
| `feature/` | New features — `feature/graph-zoom-controls` |
| `fix/` | Bug fixes — `fix/sidebar-scroll-issue` |
| `docs/` | Documentation — `docs/api-reference` |
| `refactor/` | Code refactoring — `refactor/split-wiki-service` |
| `test/` | Test additions — `test/graphview-coverage` |

## Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description>

[optional body]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `refactor` | Code refactoring (no feature change) |
| `test` | Adding or updating tests |
| `chore` | Build process, dependencies, tooling |

### Examples

```
feat: add zoom controls to graph view
fix: prevent sidebar from scrolling past last item
docs: add API endpoint documentation
refactor: extract wiki service from server index
test: add coverage for GraphView component
chore: update vite to v5.2
```

## Pull Request Process

1. **Create PR** against the `main` branch.

2. **Write a clear description**:
   - What changes were made
   - Why the changes are needed
   - Any breaking changes or migration steps

3. **Ensure all tests pass** — CI will run `npm test`.

4. **Request review** from a maintainer.

5. **Address feedback** with additional commits.

6. **Squash and merge** once approved.

## Code Style

### TypeScript (Frontend/Backend)

- Use TypeScript for all frontend (`src/`) and backend (`server/`) code.
- Prefer functional components with hooks.
- Use explicit types rather than `any`.
- Keep components focused — extract logic into hooks when complex.

### Python (Agents)

- Use type hints for function parameters and return values.
- Follow PEP 8 style guidelines.
- Use Pydantic models for data validation.

### General Guidelines

- Keep files focused and reasonably sized.
- Write self-documenting code; add comments for complex logic.
- Prefer named exports over default exports.

## Testing

### Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Writing Tests

- **Co-locate tests** with source files as `*.test.ts` or `*.test.tsx`.
- Use the test utilities in [src/test-utils.tsx](../src/test-utils.tsx):
  ```typescript
  import { renderWithRouter, mockFetch } from '../test-utils'
  ```
- Coverage thresholds are set to 100% — all new code must be tested.

### Test File Naming

| Source File | Test File |
|-------------|-----------|
| `Component.tsx` | `Component.test.tsx` |
| `useHook.ts` | `useHook.test.ts` |
| `utils.ts` | `utils.test.ts` |

### Example Test

```typescript
import { screen } from '@testing-library/react'
import { renderWithRouter } from '../test-utils'
import { MyComponent } from './MyComponent'

describe('MyComponent', () => {
  it('renders the title', () => {
    renderWithRouter(<MyComponent title="Hello" />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })
})
```

## Adding New Features

### Frontend Components

1. Create component in `src/components/YourComponent.tsx`.
2. Add tests in `src/components/YourComponent.test.tsx`.
3. Export from component file (named export preferred).

### API Endpoints

1. Add endpoint in `server/index.ts`.
2. Add tests in `server/index.test.ts`.
3. Update API documentation if applicable.

### AI Features

1. Add Python code in `agents/agents/` or `agents/services/`.
2. Update schemas in `agents/models/schemas.py` if needed.
3. Expose via FastAPI in `agents/main.py`.

## Reporting Issues

### Bug Reports

When filing a bug, please include:

1. **Summary** — Brief description of the bug.
2. **Steps to reproduce** — Detailed steps to trigger the issue.
3. **Expected behavior** — What should happen.
4. **Actual behavior** — What actually happens.
5. **Environment** — OS, Node.js version, Python version.
6. **Screenshots/logs** — If applicable.

### Feature Requests

When requesting a feature:

1. **Problem statement** — What problem does this solve?
2. **Proposed solution** — How would it work?
3. **Alternatives considered** — Other approaches you've thought of.
4. **Additional context** — Mockups, examples, or references.

---

Thank you for contributing! 🎉
