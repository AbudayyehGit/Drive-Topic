import React, { useEffect } from 'react';
import { ExternalLink, FileText, X } from 'lucide-react';
import type { DriveFileItem, NamingStyle } from '../types';
import { formatFilenamePreview } from '../lib/naming';
import { ConfidenceBadge } from './ConfidenceBadge';
import { ProposedFilenameInput } from './ProposedFilenameInput';

interface SnippetDrawerProps {
  file: DriveFileItem | null;
  namingStyle: NamingStyle;
  onClose: () => void;
  onUpdateProposedName: (fileId: string, nextName: string) => void;
  onRequestRename: (file: DriveFileItem) => void;
}

export const SnippetDrawer: React.FC<SnippetDrawerProps> = ({
  file,
  namingStyle,
  onClose,
  onUpdateProposedName,
  onRequestRename,
}) => {
  useEffect(() => {
    if (!file) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [file, onClose]);

  if (!file) return null;

  const activeName = file.editedName ?? file.proposedName ?? '';
  const formattedTarget = activeName.trim()
    ? formatFilenamePreview(activeName, file.name, file.mimeType, namingStyle)
    : '';
  const canRename =
    (file.status === 'ready' || file.status === 'renamed') &&
    formattedTarget.length > 0 &&
    formattedTarget !== file.name;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-slate-900/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="snippet-drawer-title"
    >
      <div className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{file.mimeType}</span>
            </div>
            <h2
              id="snippet-drawer-title"
              className="mt-1 break-words text-base font-semibold text-slate-900 sm:truncate"
              title={file.name}
            >
              {file.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close document inspector"
            className="shrink-0 rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:space-y-6 sm:px-6">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-500">Extracted Core Topic</h3>
              <ConfidenceBadge
                confidenceScore={file.confidenceScore}
                confidence={file.confidence}
              />
            </div>
            <p className="mt-1.5 text-sm font-medium text-slate-900">
              {file.coreTopic || 'Not analyzed yet'}
              {file.category ? (
                <span className="ml-2 font-normal text-xs text-slate-500">
                  · {file.category}
                </span>
              ) : null}
            </p>
            {file.keywords && file.keywords.length > 0 && (
              <p className="mt-1 break-words text-xs text-slate-500">
                Keywords: {file.keywords.join(' · ')}
              </p>
            )}
          </div>

          <div className="border-t border-slate-200 pt-5">
            <h3 className="text-xs font-semibold text-slate-500">Content Summary</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
              {file.summary || 'Run content analysis to generate a summary from this document.'}
            </p>
          </div>

          <div className="border-t border-slate-200 pt-5">
            <label
              htmlFor="drawer-proposed-name"
              className="block text-xs font-semibold text-slate-500"
            >
              Proposed Filename
            </label>
            <ProposedFilenameInput
              id="drawer-proposed-name"
              ariaLabel={`Proposed filename for ${file.name}`}
              value={activeName}
              originalName={file.name}
              mimeType={file.mimeType}
              namingStyle={namingStyle}
              onChange={(next) => onUpdateProposedName(file.id, next)}
              className="mt-2 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none sm:h-10"
            />
          </div>

          <div className="border-t border-slate-200 pt-5">
            <h3 className="text-xs font-semibold text-slate-500">Extracted Content Snippet</h3>
            <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-3.5 font-mono text-xs leading-relaxed text-slate-700 sm:p-4">
              {file.snippet || 'No snippet loaded yet. Click Analyze to read the file content from Google Drive.'}
            </pre>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          {file.webViewLink ? (
            <a
              href={file.webViewLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
            >
              <span>Open in Google Drive</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : (
            <span className="text-xs text-slate-400">Drive link unavailable</span>
          )}

          <div className="grid grid-cols-2 gap-2.5 sm:flex sm:items-center sm:gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap sm:h-9"
            >
              Close
            </button>
            <button
              type="button"
              disabled={!canRename}
              onClick={() => onRequestRename(file)}
              className="h-11 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap sm:h-9"
            >
              Rename File
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
