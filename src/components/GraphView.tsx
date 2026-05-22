import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as d3 from 'd3'
import { Loader2, ZoomIn, ZoomOut, Maximize2, Filter } from 'lucide-react'
import { useGraphData } from '../hooks/useWiki'
import type { GraphNode, PageType } from '../types'
import { PAGE_TYPE_COLORS } from '../types'

const NODE_RADIUS_BASE = 5
const NODE_RADIUS_SCALE = 2.5

function nodeRadius(n: GraphNode): number {
  return NODE_RADIUS_BASE + Math.min(n.linkCount, 20) * (NODE_RADIUS_SCALE / 4)
}

type D3Node = GraphNode & d3.SimulationNodeDatum
type D3Link = { source: D3Node; target: D3Node }

const ALL_TYPES: PageType[] = [
  'overview', 'entity', 'concept', 'source',
  'comparison', 'timeline', 'question', 'analysis', 'page',
]

export default function GraphView() {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { wikiId = '' } = useParams<{ wikiId: string }>()
  const { graph, loading } = useGraphData(wikiId)
  const [hovered, setHovered] = useState<D3Node | null>(null)
  const [filteredTypes, setFilteredTypes] = useState<Set<PageType>>(new Set(ALL_TYPES))
  const [showFilter, setShowFilter] = useState(false)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  const toggleType = useCallback((type: PageType) => {
    setFilteredTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  useEffect(() => {
    if (!graph || !svgRef.current || !containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    // Filter nodes
    const visibleNodes: D3Node[] = (graph.nodes as D3Node[]).filter((n) =>
      filteredTypes.has(n.type as PageType)
    )
    const visibleIds = new Set(visibleNodes.map((n) => n.id))

    const links: D3Link[] = (graph.links as Array<{ source: string; target: string }>)
      .filter((l) => visibleIds.has(l.source) && visibleIds.has(l.target))
      .map((l) => ({
        source: visibleNodes.find((n) => n.id === l.source)!,
        target: visibleNodes.find((n) => n.id === l.target)!,
      }))
      .filter((l) => l.source && l.target)

    // Zoom
    const zoomGroup = svg.append('g')

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        zoomGroup.attr('transform', event.transform.toString())
      })

    svg.call(zoom)
    zoomRef.current = zoom

    // Initial zoom to fit
    const initialScale = Math.min(width, height) / 600
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(initialScale))

    // Simulation
    const simulation = d3
      .forceSimulation<D3Node>(visibleNodes)
      .force(
        'link',
        d3
          .forceLink<D3Node, D3Link>(links)
          .id((d) => d.id)
          .distance(80)
          .strength(0.5)
      )
      .force('charge', d3.forceManyBody<D3Node>().strength((d) => -80 - nodeRadius(d) * 10))
      .force('center', d3.forceCenter(0, 0))
      .force('collision', d3.forceCollide<D3Node>().radius((d) => nodeRadius(d) + 8))
      .alphaDecay(0.02)

    // Links
    const linkSel = zoomGroup
      .append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', '#313244')
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.6)

    // Node groups
    const nodeGroup = zoomGroup
      .append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, D3Node>('g')
      .data(visibleNodes)
      .enter()
      .append('g')
      .style('cursor', 'pointer')

    // Node circles
    nodeGroup
      .append('circle')
      .attr('r', (d) => nodeRadius(d))
      .attr('fill', (d) => PAGE_TYPE_COLORS[d.type] || PAGE_TYPE_COLORS.page)
      .attr('fill-opacity', 0.85)
      .attr('stroke', (d) => PAGE_TYPE_COLORS[d.type] || PAGE_TYPE_COLORS.page)
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.4)

    // Labels for large nodes
    nodeGroup
      .filter((d) => nodeRadius(d) >= 8 || visibleNodes.length < 40)
      .append('text')
      .text((d) => d.title)
      .attr('dy', (d) => nodeRadius(d) + 12)
      .attr('text-anchor', 'middle')
      .attr('fill', '#6c7086')
      .attr('font-size', '10px')
      .attr('pointer-events', 'none')

    // Drag
    const drag = d3
      .drag<SVGGElement, D3Node>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        d.fx = d.x
        d.fy = d.y
      })
      .on('drag', (event, d) => {
        d.fx = event.x
        d.fy = event.y
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null
        d.fy = null
      })

    nodeGroup.call(drag)

    // Hover & click
    nodeGroup
      .on('mouseenter', (_event, d) => {
        setHovered(d)
        d3.select(_event.currentTarget as SVGGElement)
          .select('circle')
          .attr('fill-opacity', 1)
          .attr('stroke-opacity', 1)
      })
      .on('mouseleave', (_event, d) => {
        setHovered((prev) => (prev?.id === d.id ? null : prev))
        d3.select(_event.currentTarget as SVGGElement)
          .select('circle')
          .attr('fill-opacity', 0.85)
          .attr('stroke-opacity', 0.4)
      })
      .on('click', (_event, d) => {
        navigate(`/wiki/${wikiId}/page/${d.id}`)
      })

    // Tick
    simulation.on('tick', () => {
      linkSel
        .attr('x1', (d) => (d.source as D3Node).x ?? 0)
        .attr('y1', (d) => (d.source as D3Node).y ?? 0)
        .attr('x2', (d) => (d.target as D3Node).x ?? 0)
        .attr('y2', (d) => (d.target as D3Node).y ?? 0)

      nodeGroup.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    return () => {
      simulation.stop()
      svg.on('.zoom', null)
    }
  }, [graph, filteredTypes, navigate, wikiId])

  const handleZoomIn = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().call(zoomRef.current.scaleBy, 1.5)
    }
  }

  const handleZoomOut = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().call(zoomRef.current.scaleBy, 0.67)
    }
  }

  const handleReset = () => {
    if (svgRef.current && zoomRef.current && containerRef.current) {
      const w = containerRef.current.clientWidth
      const h = containerRef.current.clientHeight
      const scale = Math.min(w, h) / 600
      d3.select(svgRef.current)
        .transition()
        .call(
          zoomRef.current.transform,
          d3.zoomIdentity.translate(w / 2, h / 2).scale(scale)
        )
    }
  }

  return (
    <div className="relative w-full h-full bg-[#1e1e2e]" ref={containerRef}>
      {loading ? (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="animate-spin text-[#89b4fa]" size={24} />
        </div>
      ) : (
        <>
          <svg ref={svgRef} className="w-full h-full" />

          {/* Hover tooltip */}
          {hovered && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="bg-[#24273a] border border-[#313244] rounded-lg px-3 py-2 shadow-xl">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: PAGE_TYPE_COLORS[hovered.type] || PAGE_TYPE_COLORS.page }}
                  />
                  <span className="text-sm font-medium text-[#cdd6f4]">{hovered.title}</span>
                </div>
                <div className="text-xs text-[#6c7086]">
                  {hovered.type} · {hovered.linkCount} links · {hovered.wordCount} words
                </div>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="absolute bottom-6 right-6 flex flex-col gap-2">
            <button
              onClick={handleZoomIn}
              className="p-2 bg-[#24273a] border border-[#313244] rounded-lg text-[#6c7086] hover:text-[#cdd6f4] hover:bg-[#313244] transition-colors"
              title="Zoom in"
            >
              <ZoomIn size={16} />
            </button>
            <button
              onClick={handleZoomOut}
              className="p-2 bg-[#24273a] border border-[#313244] rounded-lg text-[#6c7086] hover:text-[#cdd6f4] hover:bg-[#313244] transition-colors"
              title="Zoom out"
            >
              <ZoomOut size={16} />
            </button>
            <button
              onClick={handleReset}
              className="p-2 bg-[#24273a] border border-[#313244] rounded-lg text-[#6c7086] hover:text-[#cdd6f4] hover:bg-[#313244] transition-colors"
              title="Reset view"
            >
              <Maximize2 size={16} />
            </button>
          </div>

          {/* Filter panel */}
          <div className="absolute top-4 right-6">
            <button
              onClick={() => setShowFilter((v) => !v)}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors
                ${showFilter
                  ? 'bg-[#89b4fa]/10 border-[#89b4fa]/30 text-[#89b4fa]'
                  : 'bg-[#24273a] border-[#313244] text-[#6c7086] hover:text-[#cdd6f4]'
                }
              `}
            >
              <Filter size={12} />
              Filter
            </button>
            {showFilter && (
              <div className="absolute top-full right-0 mt-1 bg-[#24273a] border border-[#313244] rounded-lg shadow-xl p-3 min-w-40">
                <p className="text-xs text-[#6c7086] mb-2 font-medium uppercase tracking-wider">
                  Page types
                </p>
                <div className="space-y-1">
                  {ALL_TYPES.map((type) => (
                    <label
                      key={type}
                      className="flex items-center gap-2 cursor-pointer text-xs text-[#a6adc8] hover:text-[#cdd6f4]"
                    >
                      <input
                        type="checkbox"
                        checked={filteredTypes.has(type)}
                        onChange={() => toggleType(type)}
                        className="accent-[#89b4fa]"
                      />
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: PAGE_TYPE_COLORS[type] }}
                      />
                      {type}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="absolute bottom-6 left-6 bg-[#24273a]/80 backdrop-blur border border-[#313244] rounded-lg px-3 py-2">
            <p className="text-xs text-[#6c7086] mb-1.5 font-medium">Node size = link count</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {ALL_TYPES.filter((t) => filteredTypes.has(t)).map((type) => (
                <div key={type} className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: PAGE_TYPE_COLORS[type] }}
                  />
                  <span className="text-xs text-[#6c7086]">{type}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
