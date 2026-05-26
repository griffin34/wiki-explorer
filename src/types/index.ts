// ─── Wiki ─────────────────────────────────────────────────────────────────────

export interface WikiConfig {
  id: string
  name: string
  path: string
  color: string
  createdAt: string
  stats?: {
    pageCount: number
    sourceCount: number
    lastActivity: string
  }
}

// ─── Wiki Pages ───────────────────────────────────────────────────────────────

export interface WikiPageMeta {
  id: string
  title: string
  type: PageType
  tags: string[]
  sources: number
  created: string
  updated: string
  links: string[]
  wordCount: number
  excerpt: string
}

export interface WikiPageDetail {
  id: string
  frontmatter: Record<string, unknown>
  content: string
  links: string[]
  backlinks: string[]
}

export type PageType =
  | 'overview'
  | 'entity'
  | 'concept'
  | 'source'
  | 'comparison'
  | 'timeline'
  | 'question'
  | 'analysis'
  | 'page'

// ─── Graph ────────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string
  title: string
  type: PageType
  tags: string[]
  linkCount: number
  wordCount: number
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

export interface GraphData {
  nodes: GraphNode[]
  links: Array<{ source: string | GraphNode; target: string | GraphNode }>
}

// ─── Other ────────────────────────────────────────────────────────────────────

export interface SearchResult {
  id: string
  title: string
  type: PageType
  excerpt: string
  score: number
}

export interface RawFile {
  path: string
  name: string
  size: number
  modified: string
}

export interface LogEntry {
  header: string
  body: string
}

export type WsEvent =
  | { event: 'file:add'; data: { path: string; wikiId: string } }
  | { event: 'file:change'; data: { path: string; wikiId: string } }
  | { event: 'file:remove'; data: { path: string; wikiId: string } }

export const PAGE_TYPE_COLORS: Record<string, string> = {
  overview: '#89b4fa',
  entity: '#a6e3a1',
  concept: '#cba6f7',
  source: '#f9e2af',
  comparison: '#89dceb',
  timeline: '#fab387',
  question: '#f38ba8',
  analysis: '#74c7ec',
  page: '#6c7086',
}

export const WIKI_DEFAULT_COLORS = [
  '#89b4fa', '#a6e3a1', '#cba6f7', '#f9e2af',
  '#89dceb', '#fab387', '#f38ba8', '#74c7ec',
]
