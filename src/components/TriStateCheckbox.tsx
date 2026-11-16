import React, { useEffect, useRef, useState } from 'react';

interface TriStateCheckboxProps {
  totalCount: number;
  selectedCount: number;
  onToggle: () => void;
  showStateText?: boolean;
  ariaLabel?: string;
}

export const TriStateCheckbox: React.FC<TriStateCheckboxProps> = ({
  totalCount,
  selectedCount,
  onToggle,
  showStateText = false,
  ariaLabel = 'Select all visible files',
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pulseFeedback, setPulseFeedback] = useState(false);

  const isAllSelected = totalCount > 0 && selectedCount === totalCount;
  const isIndeterminate = selectedCount > 0 && selectedCount < totalCount;

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleClick = () => {
    setPulseFeedback(true);
    window.setTimeout(() => setPulseFeedback(false), 180);
    onToggle();
  };

  const stateTitle = isAllSelected
    ? `All ${totalCount} selected — click to clear selection`
    : isIndeterminate
      ? `${selectedCount} of ${totalCount} selected (partial) — click to select all`
      : `None selected — click to select all ${totalCount}`;

  const stateText = isAllSelected
    ? `All selected (${totalCount})`
    : isIndeterminate
      ? `Partial (${selectedCount}/${totalCount})`
      : `Select all (${totalCount})`;

  return (
    <label
      title={stateTitle}
      className={`inline-flex cursor-pointer select-none items-center gap-2 rounded-md px-1.5 py-1 transition-all duration-150 ${
        pulseFeedback ? 'bg-blue-50 ring-2 ring-blue-500/30' : 'hover:bg-slate-100'
      }`}
    >
      <input
        ref={inputRef}
        type="checkbox"
        aria-label={ariaLabel}
        aria-checked={isAllSelected ? true : isIndeterminate ? 'mixed' : false}
        checked={isAllSelected}
        onChange={handleClick}
        className="h-4 w-4 cursor-pointer rounded border-slate-300 text-blue-600 accent-blue-600 focus:ring-2 focus:ring-blue-600 focus:ring-offset-1"
      />
      {showStateText && (
        <span
          className={`text-xs font-medium whitespace-nowrap tabular-nums ${
            isAllSelected || isIndeterminate ? 'text-blue-700' : 'text-slate-600'
          }`}
        >
          {stateText}
        </span>
      )}
    </label>
  );
};
