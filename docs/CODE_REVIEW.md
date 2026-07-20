# Wiki-Explorer Code Review Report

**Date:** 2026-07-20  
**Reviewer:** Principal Code Review  
**Scope:** Full project architecture, security, and code quality

---

## Executive Summary

The wiki-explorer project is a well-structured React + Express application with a Python AI agent service. The codebase demonstrates good separation of concerns and modern patterns. However, there are **critical security vulnerabilities** that must be addressed before production use, along with several architectural improvements and code cleanup opportunities.

| Severity | Count |
|----------|-------|
| 🔴 Critical | 3 |
| 🟠 High | 4 |
| 🟡 Medium | 6 |
| 🔵 Low | 5 |

---

## 🔴 Critical Security Issues

### 1. Path Traversal Vulnerability in Wiki Page Routes
**Location:** [server/index.ts](../server/index.ts#L521-L523)

```typescript
const pageId = (req.params as Record<string, string>)['0']
const baseDir = isWikiMode(v) ? wikiDir(v) : v.path
const filePath = path.join(baseDir, pageId + '.md')
```

**Issue:** User-supplied `pageId` is directly joined to the file path without sanitization. An attacker could use `../../../etc/passwd` to read arbitrary files on the server.

**Fix:**
```typescript
// Sanitize pageId to prevent directory traversal
const sanitizedPageId = pageId.replace(/\.\./g, '').replace(/^\/+/, '')
const filePath = path.join(baseDir, sanitizedPageId + '.md')

// Verify the resolved path is still within baseDir
const resolvedPath = path.resolve(filePath)
if (!resolvedPath.startsWith(path.resolve(baseDir))) {
  return res.status(400).json({ error: 'Invalid page path' })
}
```

### 2. Command Injection in IDE Launch
**Location:** [server/index.ts](../server/index.ts#L331-L360)

```typescript
const { ide, path: folderPath } = req.body as { ide?: string; path?: string }
// ...
await execAsync(`open -a "${def.mac.macAppName}" "${folderPath}"`)
```

**Issue:** `folderPath` from user input is interpolated into shell commands. Malicious input like `"; rm -rf /; "` could execute arbitrary commands.

**Fix:**
```typescript
import { execFile } from 'child_process'
const execFileAsync = promisify(execFile)

// Use execFile instead of execAsync to avoid shell interpretation
await execFileAsync('open', ['-a', def.mac.macAppName, folderPath])
```

### 3. Unrestricted File Upload
**Location:** [server/index.ts](../server/index.ts#L636-L650)

```typescript
multer({ storage: storageFor(inbox) }).array('files')(req, res, (err) => {
```

**Issue:** No validation of file types, sizes, or counts. Could lead to:
- Storage exhaustion (upload massive files)
- Malicious file storage (executables, scripts)
- Path traversal via filename manipulation

**Fix:**
```typescript
const upload = multer({
  storage: storageFor(inbox),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
    files: 20, // Max 20 files per request
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = /\.(md|txt|pdf|docx?|pptx?|xlsx?|csv|json|html?|xml|rst|rtf|odt|epub)$/i
    if (allowedTypes.test(file.originalname)) {
      cb(null, true)
    } else {
      cb(new Error(`File type not allowed: ${file.originalname}`))
    }
  },
})
```

---

## 🟠 High Priority Issues

### 4. Missing Input Validation on Wiki Creation
**Location:** [server/index.ts](../server/index.ts#L422-L450)

```typescript
const { name, wikiPath, color, create } = req.body as {
  name?: string
  wikiPath?: string
  color?: string
  create?: boolean
}
```

**Issue:** Minimal validation. Could create wikis pointing to sensitive system directories.

**Recommendations:**
- Validate `wikiPath` is within allowed directories
- Sanitize `name` to prevent XSS in the UI
- Validate `color` is a valid hex color
- Add rate limiting to prevent wiki creation abuse

### 5. CORS Wildcard in Python Agent Service
**Location:** [agents/main.py](../agents/main.py#L69-L73)

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Issue:** Allows any origin to access the agent API. In a multi-user environment, this enables CSRF attacks.

**Fix:** Restrict to the Express server origin:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:5173"],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)
```

### 6. No Authentication/Authorization
**Issue:** The entire application has no authentication. Any user on the network can:
- Read/modify any wiki
- Trigger AI ingestion
- Access all indexed content

**Recommendations for future:**
- Add optional basic auth or API key support
- Implement per-wiki access controls
- Add session management for the UI

### 7. Secrets in Startup Scripts
**Location:** [start-ai.sh](../start-ai.sh), [start-ai.ps1](../start-ai.ps1)

**Issue:** Scripts don't handle secrets securely. Model names and URLs are hardcoded.

**Fix:** Use `.env` file loading:
```bash
if [ -f "$SCRIPT_DIR/.env" ]; then
  export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
fi
```

---

## 🟡 Medium Priority Issues

### 8. Missing Error Boundaries in React
**Issue:** No React error boundaries. A crash in one component takes down the entire UI.

**Fix:** Add error boundaries around major route components:
```tsx
// src/components/ErrorBoundary.tsx
class ErrorBoundary extends React.Component<Props, State> {
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} />
    }
    return this.props.children
  }
}
```

### 9. Blocking File Operations in Express
**Location:** [server/index.ts](../server/index.ts) - multiple locations

```typescript
fs.readFileSync(VAULTS_FILE, 'utf-8')
fs.writeFileSync(VAULTS_FILE, JSON.stringify(...))
```

**Issue:** Synchronous file I/O blocks the event loop. With many concurrent requests, this degrades performance.

**Fix:** Use async versions with `fs/promises`:
```typescript
import { readFile, writeFile } from 'fs/promises'
const raw = await readFile(VAULTS_FILE, 'utf-8')
```

### 10. No Request Rate Limiting
**Issue:** No rate limiting on any endpoints. Susceptible to:
- DoS attacks
- AI service abuse (expensive LLM calls)
- Brute-force wiki enumeration

**Fix:** Add express-rate-limit:
```typescript
import rateLimit from 'express-rate-limit'

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // 10 AI requests per minute
})
app.use('/api/ai/', aiLimiter)
```

### 11. Unbounded Queue in Ingestion Agent
**Location:** [agents/agents/ingestion.py](../agents/agents/ingestion.py#L85)

```python
self._queue: asyncio.Queue = asyncio.Queue()
```

**Issue:** Unbounded queue could consume all memory if files are added faster than processed.

**Fix:**
```python
self._queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
```

### 12. No Graceful Shutdown Signal Handling
**Location:** [agents/main.py](../agents/main.py)

**Issue:** Python agent doesn't handle SIGTERM gracefully. Kubernetes/Docker deployments may kill it ungracefully.

**Fix:** Already using FastAPI lifespan, but should add signal handlers:
```python
import signal

def handle_shutdown(signum, frame):
    raise SystemExit(0)

signal.signal(signal.SIGTERM, handle_shutdown)
```

### 13. HTML Injection via rehype-raw
**Location:** [src/components/WikiPage.tsx](../src/components/WikiPage.tsx#L6)

```typescript
import rehypeRaw from 'rehype-raw'
```

**Issue:** `rehype-raw` allows raw HTML in markdown. Combined with wiki links, this could enable XSS if wiki content is compromised.

**Mitigation:** Add rehype-sanitize:
```typescript
import rehypeSanitize from 'rehype-sanitize'
// In ReactMarkdown plugins:
rehypePlugins={[rehypeHighlight, rehypeRaw, rehypeSanitize]}
```

---

## 🔵 Low Priority Issues

### 14. Duplicate Content Root Logic
**Issue:** `findContentRoot()` is implemented twice:
- TypeScript: [server/index.ts](../server/index.ts#L84-L102)
- Python: [agents/agents/ingestion.py](../agents/agents/ingestion.py#L28-L45)

**Fix:** Consider a shared contract or single source of truth (e.g., Express returns content root in wiki metadata).

### 15. Unused Export: `IDE_CREATE_COMMANDS`
**Location:** [src/components/IDELaunchModal.tsx](../src/components/IDELaunchModal.tsx)

Exported but only used within the same file (via the inline VaultSelector import).

### 16. Missing TypeScript Strict Null Checks
**Issue:** Some files use non-null assertions (`!`) or unsafe type casts without proper guards.

**Example:**
```typescript
const targetName = pageId.split('/').pop() || pageId
```

**Fix:** Enable `strictNullChecks` in tsconfig and fix resulting errors.

### 17. Console.log in Production Code
**Location:** [server/index.ts](../server/index.ts#L681)

```typescript
console.log(`[text] saved ${finalName} → ${filePath}`)
```

**Fix:** Use a proper logging library (e.g., winston, pino) with log levels.

### 18. Missing Test Coverage for AI Components
**Issue:** No tests for:
- `AISearch.tsx`
- `IngestStatus.tsx`
- Python agent service (no test files in agents/)

**Fix:** Add unit and integration tests for AI functionality.

---

## Architecture Recommendations

### A. Service Communication
Currently Express proxies to the Python agent. Consider:
- Message queue (Redis) for async ingestion jobs
- Health check retries with exponential backoff
- Circuit breaker pattern for agent unavailability

### B. State Management
React state is distributed across components. For scaling:
- Consider React Query or SWR for server state
- Add optimistic updates for better UX

### C. Database for Metadata
`vaults.json` is fragile:
- Race conditions on concurrent writes
- No backup/recovery
- Consider SQLite for wiki metadata

### D. Observability
Add:
- Structured logging with correlation IDs
- Metrics endpoint (Prometheus format)
- Distributed tracing for AI pipeline

---

## TODO Checklist

### Critical (Fix Before Any Deployment)
- [ ] Sanitize `pageId` in wiki page route to prevent path traversal
- [ ] Replace `execAsync` with `execFile` in IDE launch
- [ ] Add file upload validation (type, size, count)

### High Priority
- [ ] Restrict CORS origins in Python agent
- [ ] Add input validation for wiki creation paths
- [ ] Document security model and authentication plans
- [ ] Move secrets to `.env` with proper loading

### Medium Priority
- [ ] Add React error boundaries
- [ ] Convert sync file ops to async
- [ ] Add rate limiting to AI endpoints
- [ ] Bound the ingestion queue size
- [ ] Add rehype-sanitize to markdown rendering

### Low Priority
- [ ] Consolidate `findContentRoot` logic
- [ ] Remove unused exports
- [ ] Enable strict TypeScript checks
- [ ] Replace console.log with structured logger
- [ ] Add tests for AI components

---

## Positive Observations

✅ **Good separation of concerns** - Clear boundaries between frontend, Express API, and Python agents  
✅ **Type safety** - TypeScript used throughout with proper interfaces  
✅ **Modern patterns** - React hooks, async/await, FastAPI lifespan  
✅ **Cross-platform support** - Both bash and PowerShell startup scripts  
✅ **Auto-installation** - Scripts handle dependency installation gracefully  
✅ **Consistent styling** - Tailwind with CSS variables for theming  

---

*Report generated by automated code review. Manual verification recommended for all security fixes.*
