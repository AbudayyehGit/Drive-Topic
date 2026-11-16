import React from 'react';
import { ExternalLink, FileText, X } from 'lucide-react';
import type { DriveFileItem } from '../types';

interface SnippetDrawerProps {
  file: DriveFileItem | null;
  onClose: () => void;
  onUpdateProposedName: (fileId: string, nextName: string) => void;
  onRequestRename: (file: DriveFileItem) => void;
}

export const SnippetDrawer: React.FC<SnippetDrawerProps> = ({
  file,
  onClose,
  onUpdateProposedName,
  onRequestRename,
}) => {
  if (!file) return null;

  const activeName = file.editedName ?? file.proposedName ?? file.name;
  const canRename =
    (file.status === 'ready' || file.status === 'renamed') &&
    activeName.trim().length > 0 &&
    activeName.trim() !== file.name;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-slate-900/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="snippet-drawer-title"
    >
      <div className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div className="min-w-0 pr-4">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{file.mimeType}</span>
            </div>
            <h2
              id="snippet-drawer-title"
              className="mt-1 truncate text-base font-semibold text-slate-900"
              title={file.name}
            >
              {file.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close document inspector"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <div>
            <h3 className="text-xs font-semibold text-slate-500">Extracted Core Topic</h3>
            <p className="mt-1.5 text-sm font-medium text-slate-900">
              {file.coreTopic || 'Not analyzed yet'}
            </p>
            {file.keywords && file.keywords.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">
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
            <input
              id="drawer-proposed-name"
              type="text"
              value={activeName}
              onChange={(e) => onUpdateProposedName(file.id, e.target.value)}
              className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="border-t border-slate-200 pt-5">
            <h3 className="text-xs font-semibold text-slate-500">Extracted Content Snippet</h3>
            <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-700">
              {file.snippet || 'No snippet loaded yet. Click Analyze to read the file content from Google Drive.'}
            </pre>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
          {file.webViewLink ? (
            <a
              href={file.webViewLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              <span>Open in Google Drive</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : (
            <span className="text-xs text-slate-400">Drive link unavailable</span>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
            >
              Close
            </button>
            <button
              type="button"
              disabled={!canRename}
              onClick={() => onRequestRename(file)}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              Rename File
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
