import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { BarChart3, X } from 'lucide-react';
import { FOLDER_MIME_TYPE, type DriveFileItem } from '../types';

interface CategoryDatum {
  category: string;
  count: number;
  sharePct: number;
}

interface TopicSummaryChartProps {
  files: DriveFileItem[];
  selectedCategory: string | null;
  onSelectCategory: (category: string | null) => void;
}

export const TopicSummaryChart: React.FC<TopicSummaryChartProps> = ({
  files,
  selectedCategory,
  onSelectCategory,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [chartWidth, setChartWidth] = useState(640);
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);

  const analyzedDocs = useMemo(
    () =>
      files.filter(
        (f) =>
          f.mimeType !== FOLDER_MIME_TYPE &&
          (f.status === 'ready' || f.status === 'renamed') &&
          Boolean(f.category || f.coreTopic)
      ),
    [files]
  );

  const categoryData: CategoryDatum[] = useMemo(() => {
    if (analyzedDocs.length === 0) return [];
    const counts = new Map<string, number>();
    for (const file of analyzedDocs) {
      const label = (file.category || file.coreTopic || 'Uncategorized').trim();
      counts.set(label, (counts.get(label) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([category, count]) => ({
        category,
        count,
        sharePct: Math.round((count / analyzedDocs.length) * 100),
      }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  }, [analyzedDocs]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 120) setChartWidth(w);
    };

    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, [categoryData.length]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || categoryData.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const rowHeight = 36;
    const isCompact = chartWidth < 460;
    const margin = {
      top: 8,
      right: isCompact ? 56 : 72,
      bottom: 24,
      left: isCompact ? 116 : 164,
    };
    const innerWidth = Math.max(100, chartWidth - margin.left - margin.right);
    const innerHeight = categoryData.length * rowHeight;
    const totalHeight = innerHeight + margin.top + margin.bottom;

    svg
      .attr('width', chartWidth)
      .attr('height', totalHeight)
      .attr('viewBox', `0 0 ${chartWidth} ${totalHeight}`);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const maxCount = d3.max(categoryData, (d) => d.count) || 1;
    const xScale = d3.scaleLinear().domain([0, maxCount]).nice().range([0, innerWidth]);
    const yScale = d3
      .scaleBand<string>()
      .domain(categoryData.map((d) => d.category))
      .range([0, innerHeight])
      .padding(0.28);

    // Subtle vertical gridlines
    const ticks = xScale.ticks(Math.min(5, maxCount)).filter((t) => Number.isInteger(t));
    g.append('g')
      .selectAll('line.grid-line')
      .data(ticks)
      .join('line')
      .attr('class', 'grid-line')
      .attr('x1', (d) => xScale(d))
      .attr('x2', (d) => xScale(d))
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', '#e2e8f0')
      .attr('stroke-dasharray', '2,2');

    // Bottom numeric tick labels
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .selectAll('text.x-tick')
      .data(ticks)
      .join('text')
      .attr('class', 'x-tick')
      .attr('x', (d) => xScale(d))
      .attr('y', 16)
      .attr('text-anchor', 'middle')
      .attr('fill', '#64748b')
      .style('font-family', 'var(--font-mono)')
      .style('font-size', '11px')
      .text((d) => String(d));

    const rowGroups = g
      .selectAll('g.category-row')
      .data(categoryData, (d) => (d as CategoryDatum).category)
      .join('g')
      .attr('class', 'category-row')
      .style('cursor', 'pointer')
      .attr('role', 'button')
      .attr('tabindex', 0)
      .attr('aria-label', (d) => `Filter by ${d.category}: ${d.count} files (${d.sharePct}%)`)
      .on('click', (_event, d) => {
        onSelectCategory(selectedCategory === d.category ? null : d.category);
      })
      .on('keydown', (event: KeyboardEvent, d) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelectCategory(selectedCategory === d.category ? null : d.category);
        }
      })
      .on('mouseenter', (_event, d) => setHoveredCategory(d.category))
      .on('mouseleave', () => setHoveredCategory(null));

    // Full-row hit target
    rowGroups
      .append('rect')
      .attr('x', -margin.left)
      .attr('y', (d) => (yScale(d.category) ?? 0) - 3)
      .attr('width', chartWidth)
      .attr('height', yScale.bandwidth() + 6)
      .attr('rx', 6)
      .attr('fill', (d) => {
        if (selectedCategory === d.category) return '#eff6ff';
        if (hoveredCategory === d.category) return '#f8fafc';
        return 'transparent';
      });

    // Category label (left)
    rowGroups
      .append('text')
      .attr('x', -12)
      .attr('y', (d) => (yScale(d.category) ?? 0) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .attr('fill', (d) => (selectedCategory === d.category ? '#1d4ed8' : '#0f172a'))
      .style('font-family', 'var(--font-sans)')
      .style('font-size', isCompact ? '12px' : '13px')
      .style('font-weight', (d) => (selectedCategory === d.category ? '600' : '500'))
      .text((d) => {
        const maxLen = isCompact ? 14 : 20;
        return d.category.length > maxLen ? `${d.category.slice(0, maxLen - 1)}…` : d.category;
      });

    // Track bar background
    rowGroups
      .append('rect')
      .attr('x', 0)
      .attr('y', (d) => yScale(d.category) ?? 0)
      .attr('width', innerWidth)
      .attr('height', yScale.bandwidth())
      .attr('rx', 4)
      .attr('fill', '#f1f5f9');

    // Data bar
    rowGroups
      .append('rect')
      .attr('x', 0)
      .attr('y', (d) => yScale(d.category) ?? 0)
      .attr('height', yScale.bandwidth())
      .attr('rx', 4)
      .attr('fill', (d) => {
        if (selectedCategory && selectedCategory !== d.category) return '#cbd5e1';
        if (selectedCategory === d.category) return '#2563eb';
        if (hoveredCategory === d.category) return '#1d4ed8';
        return '#3b82f6';
      })
      .attr('width', (d) => Math.max(4, xScale(d.count)));

    // Right value label (count + percentage)
    rowGroups
      .append('text')
      .attr('x', innerWidth + 10)
      .attr('y', (d) => (yScale(d.category) ?? 0) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('fill', (d) => (selectedCategory === d.category ? '#1d4ed8' : '#334155'))
      .style('font-family', 'var(--font-mono)')
      .style('font-size', '12px')
      .style('font-variant-numeric', 'tabular-nums')
      .text((d) => `${d.count} (${d.sharePct}%)`);
  }, [categoryData, chartWidth, hoveredCategory, onSelectCategory, selectedCategory]);

  return (
    <section
      aria-label="Topic Summary"
      className="rounded-lg border border-slate-200 bg-white px-4 py-4 sm:px-6 sm:py-5"
    >
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900">Topic Summary</h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-600 sm:text-sm">
            {analyzedDocs.length > 0
              ? `Category distribution across ${analyzedDocs.length} analyzed ${
                  analyzedDocs.length === 1 ? 'file' : 'files'
                }. Click a category to filter the file list.`
              : 'Analyze documents to visualize topic category distribution and click to filter.'}
          </p>
        </div>

        {selectedCategory && (
          <button
            type="button"
            onClick={() => onSelectCategory(null)}
            className="inline-flex h-9 items-center gap-1.5 self-start rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100 whitespace-nowrap shrink-0 sm:self-auto"
          >
            <span>Filtered: {selectedCategory}</span>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {categoryData.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-500">
          No analyzed categories yet. Run <span className="font-medium text-slate-700">Analyze</span> on one or more files to populate the D3 topic breakdown.
        </div>
      ) : (
        <div className="pt-3">
          <div ref={containerRef} className="w-full overflow-hidden">
            <svg
              ref={svgRef}
              className="block w-full select-none"
              role="img"
              aria-label="D3 bar chart showing analyzed document categories"
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => onSelectCategory(null)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                selectedCategory === null
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              All Categories ({analyzedDocs.length})
            </button>
            {categoryData.map((d) => {
              const isActive = selectedCategory === d.category;
              return (
                <button
                  key={d.category}
                  type="button"
                  onClick={() => onSelectCategory(isActive ? null : d.category)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap tabular-nums ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {d.category} ({d.count})
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};
