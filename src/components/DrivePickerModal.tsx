import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpNarrowWide,
  Check,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type { DriveFileItem } from '../types';
import { TriStateCheckbox } from './TriStateCheckbox';

interface DrivePickerModalProps {
  isOpen: boolean;
  files: DriveFileItem[];
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onLaunchExternalPicker: () => Promise<void>;
  onApplySelection: (selectedIds: Set<string>) => void;
  onClose: () => void;
}

function formatCreationDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function friendlyFileType(mimeType: string): string {
  if (mimeType === 'application/vnd.google-apps.document') return 'Google Doc';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'Google Sheet';
  if (mimeType === 'application/vnd.google-apps.presentation') return 'Google Slides';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType === 'text/markdown' || mimeType === 'text/x-markdown') return 'Markdown';
  if (mimeType === 'text/csv') return 'CSV';
  if (mimeType === 'application/json') return 'JSON';
  if (mimeType === 'text/html') return 'HTML';
  if (mimeType.startsWith('text/')) return 'Text';
  return 'Drive File';
}

export const DrivePickerModal: React.FC<DrivePickerModalProps> = ({
  isOpen,
  files,
  isLoading,
  onRefresh,
  onLaunchExternalPicker,
  onApplySelection,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [draftSelectedIds, setDraftSelectedIds] = useState<Set<string>>(new Set());
  const [isOpeningGooglePicker, setIsOpeningGooglePicker] = useState(false);

  // Sync draft selection whenever modal opens or underlying file list updates
  useEffect(() => {
    if (!isOpen) return;
    setDraftSelectedIds(new Set(files.filter((f) => Boolean(f.selected)).map((f) => f.id)));
  }, [isOpen, files]);

  const sortedFlatFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...files]
      .sort((a, b) => {
        const aTime = Date.parse(a.createdTime || a.modifiedTime || '') || 0;
        const bTime = Date.parse(b.createdTime || b.modifiedTime || '') || 0;
        if (aTime !== bTime) return aTime - bTime;
        return a.name.localeCompare(b.name);
      })
      .filter((f) => (!q ? true : f.name.toLowerCase().includes(q)));
  }, [files, searchQuery]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const inputType = tag === 'input' ? (target as HTMLInputElement).type : '';
        const isTextInput =
          (tag === 'input' && inputType !== 'checkbox' && inputType !== 'button' && inputType !== 'submit') ||
          tag === 'textarea';
        if (isTextInput || sortedFlatFiles.length === 0) return;
        e.preventDefault();
        setDraftSelectedIds((prev) => {
          const next = new Set(prev);
          for (const f of sortedFlatFiles) next.add(f.id);
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, sortedFlatFiles]);

  const visibleSelectedCount = useMemo(
    () => sortedFlatFiles.filter((f) => draftSelectedIds.has(f.id)).length,
    [sortedFlatFiles, draftSelectedIds]
  );

  const allVisibleSelected =
    sortedFlatFiles.length > 0 && visibleSelectedCount === sortedFlatFiles.length;

  if (!isOpen) return null;

  const toggleSingle = (fileId: string) => {
    setDraftSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const toggleAllVisible = () => {
    const visibleIds = sortedFlatFiles.map((f) => f.id);
    if (visibleIds.length === 0) return;

    setDraftSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  };

  const handleAuthorizeMore = async () => {
    setIsOpeningGooglePicker(true);
    try {
      await onLaunchExternalPicker();
    } finally {
      setIsOpeningGooglePicker(false);
    }
  };

  const handleConfirm = () => {
    onApplySelection(draftSelectedIds);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-2 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drive-picker-modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2
              id="drive-picker-modal-title"
              className="text-base font-semibold text-slate-900"
            >
              Google Drive — Flat File Selector
            </h2>
            <p className="mt-0.5 text-xs text-slate-600 sm:text-sm">
              All accessible files across folders and root in a flat list, sorted earliest to latest
              creation date.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Google Drive selector"
            className="shrink-0 rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col gap-2.5 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="relative flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter filenames..."
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 whitespace-nowrap">
              <ArrowUpNarrowWide className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
              <span>Creation Date: Earliest → Latest</span>
            </span>

            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={isLoading}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => void handleAuthorizeMore()}
              disabled={isOpeningGooglePicker}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap"
            >
              {isOpeningGooglePicker ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>Authorize More in Google Drive</span>
            </button>
          </div>
        </div>

        {/* Persistent Checkbox List Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6">
          <TriStateCheckbox
            totalCount={sortedFlatFiles.length}
            selectedCount={visibleSelectedCount}
            onToggle={toggleAllVisible}
            showStateText
            ariaLabel="Select all visible Drive files"
          />

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 tabular-nums">
              {draftSelectedIds.size} of {files.length} total selected
            </span>
            {sortedFlatFiles.length > 0 && (
              <button
                type="button"
                onClick={toggleAllVisible}
                className="text-xs font-medium text-blue-600 hover:underline whitespace-nowrap"
              >
                {allVisibleSelected ? 'Deselect All' : `Select All (${sortedFlatFiles.length})`}
              </button>
            )}
          </div>
        </div>

        {/* Flattened Filename List */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && files.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden="true" />
              <span>Loading Drive files...</span>
            </div>
          ) : sortedFlatFiles.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <FileText className="mx-auto h-7 w-7 text-slate-400" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium text-slate-900">
                {files.length === 0
                  ? 'No authorized Drive files found yet'
                  : 'No filenames match your search'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {files.length === 0
                  ? 'Click "Authorize More in Google Drive" above to pick files from your Google Drive.'
                  : 'Clear the search filter to view all files.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-200">
              {sortedFlatFiles.map((file) => {
                const isChecked = draftSelectedIds.has(file.id);
                return (
                  <li
                    key={file.id}
                    className={`flex items-center justify-between gap-3 px-4 py-3 transition-colors sm:px-6 ${
                      isChecked ? 'bg-blue-50/50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSingle(file.id)}
                        aria-label={`Select ${file.name}`}
                        className="h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-blue-600 accent-blue-600 focus:ring-2 focus:ring-blue-600"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {file.name}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 tabular-nums">
                          <span>{friendlyFileType(file.mimeType)}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Created {formatCreationDate(file.createdTime || file.modifiedTime)}
                          </span>
                        </div>
                      </div>
                    </label>

                    {file.webViewLink && (
                      <a
                        href={file.webViewLink}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${file.name} in Google Drive`}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2.5 border-t border-slate-200 bg-slate-50 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="text-center text-xs text-slate-600 tabular-nums sm:text-left">
            {draftSelectedIds.size} {draftSelectedIds.size === 1 ? 'file' : 'files'} checked
          </span>
          <div className="grid grid-cols-2 gap-2.5 sm:flex sm:items-center sm:gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap sm:h-9"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 whitespace-nowrap sm:h-9"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              <span>Apply Selection ({draftSelectedIds.size})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
