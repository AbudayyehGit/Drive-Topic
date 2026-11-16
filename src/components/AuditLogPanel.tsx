import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import type { RenameAuditEntry } from '../types';

interface AuditLogPanelProps {
  entries: RenameAuditEntry[];
  onRequestRevert: (entry: RenameAuditEntry) => void;
  onClearHistory: () => void;
}

export const AuditLogPanel: React.FC<AuditLogPanelProps> = ({
  entries,
  onRequestRevert,
  onClearHistory,
}) => {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed'>('all');

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (statusFilter !== 'all' && entry.status !== statusFilter) return false;
      if (!q) return true;
      return (
        entry.originalName.toLowerCase().includes(q) ||
        entry.newName.toLowerCase().includes(q) ||
        entry.coreTopic.toLowerCase().includes(q) ||
        entry.action.toLowerCase().includes(q)
      );
    });
  }, [entries, query, statusFilter]);

  const handleExportCsv = () => {
    const headers = ['Timestamp', 'Action', 'Status', 'Core Topic', 'Original Name', 'New Name', 'File ID'];
    const rows = filteredEntries.map((entry) => [
      entry.timestamp,
      entry.action,
      entry.status,
      entry.coreTopic,
      entry.originalName,
      entry.newName,
      entry.fileId,
    ]);

    const escapeCell = (val: string) => `"${String(val).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `drivetopic-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Rename Audit Trail</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Chronological record of Drive filename updates, uploads, and reversions.
          </p>
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <div className="relative w-full sm:w-52">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter logs..."
              className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none sm:h-9"
            />
          </div>

          <div className="grid grid-cols-3 gap-1 rounded-md border border-slate-200 bg-slate-100 p-1 sm:flex sm:items-center">
            {(['all', 'success', 'failed'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`rounded px-2.5 py-1.5 text-xs font-medium capitalize transition-colors whitespace-nowrap sm:py-1 ${
                  statusFilter === tab
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={filteredEntries.length === 0}
              className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap sm:h-9 sm:flex-none"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Export CSV</span>
            </button>

            {entries.length > 0 && (
              <button
                type="button"
                onClick={onClearHistory}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-red-600 whitespace-nowrap sm:h-9"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {filteredEntries.length === 0 ? (
        <div className="px-4 py-14 text-center sm:px-6">
          <p className="text-sm font-medium text-slate-900">No audit entries recorded yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Rename or upload files in the Workspace tab to populate the audit trail.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile & Tablet Stacked Audit List */}
          <div className="divide-y divide-slate-200 lg:hidden">
            {filteredEntries.map((entry) => {
              const formattedTime = new Date(entry.timestamp).toLocaleString(undefined, {
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              });

              const canRevert =
                entry.action === 'rename' &&
                entry.status === 'success' &&
                !entry.reverted &&
                entry.originalName !== entry.newName;

              return (
                <div key={entry.id} className="space-y-2.5 px-4 py-4">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-slate-500 tabular-nums">
                      {formattedTime} · <span className="capitalize">{entry.action}</span>
                    </span>
                    {entry.status === 'success' ? (
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>{entry.reverted ? 'Reverted' : 'Success'}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-medium text-red-700">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>Failed</span>
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 space-y-1">
                    <div className="break-words font-mono text-xs text-slate-500">
                      {entry.originalName}
                    </div>
                    <div className="flex items-start gap-1.5 text-sm font-medium text-slate-900">
                      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                      <span className="min-w-0 break-words">{entry.newName}</span>
                    </div>
                    <div className="text-xs text-slate-600">{entry.coreTopic}</div>
                  </div>

                  {(canRevert || entry.webViewLink) && (
                    <div className="flex items-center gap-4 pt-1">
                      {canRevert && (
                        <button
                          type="button"
                          onClick={() => onRequestRevert(entry)}
                          className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Revert Filename</span>
                        </button>
                      )}
                      {entry.webViewLink && (
                        <a
                          href={entry.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-[36px] items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                        >
                          <span>Open in Drive</span>
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop High-Density Table */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="px-6 py-3">Timestamp</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Original Filename</th>
                  <th className="px-4 py-3">Updated Filename</th>
                  <th className="px-4 py-3">Core Topic</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredEntries.map((entry) => {
                  const formattedTime = new Date(entry.timestamp).toLocaleString(undefined, {
                    month: 'short',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  });

                  const canRevert =
                    entry.action === 'rename' &&
                    entry.status === 'success' &&
                    !entry.reverted &&
                    entry.originalName !== entry.newName;

                  return (
                    <tr key={entry.id} className="hover:bg-slate-50/75">
                      <td className="whitespace-nowrap px-6 py-3 font-mono text-xs text-slate-600 tabular-nums">
                        {formattedTime}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs font-medium capitalize text-slate-700">
                        {entry.action}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-slate-600" title={entry.originalName}>
                        {entry.originalName}
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-3 font-medium text-slate-900" title={entry.newName}>
                        {entry.newName}
                      </td>
                      <td className="max-w-[160px] truncate px-4 py-3 text-xs text-slate-600" title={entry.coreTopic}>
                        {entry.coreTopic}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {entry.status === 'success' ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span>{entry.reverted ? 'Reverted' : 'Success'}</span>
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700"
                            title={entry.errorMessage}
                          >
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span>Failed</span>
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-right">
                        <div className="inline-flex items-center gap-3">
                          {canRevert && (
                            <button
                              type="button"
                              onClick={() => onRequestRevert(entry)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-blue-600 whitespace-nowrap shrink-0"
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Revert</span>
                            </button>
                          )}
                          {entry.webViewLink && (
                            <a
                              href={entry.webViewLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 whitespace-nowrap shrink-0"
                            >
                              <span>Drive</span>
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
};
