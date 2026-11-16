import React from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import type { DriveFileItem } from '../types';
import { ConfidenceBadge, resolveConfidenceScore } from './ConfidenceBadge';

interface SelectionOverviewCardProps {
  selectedFiles: DriveFileItem[];
  totalFilesCount: number;
  isAnalyzing: boolean;
  isExecutingRename: boolean;
  onAnalyzeSelected: () => void;
  onBatchRename: () => void;
  onClearSelection: () => void;
}

export const SelectionOverviewCard: React.FC<SelectionOverviewCardProps> = ({
  selectedFiles,
  totalFilesCount,
  isAnalyzing,
  isExecutingRename,
  onAnalyzeSelected,
  onBatchRename,
  onClearSelection,
}) => {
  if (selectedFiles.length === 0) return null;

  const scores = selectedFiles
    .map((f) => resolveConfidenceScore(f.confidenceScore, f.confidence))
    .filter((score): score is number => score !== null);

  const averageConfidence =
    scores.length > 0
      ? Math.round(scores.reduce((sum, val) => sum + val, 0) / scores.length)
      : null;

  const flaggedForRenameCount = selectedFiles.filter((f) => {
    if (f.status !== 'ready' && f.status !== 'renamed') return false;
    const target = (f.editedName ?? f.proposedName ?? '').trim();
    return target.length > 0 && target !== f.name;
  }).length;

  const unscannedCount = selectedFiles.filter(
    (f) => f.status === 'unscanned' || f.status === 'error'
  ).length;

  return (
    <section
      aria-label="Selection Overview"
      className="rounded-lg border border-slate-200 bg-white px-4 py-3.5 shadow-xs sm:px-6 lg:sticky lg:top-[65px] lg:z-20"
    >
      <div className="flex flex-col gap-3.5 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">Selection Overview</h2>
            <p className="text-xs text-slate-500 tabular-nums">
              {selectedFiles.length} of {totalFilesCount}{' '}
              {totalFilesCount === 1 ? 'file' : 'files'} selected
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-3 sm:flex sm:items-center sm:gap-6 sm:border-t-0 sm:border-l sm:pl-6 sm:pt-0">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-500">Average Confidence</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {averageConfidence !== null ? (
                  <>
                    <ConfidenceBadge confidenceScore={averageConfidence} />
                    <span className="text-xs text-slate-500 tabular-nums">
                      {scores.length}/{selectedFiles.length} analyzed
                    </span>
                  </>
                ) : (
                  <span className="font-mono text-sm font-medium text-slate-500 tabular-nums">
                    — <span className="font-sans text-xs font-normal">Analyze to score</span>
                  </span>
                )}
              </div>
            </div>

            <div className="min-w-0 sm:border-l sm:border-slate-200 sm:pl-6">
              <div className="text-xs font-medium text-slate-500">Flagged for Rename</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-mono text-base font-semibold text-blue-600 tabular-nums">
                  {flaggedForRenameCount}
                </span>
                <span className="text-xs text-slate-500">
                  {flaggedForRenameCount === 1 ? 'file ready' : 'files ready'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 lg:border-t-0 lg:pt-0">
          {unscannedCount > 0 && (
            <button
              type="button"
              disabled={isAnalyzing}
              onClick={onAnalyzeSelected}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Sparkles className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
              <span>Analyze ({unscannedCount})</span>
            </button>
          )}

          <button
            type="button"
            disabled={flaggedForRenameCount === 0 || isExecutingRename}
            onClick={onBatchRename}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Rename Flagged ({flaggedForRenameCount})</span>
          </button>

          <button
            type="button"
            onClick={onClearSelection}
            aria-label="Clear file selection"
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap shrink-0"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Clear</span>
          </button>
        </div>
      </div>
    </section>
  );
};
