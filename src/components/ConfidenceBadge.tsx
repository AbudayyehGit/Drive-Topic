import React from 'react';
import type { AnalysisConfidence } from '../types';

export function resolveConfidenceScore(
  confidenceScore?: number,
  confidence?: AnalysisConfidence
): number | null {
  if (typeof confidenceScore === 'number' && Number.isFinite(confidenceScore)) {
    return Math.max(0, Math.min(100, Math.round(confidenceScore)));
  }
  if (confidence === 'high') return 90;
  if (confidence === 'medium') return 72;
  if (confidence === 'low') return 45;
  return null;
}

export function getConfidencePresentation(score: number): {
  tierLabel: 'High' | 'Med' | 'Low';
  fullLabel: 'High certainty' | 'Medium certainty' | 'Low certainty';
  badgeClasses: string;
  barFilledClasses: string;
  barEmptyClasses: string;
  barsActive: 1 | 2 | 3;
} {
  if (score >= 80) {
    return {
      tierLabel: 'High',
      fullLabel: 'High certainty',
      badgeClasses: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      barFilledClasses: 'bg-emerald-600',
      barEmptyClasses: 'bg-emerald-200',
      barsActive: 3,
    };
  }
  if (score >= 55) {
    return {
      tierLabel: 'Med',
      fullLabel: 'Medium certainty',
      badgeClasses: 'border-amber-200 bg-amber-50 text-amber-800',
      barFilledClasses: 'bg-amber-500',
      barEmptyClasses: 'bg-amber-200',
      barsActive: 2,
    };
  }
  return {
    tierLabel: 'Low',
    fullLabel: 'Low certainty',
    badgeClasses: 'border-red-200 bg-red-50 text-red-800',
    barFilledClasses: 'bg-red-600',
    barEmptyClasses: 'bg-red-200',
    barsActive: 1,
  };
}

interface ConfidenceBadgeProps {
  confidenceScore?: number;
  confidence?: AnalysisConfidence;
  compact?: boolean;
}

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({
  confidenceScore,
  confidence,
  compact = false,
}) => {
  const score = resolveConfidenceScore(confidenceScore, confidence);
  if (score === null) return null;

  const meta = getConfidencePresentation(score);

  return (
    <span
      title={`AI topic extraction confidence: ${score}% (${meta.fullLabel})`}
      aria-label={`AI topic extraction confidence ${score} percent, ${meta.fullLabel}`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap ${meta.badgeClasses}`}
    >
      <span className="inline-flex items-end gap-0.5" aria-hidden="true">
        <span
          className={`h-1.5 w-0.5 rounded-xs ${
            meta.barsActive >= 1 ? meta.barFilledClasses : meta.barEmptyClasses
          }`}
        />
        <span
          className={`h-2.5 w-0.5 rounded-xs ${
            meta.barsActive >= 2 ? meta.barFilledClasses : meta.barEmptyClasses
          }`}
        />
        <span
          className={`h-3.5 w-0.5 rounded-xs ${
            meta.barsActive >= 3 ? meta.barFilledClasses : meta.barEmptyClasses
          }`}
        />
      </span>
      <span className="font-mono tabular-nums">{score}%</span>
      {!compact && <span className="font-medium">{meta.tierLabel}</span>}
    </span>
  );
};
