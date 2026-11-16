import React from 'react';
import { ArrowRight, FileEdit, RotateCcw, X } from 'lucide-react';
import type { RenameTarget } from '../types';

interface RenameConfirmModalProps {
  targets: RenameTarget[];
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const RenameConfirmModal: React.FC<RenameConfirmModalProps> = ({
  targets,
  isSubmitting,
  onConfirm,
  onCancel,
}) => {
  if (targets.length === 0) return null;

  const isRevert = targets.length === 1 && targets[0].mode === 'revert';
  const count = targets.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700">
              {isRevert ? <RotateCcw className="h-4 w-4" /> : <FileEdit className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <h2 id="rename-modal-title" className="text-base font-semibold text-slate-900">
                {isRevert
                  ? 'Confirm Filename Revert in Google Drive'
                  : count === 1
                    ? 'Confirm File Rename in Google Drive'
                    : `Confirm Batch Rename of ${count} Files in Google Drive`}
              </h2>
              <p className="mt-0.5 text-sm text-slate-600">
                {isRevert
                  ? 'This will restore the previous filename using the Google Drive API.'
                  : 'Review the filename updates below before applying them to your Google Drive.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            aria-label="Close confirmation dialog"
            className="shrink-0 rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="divide-y divide-slate-200 rounded-md border border-slate-200">
            {targets.map((target) => (
              <div
                key={target.fileId}
                className="grid grid-cols-1 gap-2.5 px-3.5 py-3 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-3 sm:px-4"
              >
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">Current Name</div>
                  <div
                    className="break-words font-mono text-xs text-slate-700 sm:truncate"
                    title={target.originalName}
                  >
                    {target.originalName}
                  </div>
                </div>
                <ArrowRight
                  className="hidden h-4 w-4 shrink-0 text-slate-400 sm:block"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">
                    {isRevert ? 'Restored Name' : 'New Topic Filename'}
                  </div>
                  <div
                    className="break-words font-medium text-slate-900 sm:truncate"
                    title={target.newName}
                  >
                    {target.newName}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 rounded-b-lg border-t border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="text-center text-xs text-slate-500 tabular-nums sm:text-left">
            {count} {count === 1 ? 'file' : 'files'} queued for Drive update
          </span>
          <div className="grid grid-cols-2 gap-2.5 sm:flex sm:items-center sm:gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50 whitespace-nowrap sm:h-9"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isSubmitting}
              className="h-11 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-60 whitespace-nowrap sm:h-9"
            >
              {isSubmitting
                ? 'Updating...'
                : isRevert
                  ? 'Confirm Revert'
                  : count === 1
                    ? 'Confirm Rename'
                    : `Rename (${count})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
