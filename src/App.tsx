import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FilePlus2,
  FileText,
  FolderOpen,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  getAccessToken,
  googleSignIn,
  initAuth,
  logout,
  openGoogleDrivePicker,
} from './lib/auth';
import type {
  AnalyzeResponseItem,
  DriveFileItem,
  NamingStyle,
  RenameAuditEntry,
  RenameTarget,
} from './types';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { RenameConfirmModal } from './components/RenameConfirmModal';
import { SnippetDrawer } from './components/SnippetDrawer';
import { AuditLogPanel } from './components/AuditLogPanel';

const AUDIT_STORAGE_KEY = 'drivetopic_audit_log_v1';

function formatBytes(sizeStr?: string): string {
  if (!sizeStr) return 'Google Doc';
  const bytes = Number(sizeStr);
  if (Number.isNaN(bytes) || bytes <= 0) return 'Google Doc';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatShortDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function friendlyMimeLabel(mimeType: string): string {
  if (mimeType === 'application/vnd.google-apps.document') return 'Google Doc';
  if (mimeType === 'text/markdown' || mimeType === 'text/x-markdown') return 'Markdown';
  if (mimeType === 'text/csv') return 'CSV';
  if (mimeType === 'application/json') return 'JSON';
  if (mimeType === 'text/html') return 'HTML';
  return 'Plain Text';
}

function reformatNameLocally(
  currentName: string,
  originalName: string,
  mimeType: string,
  style: NamingStyle
): string {
  const isGoogleDoc = mimeType === 'application/vnd.google-apps.document';
  const extMatch = !isGoogleDoc ? originalName.match(/(\.[a-zA-Z0-9]{1,8})$/) : null;
  const extension = extMatch ? extMatch[1].toLowerCase() : '';
  const stemRaw = currentName.replace(/\.[a-zA-Z0-9]{1,8}$/, '').trim();
  const words = stemRaw.split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) return currentName;

  if (style === 'kebab-case') {
    return `${words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean).join('-')}${extension}`;
  }
  if (style === 'snake_case') {
    return `${words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean).join('_')}${extension}`;
  }
  const titled = words
    .map((w) => (/^[A-Z0-9]{2,5}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
  return `${titled}${extension}`;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState<'workspace' | 'audit' | 'guide'>('workspace');
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isAnalyzingBatch, setIsAnalyzingBatch] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const [namingStyle, setNamingStyle] = useState<NamingStyle>('title-case');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unscanned' | 'ready' | 'renamed'>('all');

  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);

  const [inspectedFileId, setInspectedFileId] = useState<string | null>(null);
  const [pendingRenameTargets, setPendingRenameTargets] = useState<RenameTarget[]>([]);
  const [isExecutingRename, setIsExecutingRename] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [auditEntries, setAuditEntries] = useState<RenameAuditEntry[]>(() => {
    try {
      const saved = localStorage.getItem(AUDIT_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as RenameAuditEntry[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(auditEntries.slice(0, 200)));
    } catch {
      // Ignore storage quota issues
    }
  }, [auditEntries]);

  const appendAuditEntry = useCallback((entry: Omit<RenameAuditEntry, 'id' | 'timestamp'>) => {
    const record: RenameAuditEntry = {
      ...entry,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
    setAuditEntries((prev) => [record, ...prev]);
    return record;
  }, []);

  const requireToken = useCallback((): string | null => {
    const token = getAccessToken();
    if (!token) {
      setNeedsAuth(true);
      setBannerError('Google Drive session expired. Please sign in with Google to continue.');
      return null;
    }
    return token;
  }, []);

  const loadDriveFiles = useCallback(
    async (explicitToken?: string) => {
      const token = explicitToken ?? requireToken();
      if (!token) return;

      setIsLoadingFiles(true);
      setBannerError(null);

      try {
        const res = await fetch('/api/drive/files', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as {
          files?: Array<{
            id: string;
            name: string;
            mimeType: string;
            modifiedTime?: string;
            size?: string;
            webViewLink?: string;
          }>;
          error?: string;
        };

        if (!res.ok) {
          if (res.status === 401) setNeedsAuth(true);
          throw new Error(data.error || 'Failed to fetch Drive files.');
        }

        const fetched = data.files || [];
        setFiles((prev) => {
          const prevMap = new Map(prev.map((item) => [item.id, item]));
          return fetched.map((f) => {
            const existing = prevMap.get(f.id);
            if (existing) {
              return {
                ...existing,
                name: f.name,
                mimeType: f.mimeType,
                modifiedTime: f.modifiedTime,
                size: f.size,
                webViewLink: f.webViewLink,
              };
            }
            return {
              id: f.id,
              name: f.name,
              mimeType: f.mimeType,
              modifiedTime: f.modifiedTime,
              size: f.size,
              webViewLink: f.webViewLink,
              status: 'unscanned',
              selected: true,
            };
          });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to load Google Drive files.';
        setBannerError(msg);
      } finally {
        setIsLoadingFiles(false);
      }
    },
    [requireToken]
  );

  useEffect(() => {
    const unsubscribe = initAuth(
      (authedUser, token) => {
        setUser(authedUser);
        setNeedsAuth(false);
        void loadDriveFiles(token);
      },
      () => {
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, [loadDriveFiles]);

  const handleSignIn = async () => {
    setIsLoggingIn(true);
    setBannerError(null);
    setBannerNotice(null);
    try {
      const result = await googleSignIn();
      setUser(result.user);
      setNeedsAuth(false);
      await loadDriveFiles(result.accessToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      setBannerError(msg);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setFiles([]);
    setNeedsAuth(true);
    setBannerNotice('Signed out from Google Drive.');
  };

  const handleNamingStyleChange = (nextStyle: NamingStyle) => {
    setNamingStyle(nextStyle);
    setFiles((prev) =>
      prev.map((f) => {
        if (!f.proposedName) return f;
        const reformatted = reformatNameLocally(
          f.editedName || f.proposedName,
          f.name,
          f.mimeType,
          nextStyle
        );
        return {
          ...f,
          proposedName: reformatted,
          editedName: reformatted,
        };
      })
    );
  };

  const handleAnalyzeFiles = async (targetFiles: DriveFileItem[]) => {
    const token = requireToken();
    if (!token || targetFiles.length === 0) return;

    const targetIds = new Set(targetFiles.map((f) => f.id));
    setIsAnalyzingBatch(true);
    setBannerError(null);
    setBannerNotice(null);

    setFiles((prev) =>
      prev.map((f) =>
        targetIds.has(f.id) ? { ...f, status: 'analyzing', errorMessage: undefined } : f
      )
    );

    try {
      const res = await fetch('/api/drive/analyze', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          namingStyle,
          files: targetFiles.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType })),
        }),
      });

      const data = (await res.json()) as {
        analyses?: AnalyzeResponseItem[];
        error?: string;
      };

      if (!res.ok) {
        if (res.status === 401) setNeedsAuth(true);
        throw new Error(data.error || 'Content analysis failed.');
      }

      const analysisMap = new Map((data.analyses || []).map((a) => [a.fileId, a]));

      setFiles((prev) =>
        prev.map((f) => {
          const item = analysisMap.get(f.id);
          if (!item) return f;
          if (item.error) {
            return {
              ...f,
              status: 'error',
              errorMessage: item.error,
            };
          }
          return {
            ...f,
            status: 'ready',
            snippet: item.snippet,
            coreTopic: item.coreTopic,
            summary: item.summary,
            keywords: item.keywords,
            confidence: item.confidence,
            proposedName: item.proposedName,
            editedName: item.proposedName,
            selected: item.proposedName !== f.name,
          };
        })
      );

      setBannerNotice(
        `Analyzed ${targetFiles.length} ${targetFiles.length === 1 ? 'document' : 'documents'} and generated topic-based filenames.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to analyze file contents.';
      setBannerError(msg);
      setFiles((prev) =>
        prev.map((f) =>
          targetIds.has(f.id) && f.status === 'analyzing'
            ? { ...f, status: 'error', errorMessage: msg }
            : f
        )
      );
    } finally {
      setIsAnalyzingBatch(false);
    }
  };

  const handleSeedSamples = async () => {
    const token = requireToken();
    if (!token) return;

    setIsSeeding(true);
    setBannerError(null);
    setBannerNotice(null);

    try {
      const res = await fetch('/api/drive/seed', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as {
        files?: Array<{ id: string; name: string; webViewLink?: string }>;
        error?: string;
      };

      if (!res.ok) {
        if (res.status === 401) setNeedsAuth(true);
        throw new Error(data.error || 'Failed to create sample Drive files.');
      }

      for (const created of data.files || []) {
        appendAuditEntry({
          fileId: created.id,
          originalName: '—',
          newName: created.name,
          coreTopic: 'Sample File Created',
          action: 'seed',
          status: 'success',
          webViewLink: created.webViewLink,
        });
      }

      await loadDriveFiles(token);
      setBannerNotice(
        `Created ${data.files?.length || 0} sample documents in your Google Drive. Click "Analyze All" to extract their core topics.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create sample files.';
      setBannerError(msg);
    } finally {
      setIsSeeding(false);
    }
  };

  const handleLocalUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    const token = requireToken();
    if (!token) return;

    setIsUploading(true);
    setBannerError(null);
    setBannerNotice(null);

    let uploadedCount = 0;
    try {
      for (const localFile of Array.from(selectedFiles)) {
        const textContent = await localFile.text();
        const res = await fetch('/api/drive/upload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: localFile.name,
            content: textContent.slice(0, 200000),
            mimeType: localFile.type || 'text/plain',
          }),
        });
        const data = (await res.json()) as {
          file?: { id: string; name: string; webViewLink?: string };
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || `Failed to upload ${localFile.name}`);
        }
        uploadedCount += 1;
        if (data.file) {
          appendAuditEntry({
            fileId: data.file.id,
            originalName: localFile.name,
            newName: data.file.name,
            coreTopic: 'Uploaded to Drive',
            action: 'upload',
            status: 'success',
            webViewLink: data.file.webViewLink,
          });
        }
      }
      await loadDriveFiles(token);
      setBannerNotice(`Uploaded ${uploadedCount} ${uploadedCount === 1 ? 'file' : 'files'} to Google Drive.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'File upload failed.';
      setBannerError(msg);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleOpenPicker = async () => {
    const token = requireToken();
    if (!token) return;

    setBannerError(null);
    try {
      const picked = await openGoogleDrivePicker(token);
      if (picked) {
        await loadDriveFiles(token);
        setBannerNotice('Added selected files from Google Drive.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Drive Picker is unavailable.';
      setBannerError(
        `${msg} You can upload local text files or create sample Drive files directly below.`
      );
    }
  };

  // Trigger confirmation modal for single file rename
  const requestSingleRename = (file: DriveFileItem) => {
    const targetName = (file.editedName ?? file.proposedName ?? '').trim();
    if (!targetName || targetName === file.name) return;
    setPendingRenameTargets([
      {
        fileId: file.id,
        originalName: file.name,
        newName: targetName,
        coreTopic: file.coreTopic || 'Topic Rename',
        mode: 'rename',
      },
    ]);
  };

  // Trigger confirmation modal for batch rename
  const requestBatchRename = () => {
    const candidates = files.filter((f) => {
      if (!f.selected) return false;
      if (f.status !== 'ready' && f.status !== 'renamed') return false;
      const targetName = (f.editedName ?? f.proposedName ?? '').trim();
      return targetName.length > 0 && targetName !== f.name;
    });

    if (candidates.length === 0) return;

    setPendingRenameTargets(
      candidates.map((f) => ({
        fileId: f.id,
        originalName: f.name,
        newName: (f.editedName ?? f.proposedName ?? f.name).trim(),
        coreTopic: f.coreTopic || 'Topic Rename',
        mode: 'rename',
      }))
    );
  };

  // Trigger confirmation modal for reverting an audit log entry
  const requestRevertRename = (entry: RenameAuditEntry) => {
    setPendingRenameTargets([
      {
        fileId: entry.fileId,
        originalName: entry.newName,
        newName: entry.originalName,
        coreTopic: entry.coreTopic,
        mode: 'revert',
        auditEntryId: entry.id,
      },
    ]);
  };

  // Execute confirmed rename(s) via Drive API files.update
  const executeConfirmedRenames = async () => {
    const token = requireToken();
    if (!token || pendingRenameTargets.length === 0) return;

    setIsExecutingRename(true);
    setBannerError(null);
    setBannerNotice(null);

    const targetIds = new Set(pendingRenameTargets.map((t) => t.fileId));
    setFiles((prev) =>
      prev.map((f) => (targetIds.has(f.id) ? { ...f, status: 'renaming' } : f))
    );

    let successCount = 0;
    let failCount = 0;

    for (const target of pendingRenameTargets) {
      try {
        const res = await fetch('/api/drive/rename', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileId: target.fileId,
            newName: target.newName,
          }),
        });

        const data = (await res.json()) as {
          file?: {
            id: string;
            name: string;
            modifiedTime?: string;
            webViewLink?: string;
          };
          error?: string;
        };

        if (!res.ok || !data.file) {
          throw new Error(data.error || 'Rename failed.');
        }

        successCount += 1;

        setFiles((prev) =>
          prev.map((f) =>
            f.id === target.fileId
              ? {
                  ...f,
                  name: data.file!.name,
                  modifiedTime: data.file!.modifiedTime ?? f.modifiedTime,
                  webViewLink: data.file!.webViewLink ?? f.webViewLink,
                  proposedName: data.file!.name,
                  editedName: data.file!.name,
                  status: target.mode === 'revert' ? 'ready' : 'renamed',
                  selected: false,
                  errorMessage: undefined,
                }
              : f
          )
        );

        appendAuditEntry({
          fileId: target.fileId,
          originalName: target.originalName,
          newName: data.file.name,
          coreTopic: target.coreTopic,
          action: target.mode,
          status: 'success',
          webViewLink: data.file.webViewLink,
        });

        if (target.mode === 'revert' && target.auditEntryId) {
          setAuditEntries((prev) =>
            prev.map((entry) =>
              entry.id === target.auditEntryId ? { ...entry, reverted: true } : entry
            )
          );
        }
      } catch (err) {
        failCount += 1;
        const msg = err instanceof Error ? err.message : 'Drive rename error';
        setFiles((prev) =>
          prev.map((f) =>
            f.id === target.fileId ? { ...f, status: 'error', errorMessage: msg } : f
          )
        );
        appendAuditEntry({
          fileId: target.fileId,
          originalName: target.originalName,
          newName: target.newName,
          coreTopic: target.coreTopic,
          action: target.mode,
          status: 'failed',
          errorMessage: msg,
        });
      }
    }

    setIsExecutingRename(false);
    setPendingRenameTargets([]);

    if (failCount === 0 && successCount > 0) {
      setBannerNotice(
        `Successfully updated ${successCount} ${successCount === 1 ? 'filename' : 'filenames'} in Google Drive.`
      );
    } else if (failCount > 0) {
      setBannerError(
        `Completed with ${successCount} succeeded and ${failCount} failed. Review the Audit Trail for details.`
      );
    }
  };

  const updateEditedName = (fileId: string, nextName: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, editedName: nextName } : f))
    );
  };

  const toggleSelectFile = (fileId: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, selected: !f.selected } : f))
    );
  };

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return files.filter((f) => {
      if (statusFilter === 'unscanned' && f.status !== 'unscanned') return false;
      if (statusFilter === 'ready' && f.status !== 'ready') return false;
      if (statusFilter === 'renamed' && f.status !== 'renamed') return false;
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        (f.coreTopic || '').toLowerCase().includes(q) ||
        (f.editedName || f.proposedName || '').toLowerCase().includes(q)
      );
    });
  }, [files, searchQuery, statusFilter]);

  const allVisibleSelected =
    filteredFiles.length > 0 && filteredFiles.every((f) => Boolean(f.selected));

  const toggleSelectAllVisible = () => {
    const visibleIds = new Set(filteredFiles.map((f) => f.id));
    setFiles((prev) =>
      prev.map((f) => (visibleIds.has(f.id) ? { ...f, selected: !allVisibleSelected } : f))
    );
  };

  const stats = useMemo(() => {
    const total = files.length;
    const analyzed = files.filter((f) => f.status === 'ready' || f.status === 'renamed').length;
    const pendingRenames = files.filter((f) => {
      const target = (f.editedName ?? f.proposedName ?? '').trim();
      return (f.status === 'ready' || f.status === 'renamed') && target && target !== f.name;
    }).length;
    const completedRenames = auditEntries.filter(
      (e) => e.action === 'rename' && e.status === 'success'
    ).length;
    const selectedReadyForRename = files.filter((f) => {
      if (!f.selected) return false;
      const target = (f.editedName ?? f.proposedName ?? '').trim();
      return (f.status === 'ready' || f.status === 'renamed') && target && target !== f.name;
    }).length;
    const selectedForAnalysis = files.filter((f) => f.selected).length;
    return {
      total,
      analyzed,
      pendingRenames,
      completedRenames,
      selectedReadyForRename,
      selectedForAnalysis,
    };
  }, [files, auditEntries]);

  const inspectedFile = useMemo(
    () => files.find((f) => f.id === inspectedFileId) ?? null,
    [files, inspectedFileId]
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Bar Contract: Exactly 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-3.5">
          {/* Zone 1: Single-line brand wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('workspace')}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            DriveTopic
          </button>

          {/* Zone 2: Clean single-line text navigation links */}
          <nav className="flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('workspace')}
              className={`border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'workspace'
                  ? 'border-blue-600 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Workspace
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className={`border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                activeTab === 'audit'
                  ? 'border-blue-600 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Audit Trail ({auditEntries.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('guide')}
              className={`border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'guide'
                  ? 'border-blue-600 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              How It Works
            </button>
          </nav>

          {/* Zone 3: Single primary auth action */}
          <div className="flex items-center shrink-0">
            {needsAuth ? (
              <GoogleSignInButton
                onClick={handleSignIn}
                disabled={isLoggingIn}
                label={isLoggingIn ? 'Connecting...' : 'Sign in with Google'}
              />
            ) : (
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <LogOut className="h-4 w-4 text-slate-500" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Notifications */}
        {bannerError && (
          <div
            role="alert"
            className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
              <span>{bannerError}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerError(null)}
              className="text-xs font-medium text-red-700 hover:underline whitespace-nowrap shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {bannerNotice && (
          <div
            role="status"
            className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <span>{bannerNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerNotice(null)}
              className="text-xs font-medium text-emerald-800 hover:underline whitespace-nowrap shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {activeTab === 'guide' ? (
          <section className="rounded-lg border border-slate-200 bg-white p-8">
            <div className="max-w-3xl">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Automated Topic-Based Google Drive Renaming
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                DriveTopic connects to your Google Drive with scoped file permissions, inspects
                document text snippets to identify each file&apos;s core subject, and proposes clean
                standardized filenames for your explicit approval.
              </p>

              <div className="mt-8 grid gap-6 border-t border-slate-200 pt-8 sm:grid-cols-3">
                <div>
                  <div className="font-mono text-xs font-medium text-slate-500">01. Connect</div>
                  <h2 className="mt-1 text-base font-semibold text-slate-900">
                    Scoped Drive Access
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                    Sign in with Google using the least-privilege{' '}
                    <span className="font-mono text-xs text-slate-800">drive.file</span> permission.
                    Tokens stay in browser memory only.
                  </p>
                </div>

                <div>
                  <div className="font-mono text-xs font-medium text-slate-500">02. Analyze</div>
                  <h2 className="mt-1 text-base font-semibold text-slate-900">
                    Content Topic Extraction
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                    Reads Google Docs, Markdown, Plain Text, and CSV snippets to summarize content
                    and draft clean filenames while preserving file extensions.
                  </p>
                </div>

                <div>
                  <div className="font-mono text-xs font-medium text-slate-500">03. Confirm</div>
                  <h2 className="mt-1 text-base font-semibold text-slate-900">
                    Reviewed Batch Rename
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                    Edit any proposed title inline, confirm changes in the review dialog, and track
                    or revert every update in the Audit Trail.
                  </p>
                </div>
              </div>
            </div>
          </section>
        ) : activeTab === 'audit' ? (
          <AuditLogPanel
            entries={auditEntries}
            onRequestRevert={requestRevertRename}
            onClearHistory={() => setAuditEntries([])}
          />
        ) : needsAuth ? (
          /* Unauthenticated Landing Workspace */
          <section className="rounded-lg border border-slate-200 bg-white p-8 sm:p-12">
            <div className="grid items-center gap-10 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <p className="text-xs font-medium text-slate-500">
                  Google Drive Document Intelligence · Scoped Permission
                </p>
                <h1 className="mt-2 max-w-2xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl [text-wrap:balance]">
                  Turn cryptic Drive filenames into clear, content-accurate titles.
                </h1>
                <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">
                  Connect your Google Drive to extract document snippets, determine each file&apos;s
                  core topic, and apply standardized renames in a single audited workflow.
                </p>

                <div className="mt-7 flex flex-wrap items-center gap-4">
                  <GoogleSignInButton
                    onClick={handleSignIn}
                    disabled={isLoggingIn}
                    label={isLoggingIn ? 'Connecting Google Drive...' : 'Sign in with Google'}
                  />
                  <button
                    type="button"
                    onClick={() => setActiveTab('guide')}
                    className="text-sm font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
                  >
                    Read architecture overview
                  </button>
                </div>
              </div>

              <div className="lg:col-span-5">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                  <div className="border-b border-slate-200 pb-3 text-xs font-semibold text-slate-700">
                    Example Transformation Preview
                  </div>
                  <div className="divide-y divide-slate-200">
                    <div className="py-3">
                      <div className="font-mono text-xs text-slate-500">untitled_export_04.txt</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        Q4 Cloud Infrastructure Cost Audit.txt
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        Cloud Cost Audit · Plain Text · 1.2 KB
                      </div>
                    </div>
                    <div className="py-3">
                      <div className="font-mono text-xs text-slate-500">raw_meeting_dump_v2</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        Engineering Onboarding First 30 Days Guide
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        Employee Onboarding · Google Doc
                      </div>
                    </div>
                    <div className="pt-3">
                      <div className="font-mono text-xs text-slate-500">notes_temp_991.md</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        Customer Churn Exit Interview Synthesis.md
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        Churn Research · Markdown · 0.9 KB
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : (
          /* Authenticated Workspace */
          <div className="space-y-6">
            {/* Workspace Header & KPI Summary Row */}
            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-slate-900">
                    Drive Document Renamer
                  </h1>
                  <p className="mt-0.5 text-sm text-slate-600">
                    Signed in as{' '}
                    <span className="font-medium text-slate-900">
                      {user?.email || user?.displayName || 'Google Drive User'}
                    </span>{' '}
                    · Scoped to app-authorized Drive files
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".txt,.md,.csv,.json,.html,text/plain,text/markdown"
                    onChange={handleLocalUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {isUploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Upload className="h-4 w-4 text-slate-500" aria-hidden="true" />
                    )}
                    <span>{isUploading ? 'Uploading...' : 'Upload to Drive'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenPicker}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    <FolderOpen className="h-4 w-4 text-slate-500" aria-hidden="true" />
                    <span>Select from Drive</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSeedSamples}
                    disabled={isSeeding}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {isSeeding ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <FilePlus2 className="h-4 w-4 text-slate-500" aria-hidden="true" />
                    )}
                    <span>{isSeeding ? 'Creating...' : 'Create Sample Files'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void loadDriveFiles()}
                    disabled={isLoadingFiles}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <RefreshCw
                      className={`h-4 w-4 text-slate-500 ${isLoadingFiles ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {/* 4-Column Tabular Metrics Strip */}
              <div className="grid grid-cols-2 divide-y divide-slate-200 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
                <div className="px-6 py-4">
                  <div className="text-xs font-medium text-slate-500">Files Indexed</div>
                  <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                    {stats.total}
                  </div>
                </div>
                <div className="px-6 py-4">
                  <div className="text-xs font-medium text-slate-500">Topics Extracted</div>
                  <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                    {stats.analyzed}
                  </div>
                </div>
                <div className="px-6 py-4">
                  <div className="text-xs font-medium text-slate-500">Ready to Rename</div>
                  <div className="mt-1 font-mono text-2xl font-semibold text-blue-600 tabular-nums">
                    {stats.pendingRenames}
                  </div>
                </div>
                <div className="px-6 py-4">
                  <div className="text-xs font-medium text-slate-500">Completed Renames</div>
                  <div className="mt-1 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
                    {stats.completedRenames}
                  </div>
                </div>
              </div>
            </section>

            {/* Workspace Toolbar & File Table */}
            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search files or topics..."
                      className="h-9 w-56 rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
                    {(
                      [
                        { id: 'all', label: 'All' },
                        { id: 'unscanned', label: 'Unscanned' },
                        { id: 'ready', label: 'Ready' },
                        { id: 'renamed', label: 'Renamed' },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setStatusFilter(tab.id)}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                          statusFilter === tab.id
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <label htmlFor="naming-style-select" className="text-xs font-medium text-slate-500">
                      Format
                    </label>
                    <select
                      id="naming-style-select"
                      value={namingStyle}
                      onChange={(e) => handleNamingStyleChange(e.target.value as NamingStyle)}
                      className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-800 focus:border-blue-600 focus:outline-none"
                    >
                      <option value="title-case">Title Case</option>
                      <option value="kebab-case">kebab-case</option>
                      <option value="snake_case">snake_case</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={isAnalyzingBatch || files.length === 0}
                    onClick={() => {
                      const targets =
                        stats.selectedForAnalysis > 0
                          ? files.filter((f) => f.selected)
                          : files;
                      void handleAnalyzeFiles(targets);
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {isAnalyzingBatch ? (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden="true" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-blue-600" aria-hidden="true" />
                    )}
                    <span>
                      {isAnalyzingBatch
                        ? 'Analyzing Content...'
                        : stats.selectedForAnalysis > 0 && stats.selectedForAnalysis < files.length
                          ? `Analyze Selected (${stats.selectedForAnalysis})`
                          : 'Analyze All'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={stats.selectedReadyForRename === 0 || isExecutingRename}
                    onClick={requestBatchRename}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                    <span>
                      Batch Rename
                      {stats.selectedReadyForRename > 0
                        ? ` (${stats.selectedReadyForRename})`
                        : ''}
                    </span>
                  </button>
                </div>
              </div>

              {/* Loading Skeleton */}
              {isLoadingFiles && files.length === 0 ? (
                <div className="divide-y divide-slate-200">
                  {[1, 2, 3, 4].map((row) => (
                    <div key={row} className="grid grid-cols-12 items-center gap-4 px-6 py-4">
                      <div className="col-span-4 h-4 animate-pulse rounded bg-slate-200" />
                      <div className="col-span-3 h-4 animate-pulse rounded bg-slate-200" />
                      <div className="col-span-3 h-4 animate-pulse rounded bg-slate-200" />
                      <div className="col-span-2 h-4 animate-pulse rounded bg-slate-200" />
                    </div>
                  ))}
                </div>
              ) : files.length === 0 ? (
                /* Empty State */
                <div className="px-6 py-16 text-center">
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                    <FileText className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h2 className="mt-4 text-base font-semibold text-slate-900">
                    No authorized Drive documents found yet
                  </h2>
                  <p className="mx-auto mt-1.5 max-w-lg text-sm text-slate-600">
                    Because DriveTopic uses the least-privilege{' '}
                    <span className="font-mono text-xs text-slate-800">drive.file</span> scope, it
                    only sees files you select, upload, or create with this app.
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={handleSeedSamples}
                      disabled={isSeeding}
                      className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
                    >
                      <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                      <span>{isSeeding ? 'Creating Sample Files...' : 'Create Sample Files in Drive'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      <Upload className="h-4 w-4" aria-hidden="true" />
                      <span>Upload Text or Markdown</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenPicker}
                      className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      <FolderOpen className="h-4 w-4" aria-hidden="true" />
                      <span>Select from Drive</span>
                    </button>
                  </div>
                </div>
              ) : filteredFiles.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <p className="text-sm font-medium text-slate-900">No files match your current filter</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setStatusFilter('all');
                    }}
                    className="mt-2 text-sm font-medium text-blue-600 hover:underline"
                  >
                    Reset filters
                  </button>
                </div>
              ) : (
                /* High-Density File Table */
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                        <th className="w-10 px-6 py-3">
                          <input
                            type="checkbox"
                            aria-label="Select all visible files"
                            checked={allVisibleSelected}
                            onChange={toggleSelectAllVisible}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                          />
                        </th>
                        <th className="px-4 py-3">Original File</th>
                        <th className="px-4 py-3">Core Topic &amp; Summary</th>
                        <th className="px-4 py-3">Proposed Filename</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-6 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredFiles.map((file) => {
                        const proposedValue = file.editedName ?? file.proposedName ?? '';
                        const hasProposedChange =
                          (file.status === 'ready' || file.status === 'renamed') &&
                          proposedValue.trim().length > 0 &&
                          proposedValue.trim() !== file.name;

                        return (
                          <tr key={file.id} className="align-top hover:bg-slate-50/70">
                            <td className="px-6 py-4">
                              <input
                                type="checkbox"
                                aria-label={`Select ${file.name}`}
                                checked={Boolean(file.selected)}
                                onChange={() => toggleSelectFile(file.id)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                              />
                            </td>

                            <td className="max-w-[240px] px-4 py-3.5">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setInspectedFileId(file.id)}
                                  className="truncate text-left font-medium text-slate-900 hover:text-blue-600 hover:underline"
                                  title={file.name}
                                >
                                  {file.name}
                                </button>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 tabular-nums">
                                <span>{friendlyMimeLabel(file.mimeType)}</span>
                                <span aria-hidden="true">·</span>
                                <span>{formatBytes(file.size)}</span>
                                <span aria-hidden="true">·</span>
                                <span>{formatShortDate(file.modifiedTime)}</span>
                              </div>
                            </td>

                            <td className="max-w-[280px] px-4 py-3.5">
                              {file.coreTopic ? (
                                <div>
                                  <div className="text-xs font-semibold text-slate-900">
                                    {file.coreTopic}
                                  </div>
                                  <p
                                    className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-600"
                                    title={file.summary}
                                  >
                                    {file.summary}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => setInspectedFileId(file.id)}
                                    className="mt-1 text-xs font-medium text-blue-600 hover:underline"
                                  >
                                    Inspect snippet
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-slate-400">
                                  Run analysis to extract core topic
                                </span>
                              )}
                            </td>

                            <td className="min-w-[250px] px-4 py-3.5">
                              {file.status === 'ready' || file.status === 'renamed' ? (
                                <input
                                  type="text"
                                  aria-label={`Proposed filename for ${file.name}`}
                                  value={proposedValue}
                                  onChange={(e) => updateEditedName(file.id, e.target.value)}
                                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
                                />
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>

                            <td className="whitespace-nowrap px-4 py-4">
                              {file.status === 'unscanned' && (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                                  <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span>Unscanned</span>
                                </span>
                              )}
                              {file.status === 'analyzing' && (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600">
                                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                                  <span>Analyzing</span>
                                </span>
                              )}
                              {file.status === 'ready' && (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                                  <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span>{hasProposedChange ? 'Ready' : 'No Change'}</span>
                                </span>
                              )}
                              {file.status === 'renaming' && (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600">
                                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                                  <span>Renaming</span>
                                </span>
                              )}
                              {file.status === 'renamed' && (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span>Renamed</span>
                                </span>
                              )}
                              {file.status === 'error' && (
                                <span
                                  className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700"
                                  title={file.errorMessage}
                                >
                                  <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span>Error</span>
                                </span>
                              )}
                            </td>

                            <td className="whitespace-nowrap px-6 py-3.5 text-right">
                              <div className="inline-flex items-center gap-2">
                                {file.status === 'unscanned' || file.status === 'error' ? (
                                  <button
                                    type="button"
                                    disabled={isAnalyzingBatch}
                                    onClick={() => void handleAnalyzeFiles([file])}
                                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                                  >
                                    Analyze
                                  </button>
                                ) : hasProposedChange ? (
                                  <button
                                    type="button"
                                    disabled={isExecutingRename}
                                    onClick={() => requestSingleRename(file)}
                                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                                  >
                                    Rename
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={isAnalyzingBatch}
                                    onClick={() => void handleAnalyzeFiles([file])}
                                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                                  >
                                    Re-analyze
                                  </button>
                                )}

                                {file.webViewLink && (
                                  <a
                                    href={file.webViewLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label={`Open ${file.name} in Google Drive`}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
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
              )}
            </section>
          </div>
        )}
      </main>

      <SnippetDrawer
        file={inspectedFile}
        onClose={() => setInspectedFileId(null)}
        onUpdateProposedName={updateEditedName}
        onRequestRename={(file) => {
          setInspectedFileId(null);
          requestSingleRename(file);
        }}
      />

      <RenameConfirmModal
        targets={pendingRenameTargets}
        isSubmitting={isExecutingRename}
        onConfirm={() => void executeConfirmedRenames()}
        onCancel={() => {
          if (!isExecutingRename) setPendingRenameTargets([]);
        }}
      />
    </div>
  );
}
