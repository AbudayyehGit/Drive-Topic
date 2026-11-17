import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type AuthUser,
  getAccessToken,
  googleSignIn,
  initAuth,
  logout,
  openGoogleDrivePicker,
} from './lib/auth';
import {
  type AnalyzeResponseItem,
  type DriveFileItem,
  FOLDER_MIME_TYPE,
  type NamingStyle,
  type RenameAuditEntry,
  type RenameTarget,
} from './types';
import { formatFilenamePreview } from './lib/naming';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { RenameConfirmModal } from './components/RenameConfirmModal';
import { SnippetDrawer } from './components/SnippetDrawer';
import { AuditLogPanel } from './components/AuditLogPanel';
import { ConfidenceBadge } from './components/ConfidenceBadge';
import { SelectionOverviewCard } from './components/SelectionOverviewCard';
import { TopicSummaryChart } from './components/TopicSummaryChart';
import { TriStateCheckbox } from './components/TriStateCheckbox';
import { ProposedFilenameInput } from './components/ProposedFilenameInput';
import { DrivePickerModal } from './components/DrivePickerModal';

const AUDIT_STORAGE_KEY = 'drivetopic_audit_log_v1';
const SELECTED_IDS_STORAGE_KEY = 'drivetopic_selected_ids_v1';

function loadPersistedSelectedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SELECTED_IDS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is string => typeof id === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

function savePersistedSelectedIds(ids: Set<string>): void {
  try {
    localStorage.setItem(SELECTED_IDS_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Ignore storage quota issues
  }
}

function isFolderItem(item: { mimeType: string }): boolean {
  return item.mimeType === FOLDER_MIME_TYPE;
}

function formatShortDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function isExcludedExtensionName(name: string): boolean {
  return /\.(css|js|apsx|aspx)$/i.test(name.trim());
}

function friendlyMimeLabel(mimeType: string): string {
  if (mimeType === FOLDER_MIME_TYPE) return 'Folder';
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

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const lastLoadedTokenRef = useRef<string | null>(null);

  const [activeTab, setActiveTab] = useState<'workspace' | 'audit' | 'guide'>('workspace');
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [knownFilesById, setKnownFilesById] = useState<Record<string, DriveFileItem>>({});
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

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
  const [isDrivePickerOpen, setIsDrivePickerOpen] = useState(false);
  const [pendingRenameTargets, setPendingRenameTargets] = useState<RenameTarget[]>([]);
  const [isExecutingRename, setIsExecutingRename] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const knownFilesRef = useRef<Record<string, DriveFileItem>>({});
  const persistedSelectedIdsRef = useRef<Set<string>>(loadPersistedSelectedIds());

  useEffect(() => {
    knownFilesRef.current = knownFilesById;
  }, [knownFilesById]);

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
        const data = (await res.json()) as
          | Array<{
              id: string;
              name: string;
              mimeType: string;
              createdTime?: string;
              modifiedTime?: string;
              webViewLink?: string;
            }>
          | { error?: string };

        if (!res.ok) {
          if (res.status === 401) setNeedsAuth(true);
          const errMessage =
            !Array.isArray(data) && data.error ? data.error : 'Failed to fetch Drive files.';
          throw new Error(errMessage);
        }

        const rawList = Array.isArray(data) ? data : [];
        const fetched = rawList.filter(
          (f) => !isFolderItem(f) && !isExcludedExtensionName(f.name)
        );

        const prevCache = knownFilesRef.current;
        const selectedSet = persistedSelectedIdsRef.current;
        const mergedItems: DriveFileItem[] = fetched
          .map((f) => {
            const existing = prevCache[f.id];
            const isSelected = existing ? Boolean(existing.selected) : selectedSet.has(f.id);

            if (existing) {
              return {
                ...existing,
                name: f.name,
                mimeType: f.mimeType,
                createdTime: f.createdTime ?? existing.createdTime,
                modifiedTime: f.modifiedTime,
                webViewLink: f.webViewLink,
                selected: isSelected,
              };
            }
            return {
              id: f.id,
              name: f.name,
              mimeType: f.mimeType,
              createdTime: f.createdTime,
              modifiedTime: f.modifiedTime,
              webViewLink: f.webViewLink,
              status: 'unscanned' as const,
              selected: isSelected,
            };
          })
          .sort((a, b) => {
            const aTime = Date.parse(a.createdTime || a.modifiedTime || '') || 0;
            const bTime = Date.parse(b.createdTime || b.modifiedTime || '') || 0;
            if (aTime !== bTime) return aTime - bTime;
            return a.name.localeCompare(b.name);
          });

        const nextKnown: Record<string, DriveFileItem> = {};
        for (const item of mergedItems) {
          nextKnown[item.id] = item;
        }
        knownFilesRef.current = nextKnown;
        setFiles(mergedItems);
        setKnownFilesById(nextKnown);
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
        if (lastLoadedTokenRef.current !== token) {
          lastLoadedTokenRef.current = token;
          void loadDriveFiles(token);
        }
      },
      () => {
        lastLoadedTokenRef.current = null;
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
      if (!result) {
        setBannerNotice(
          'Sign-in was cancelled before completion. Click "Sign in with Google" whenever you are ready to connect Google Drive.'
        );
        return;
      }
      setUser(result.user);
      setNeedsAuth(false);
      lastLoadedTokenRef.current = result.accessToken;
      await loadDriveFiles(result.accessToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      setBannerError(msg);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    lastLoadedTokenRef.current = null;
    await logout();
    setUser(null);
    setFiles([]);
    setKnownFilesById({});
    setSelectedCategory(null);
    setNeedsAuth(true);
    setBannerNotice('Signed out from Google Drive.');
  };

  const handleNamingStyleChange = (nextStyle: NamingStyle) => {
    setNamingStyle(nextStyle);
    const applyStyle = (f: DriveFileItem): DriveFileItem => {
      if (isFolderItem(f) || !f.proposedName) return f;
      const reformatted = formatFilenamePreview(
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
    };
    setFiles((prev) => prev.map(applyStyle));
    setKnownFilesById((prev) => {
      const next: Record<string, DriveFileItem> = {};
      for (const [id, item] of Object.entries(prev)) {
        next[id] = applyStyle(item);
      }
      return next;
    });
  };

  const handleSelectCategory = useCallback((category: string | null) => {
    setSelectedCategory(category);
  }, []);

  const handleAnalyzeFiles = async (targetFiles: DriveFileItem[]) => {
    const token = requireToken();
    const docTargets = targetFiles.filter((f) => !isFolderItem(f));
    if (!token || docTargets.length === 0) return;

    const targetIds = new Set(docTargets.map((f) => f.id));
    setIsAnalyzingBatch(true);
    setBannerError(null);
    setBannerNotice(null);

    const markAnalyzing = (f: DriveFileItem): DriveFileItem =>
      targetIds.has(f.id) ? { ...f, status: 'analyzing', errorMessage: undefined } : f;

    setFiles((prev) => prev.map(markAnalyzing));
    setKnownFilesById((prev) => {
      const next = { ...prev };
      for (const id of targetIds) {
        if (next[id]) next[id] = markAnalyzing(next[id]);
      }
      return next;
    });

    try {
      const res = await fetch('/api/drive/analyze', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          namingStyle,
          files: docTargets.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType })),
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

      const applyAnalysis = (f: DriveFileItem): DriveFileItem => {
        const item = analysisMap.get(f.id);
        if (!item) return f;
        if (item.error) {
          return {
            ...f,
            status: 'error',
            errorMessage: item.error,
          };
        }
        const nextSelectedFlag = item.proposedName !== f.name;
        if (nextSelectedFlag) {
          persistedSelectedIdsRef.current.add(f.id);
        } else {
          persistedSelectedIdsRef.current.delete(f.id);
        }
        return {
          ...f,
          status: 'ready',
          snippet: item.snippet,
          coreTopic: item.coreTopic,
          category: item.category,
          summary: item.summary,
          keywords: item.keywords,
          confidence: item.confidence,
          confidenceScore: item.confidenceScore,
          proposedName: item.proposedName,
          editedName: item.proposedName,
          selected: nextSelectedFlag,
        };
      };

      setFiles((prev) => prev.map(applyAnalysis));
      setKnownFilesById((prev) => {
        const next = { ...prev };
        for (const id of targetIds) {
          if (next[id]) next[id] = applyAnalysis(next[id]);
        }
        knownFilesRef.current = next;
        return next;
      });
      savePersistedSelectedIds(persistedSelectedIdsRef.current);

      setBannerNotice(
        `Analyzed ${docTargets.length} ${docTargets.length === 1 ? 'document' : 'documents'} and generated topic-based filenames.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to analyze file contents.';
      setBannerError(msg);
      const markError = (f: DriveFileItem): DriveFileItem =>
        targetIds.has(f.id) && f.status === 'analyzing'
          ? { ...f, status: 'error', errorMessage: msg }
          : f;
      setFiles((prev) => prev.map(markError));
      setKnownFilesById((prev) => {
        const next = { ...prev };
        for (const id of targetIds) {
          if (next[id]) next[id] = markError(next[id]);
        }
        return next;
      });
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
        `Created ${data.files?.length || 0} sample documents across nested folders in your Google Drive.`
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
      setBannerNotice(
        `Uploaded ${uploadedCount} ${uploadedCount === 1 ? 'file' : 'files'} to Google Drive.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'File upload failed.';
      setBannerError(msg);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleOpenPicker = () => {
    const token = requireToken();
    if (!token) return;
    setBannerError(null);
    setIsDrivePickerOpen(true);
  };

  const handleLaunchGooglePicker = async () => {
    const token = requireToken();
    if (!token) return;

    setBannerError(null);
    try {
      const result = await openGoogleDrivePicker(token);
      if (result.picked) {
        for (const doc of result.docs) {
          if (doc.mimeType !== FOLDER_MIME_TYPE && !isExcludedExtensionName(doc.name)) {
            persistedSelectedIdsRef.current.add(doc.id);
          }
        }
        savePersistedSelectedIds(persistedSelectedIdsRef.current);
        await loadDriveFiles(token);
        setBannerNotice(
          `Authorized ${result.docs.length} ${result.docs.length === 1 ? 'file' : 'files'} from Google Drive.`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Drive Picker is unavailable.';
      setBannerError(
        `${msg} You can upload local text files or create sample Drive files directly below.`
      );
    }
  };

  const handleApplyPickerSelection = (selectedIds: Set<string>) => {
    persistedSelectedIdsRef.current = new Set(selectedIds);
    savePersistedSelectedIds(persistedSelectedIdsRef.current);

    setFiles((prev) =>
      prev.map((f) => ({ ...f, selected: selectedIds.has(f.id) }))
    );
    setKnownFilesById((prev) => {
      const next: Record<string, DriveFileItem> = {};
      for (const [id, item] of Object.entries(prev)) {
        next[id] = { ...item, selected: selectedIds.has(id) };
      }
      knownFilesRef.current = next;
      return next;
    });
  };

  // Trigger confirmation modal for single file rename
  const requestSingleRename = (file: DriveFileItem) => {
    if (isFolderItem(file)) return;
    const rawTarget = (file.editedName ?? file.proposedName ?? '').trim();
    if (!rawTarget) return;
    const formattedTarget = formatFilenamePreview(rawTarget, file.name, file.mimeType, namingStyle);
    if (!formattedTarget || formattedTarget === file.name) return;
    setPendingRenameTargets([
      {
        fileId: file.id,
        originalName: file.name,
        newName: formattedTarget,
        coreTopic: file.coreTopic || 'Topic Rename',
        mode: 'rename',
      },
    ]);
  };

  // Trigger confirmation modal for batch rename
  const requestBatchRename = () => {
    const candidates = documentFiles.filter((f) => {
      if (!f.selected) return false;
      if (f.status !== 'ready' && f.status !== 'renamed') return false;
      const rawTarget = (f.editedName ?? f.proposedName ?? '').trim();
      if (!rawTarget) return false;
      const formattedTarget = formatFilenamePreview(
        rawTarget,
        f.name,
        f.mimeType,
        namingStyle
      );
      return formattedTarget.length > 0 && formattedTarget !== f.name;
    });

    if (candidates.length === 0) return;

    setPendingRenameTargets(
      candidates.map((f) => {
        const rawTarget = (f.editedName ?? f.proposedName ?? f.name).trim();
        return {
          fileId: f.id,
          originalName: f.name,
          newName: formatFilenamePreview(rawTarget, f.name, f.mimeType, namingStyle),
          coreTopic: f.coreTopic || 'Topic Rename',
          mode: 'rename',
        };
      })
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
    const markRenaming = (f: DriveFileItem): DriveFileItem =>
      targetIds.has(f.id) ? { ...f, status: 'renaming' } : f;

    setFiles((prev) => prev.map(markRenaming));
    setKnownFilesById((prev) => {
      const next = { ...prev };
      for (const id of targetIds) {
        if (next[id]) next[id] = markRenaming(next[id]);
      }
      return next;
    });

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

        persistedSelectedIdsRef.current.delete(target.fileId);
        savePersistedSelectedIds(persistedSelectedIdsRef.current);

        const applyRenameSuccess = (f: DriveFileItem): DriveFileItem =>
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
            : f;

        setFiles((prev) => prev.map(applyRenameSuccess));
        setKnownFilesById((prev) => {
          if (!prev[target.fileId]) return prev;
          const next = { ...prev, [target.fileId]: applyRenameSuccess(prev[target.fileId]) };
          knownFilesRef.current = next;
          return next;
        });

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
        const applyError = (f: DriveFileItem): DriveFileItem =>
          f.id === target.fileId ? { ...f, status: 'error', errorMessage: msg } : f;
        setFiles((prev) => prev.map(applyError));
        setKnownFilesById((prev) =>
          prev[target.fileId]
            ? { ...prev, [target.fileId]: applyError(prev[target.fileId]) }
            : prev
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
    setKnownFilesById((prev) =>
      prev[fileId] ? { ...prev, [fileId]: { ...prev[fileId], editedName: nextName } } : prev
    );
  };

  const toggleSelectFile = (fileId: string) => {
    const targetItem = files.find((f) => f.id === fileId) ?? knownFilesRef.current[fileId];
    if (!targetItem || isFolderItem(targetItem)) return;
    const nextSelected = !targetItem.selected;
    if (nextSelected) {
      persistedSelectedIdsRef.current.add(fileId);
    } else {
      persistedSelectedIdsRef.current.delete(fileId);
    }
    savePersistedSelectedIds(persistedSelectedIdsRef.current);

    setFiles((prev) =>
      prev.map((f) => (f.id === fileId && !isFolderItem(f) ? { ...f, selected: nextSelected } : f))
    );
    setKnownFilesById((prev) => {
      if (!prev[fileId] || isFolderItem(prev[fileId])) return prev;
      const next = { ...prev, [fileId]: { ...prev[fileId], selected: nextSelected } };
      knownFilesRef.current = next;
      return next;
    });
  };

  const documentFiles = useMemo(() => files.filter((f) => !isFolderItem(f)), [files]);

  const allKnownDocumentFiles = useMemo(
    () => Object.values(knownFilesById).filter((f) => !isFolderItem(f)),
    [knownFilesById]
  );

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return documentFiles
      .filter((f) => {
        if (selectedCategory !== null) {
          const itemCategory = (f.category || f.coreTopic || '').trim();
          if (itemCategory !== selectedCategory) return false;
        }

        if (statusFilter !== 'all') {
          if (statusFilter === 'unscanned' && f.status !== 'unscanned') return false;
          if (statusFilter === 'ready' && f.status !== 'ready') return false;
          if (statusFilter === 'renamed' && f.status !== 'renamed') return false;
        }

        if (!q) return true;
        return (
          f.name.toLowerCase().includes(q) ||
          (f.coreTopic || '').toLowerCase().includes(q) ||
          (f.category || '').toLowerCase().includes(q) ||
          (f.editedName || f.proposedName || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const aTime = Date.parse(a.createdTime || a.modifiedTime || '') || 0;
        const bTime = Date.parse(b.createdTime || b.modifiedTime || '') || 0;
        if (aTime !== bTime) return aTime - bTime;
        return a.name.localeCompare(b.name);
      });
  }, [documentFiles, searchQuery, selectedCategory, statusFilter]);

  const selectableVisibleDocs = filteredFiles;

  const selectedVisibleDocsCount = useMemo(
    () => selectableVisibleDocs.filter((f) => Boolean(f.selected)).length,
    [selectableVisibleDocs]
  );

  const allVisibleSelected =
    selectableVisibleDocs.length > 0 &&
    selectedVisibleDocsCount === selectableVisibleDocs.length;

  const toggleSelectAllVisible = () => {
    const visibleDocIds = new Set(selectableVisibleDocs.map((f) => f.id));
    if (visibleDocIds.size === 0) return;
    const nextSelected = !allVisibleSelected;
    for (const id of visibleDocIds) {
      if (nextSelected) {
        persistedSelectedIdsRef.current.add(id);
      } else {
        persistedSelectedIdsRef.current.delete(id);
      }
    }
    savePersistedSelectedIds(persistedSelectedIdsRef.current);

    setFiles((prev) =>
      prev.map((f) => (visibleDocIds.has(f.id) ? { ...f, selected: nextSelected } : f))
    );
    setKnownFilesById((prev) => {
      const next = { ...prev };
      for (const id of visibleDocIds) {
        if (next[id]) next[id] = { ...next[id], selected: nextSelected };
      }
      knownFilesRef.current = next;
      return next;
    });
  };

  const selectAllDocumentsInScope = useCallback(() => {
    const docIds = new Set(selectableVisibleDocs.map((f) => f.id));
    if (docIds.size === 0) return;
    for (const id of docIds) {
      persistedSelectedIdsRef.current.add(id);
    }
    savePersistedSelectedIds(persistedSelectedIdsRef.current);

    setFiles((prev) =>
      prev.map((f) => (docIds.has(f.id) ? { ...f, selected: true } : f))
    );
    setKnownFilesById((prev) => {
      const next = { ...prev };
      for (const id of docIds) {
        if (next[id]) next[id] = { ...next[id], selected: true };
      }
      knownFilesRef.current = next;
      return next;
    });
  }, [selectableVisibleDocs]);

  const stats = useMemo(() => {
    const total = documentFiles.length;
    const analyzed = documentFiles.filter(
      (f) => f.status === 'ready' || f.status === 'renamed'
    ).length;
    const pendingRenames = documentFiles.filter((f) => {
      const rawTarget = (f.editedName ?? f.proposedName ?? '').trim();
      if (!rawTarget) return false;
      const target = formatFilenamePreview(rawTarget, f.name, f.mimeType, namingStyle);
      return (f.status === 'ready' || f.status === 'renamed') && target !== f.name;
    }).length;
    const completedRenames = auditEntries.filter(
      (e) => e.action === 'rename' && e.status === 'success'
    ).length;
    const selectedReadyForRename = documentFiles.filter((f) => {
      if (!f.selected) return false;
      const rawTarget = (f.editedName ?? f.proposedName ?? '').trim();
      if (!rawTarget) return false;
      const target = formatFilenamePreview(rawTarget, f.name, f.mimeType, namingStyle);
      return (f.status === 'ready' || f.status === 'renamed') && target !== f.name;
    }).length;
    const selectedForAnalysis = documentFiles.filter((f) => f.selected).length;
    return {
      total,
      analyzed,
      pendingRenames,
      completedRenames,
      selectedReadyForRename,
      selectedForAnalysis,
    };
  }, [documentFiles, auditEntries, namingStyle]);

  const selectedFiles = useMemo(
    () => documentFiles.filter((f) => Boolean(f.selected)),
    [documentFiles]
  );

  const selectedUnanalyzedFiles = useMemo(
    () =>
      selectedFiles.filter(
        (f) => f.status === 'unscanned' || f.status === 'error'
      ),
    [selectedFiles]
  );

  const clearAllSelection = useCallback(() => {
    persistedSelectedIdsRef.current.clear();
    savePersistedSelectedIds(persistedSelectedIdsRef.current);

    setFiles((prev) => prev.map((f) => (f.selected ? { ...f, selected: false } : f)));
    setKnownFilesById((prev) => {
      const next: Record<string, DriveFileItem> = {};
      for (const [id, item] of Object.entries(prev)) {
        next[id] = item.selected ? { ...item, selected: false } : item;
      }
      knownFilesRef.current = next;
      return next;
    });
  }, []);

  const inspectedFile = useMemo(
    () =>
      files.find((f) => f.id === inspectedFileId) ??
      (inspectedFileId ? knownFilesById[inspectedFileId] ?? null : null),
    [files, inspectedFileId, knownFilesById]
  );

  // Global keyboard shortcuts: Escape -> close modal, Ctrl+Enter -> Batch Rename, Ctrl+A -> Select all visible files
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && pendingRenameTargets.length > 0 && !isExecutingRename) {
        event.preventDefault();
        setPendingRenameTargets([]);
        return;
      }

      if (
        activeTab !== 'workspace' ||
        needsAuth ||
        inspectedFileId !== null ||
        isDrivePickerOpen ||
        pendingRenameTargets.length > 0
      ) {
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inputType = tag === 'input' ? (target as HTMLInputElement).type : '';
      const isTextInput =
        (tag === 'input' && inputType !== 'checkbox' && inputType !== 'button' && inputType !== 'submit') ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(target?.isContentEditable);

      if (event.key.toLowerCase() === 'a') {
        if (isTextInput) return;
        if (selectableVisibleDocs.length === 0) return;
        event.preventDefault();
        selectAllDocumentsInScope();
        return;
      }

      if (event.key === 'Enter') {
        if (tag === 'textarea') return;
        if (stats.selectedReadyForRename === 0 || isExecutingRename) return;
        event.preventDefault();
        requestBatchRename();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeTab,
    needsAuth,
    inspectedFileId,
    isDrivePickerOpen,
    pendingRenameTargets.length,
    selectableVisibleDocs.length,
    selectAllDocumentsInScope,
    stats.selectedReadyForRename,
    isExecutingRename,
    documentFiles,
    namingStyle,
  ]);

  return (
    <div className="min-h-screen w-full overflow-x-clip bg-slate-50 text-slate-900">
      {/* Top Bar Contract: Compact sticky bar (< 15% mobile height) */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:gap-8 sm:px-6 sm:py-3.5">
          {/* Zone 1: Single-line brand wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('workspace')}
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600 sm:text-lg"
          >
            DriveTopic
          </button>

          {/* Zone 2: Clean single-line text navigation links (desktop/tablet) */}
          <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
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
          <div className="flex min-w-0 items-center shrink-0">
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
                className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 sm:h-9 sm:px-3.5"
              >
                <LogOut className="h-4 w-4 text-slate-500" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Navigation Bar (non-sticky to preserve mobile viewport space) */}
      <nav
        aria-label="Mobile navigation"
        className="grid grid-cols-3 border-b border-slate-200 bg-white md:hidden"
      >
        <button
          type="button"
          onClick={() => setActiveTab('workspace')}
          className={`min-h-[44px] border-b-2 px-2 text-xs font-medium transition-colors whitespace-nowrap ${
            activeTab === 'workspace'
              ? 'border-blue-600 text-slate-900'
              : 'border-transparent text-slate-600'
          }`}
        >
          Workspace
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`min-h-[44px] border-b-2 px-2 text-xs font-medium transition-colors whitespace-nowrap tabular-nums ${
            activeTab === 'audit'
              ? 'border-blue-600 text-slate-900'
              : 'border-transparent text-slate-600'
          }`}
        >
          Audit ({auditEntries.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('guide')}
          className={`min-h-[44px] border-b-2 px-2 text-xs font-medium transition-colors whitespace-nowrap ${
            activeTab === 'guide'
              ? 'border-blue-600 text-slate-900'
              : 'border-transparent text-slate-600'
          }`}
        >
          How It Works
        </button>
      </nav>

      <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
        {/* Notifications */}
        {bannerError && (
          <div
            role="alert"
            className="mb-5 flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div className="flex min-w-0 items-start gap-2.5 sm:items-center">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 sm:mt-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{bannerError}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerError(null)}
              className="self-end text-xs font-medium text-red-700 hover:underline whitespace-nowrap shrink-0 sm:self-auto"
            >
              Dismiss
            </button>
          </div>
        )}

        {bannerNotice && (
          <div
            role="status"
            className="mb-5 flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div className="flex min-w-0 items-start gap-2.5 sm:items-center">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 sm:mt-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{bannerNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerNotice(null)}
              className="self-end text-xs font-medium text-emerald-800 hover:underline whitespace-nowrap shrink-0 sm:self-auto"
            >
              Dismiss
            </button>
          </div>
        )}

        {activeTab === 'guide' ? (
          <section className="rounded-lg border border-slate-200 bg-white p-5 sm:p-8">
            <div className="max-w-3xl">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                Automated Topic-Based Google Drive Renaming
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                DriveTopic connects to your Google Drive with scoped file permissions, inspects
                document text snippets to identify each file&apos;s core subject, and proposes clean
                standardized filenames for your explicit approval.
              </p>

              <div className="mt-6 grid gap-6 border-t border-slate-200 pt-6 sm:mt-8 sm:grid-cols-3 sm:pt-8">
                <div className="min-w-0">
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

                <div className="min-w-0">
                  <div className="font-mono text-xs font-medium text-slate-500">02. Analyze</div>
                  <h2 className="mt-1 text-base font-semibold text-slate-900">
                    Content Topic Extraction
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                    Reads Google Docs, Markdown, Plain Text, and CSV snippets to summarize content
                    and draft clean filenames while preserving file extensions.
                  </p>
                </div>

                <div className="min-w-0">
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
          <section className="rounded-lg border border-slate-200 bg-white p-5 sm:p-8 lg:p-12">
            <div className="grid items-center gap-8 lg:grid-cols-12 lg:gap-10">
              <div className="min-w-0 lg:col-span-7">
                <p className="text-xs font-medium text-slate-500">
                  Google Drive Document Intelligence · Scoped Permission
                </p>
                <h1 className="mt-2 max-w-2xl text-2xl font-bold tracking-tight text-slate-900 sm:text-4xl [text-wrap:balance]">
                  Turn cryptic Drive filenames into clear, content-accurate titles.
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-600 sm:mt-4 sm:text-base">
                  Connect your Google Drive to extract document snippets, determine each file&apos;s
                  core topic, and apply standardized renames in a single audited workflow.
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-4 sm:mt-7">
                  <GoogleSignInButton
                    onClick={handleSignIn}
                    disabled={isLoggingIn}
                    label={isLoggingIn ? 'Connecting Google Drive...' : 'Sign in with Google'}
                  />
                  <button
                    type="button"
                    onClick={() => setActiveTab('guide')}
                    className="min-h-[40px] text-sm font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
                  >
                    Read architecture overview
                  </button>
                </div>
              </div>

              <div className="min-w-0 lg:col-span-5">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 sm:p-5">
                  <div className="border-b border-slate-200 pb-3 text-xs font-semibold text-slate-700">
                    Example Transformation Preview
                  </div>
                  <div className="divide-y divide-slate-200">
                    <div className="py-3">
                      <div className="break-words font-mono text-xs text-slate-500">
                        untitled_export_04.txt
                      </div>
                      <div className="mt-1 break-words text-sm font-semibold text-slate-900">
                        Q4 Cloud Infrastructure Cost Audit.txt
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        Cloud Cost Audit · Plain Text · 1.2 KB
                      </div>
                    </div>
                    <div className="py-3">
                      <div className="break-words font-mono text-xs text-slate-500">
                        raw_meeting_dump_v2
                      </div>
                      <div className="mt-1 break-words text-sm font-semibold text-slate-900">
                        Engineering Onboarding First 30 Days Guide
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        Employee Onboarding · Google Doc
                      </div>
                    </div>
                    <div className="pt-3">
                      <div className="break-words font-mono text-xs text-slate-500">
                        notes_temp_991.md
                      </div>
                      <div className="mt-1 break-words text-sm font-semibold text-slate-900">
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
          <div className="space-y-5 sm:space-y-6">
            {/* Workspace Header & KPI Summary Row */}
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4 sm:px-6 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                    Drive Document Renamer
                  </h1>
                  <p className="mt-0.5 break-words text-xs text-slate-600 sm:text-sm">
                    Signed in as{' '}
                    <span className="break-all font-medium text-slate-900">
                      {user?.email || user?.displayName || 'Google Drive User'}
                    </span>{' '}
                    · Scoped to app-authorized Drive files
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2.5">
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
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap sm:h-9 sm:text-sm"
                  >
                    {isUploading ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                    ) : (
                      <Upload className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                    )}
                    <span className="truncate">{isUploading ? 'Uploading...' : 'Upload to Drive'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenPicker}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap sm:h-9 sm:text-sm"
                  >
                    <FolderOpen className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                    <span className="truncate">Select from Drive</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSeedSamples}
                    disabled={isSeeding}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap sm:h-9 sm:text-sm"
                  >
                    {isSeeding ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                    ) : (
                      <FilePlus2 className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                    )}
                    <span className="truncate">{isSeeding ? 'Creating...' : 'Sample Files'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void loadDriveFiles()}
                    disabled={isLoadingFiles}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap sm:h-9 sm:text-sm"
                  >
                    <RefreshCw
                      className={`h-4 w-4 shrink-0 text-slate-500 ${isLoadingFiles ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {/* 4-Column Tabular Metrics Strip with clean hairline grid */}
              <div className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-4">
                <div className="bg-white px-4 py-3.5 sm:px-6 sm:py-4">
                  <div className="text-xs font-medium text-slate-500">Files Indexed</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums sm:text-2xl">
                    {stats.total}
                  </div>
                </div>
                <div className="bg-white px-4 py-3.5 sm:px-6 sm:py-4">
                  <div className="text-xs font-medium text-slate-500">Topics Extracted</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums sm:text-2xl">
                    {stats.analyzed}
                  </div>
                </div>
                <div className="bg-white px-4 py-3.5 sm:px-6 sm:py-4">
                  <div className="text-xs font-medium text-slate-500">Ready to Rename</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-blue-600 tabular-nums sm:text-2xl">
                    {stats.pendingRenames}
                  </div>
                </div>
                <div className="bg-white px-4 py-3.5 sm:px-6 sm:py-4">
                  <div className="text-xs font-medium text-slate-500">Completed Renames</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-emerald-700 tabular-nums sm:text-2xl">
                    {stats.completedRenames}
                  </div>
                </div>
              </div>
            </section>

            {/* D3.js Topic Summary Category Distribution */}
            <TopicSummaryChart
              files={allKnownDocumentFiles}
              selectedCategory={selectedCategory}
              onSelectCategory={handleSelectCategory}
            />

            {/* Persistent Selection Overview Card (visible when 1+ files selected) */}
            <SelectionOverviewCard
              selectedFiles={selectedFiles}
              totalFilesCount={documentFiles.length}
              namingStyle={namingStyle}
              isAnalyzing={isAnalyzingBatch}
              isExecutingRename={isExecutingRename}
              onAnalyzeSelected={() => void handleAnalyzeFiles(selectedFiles)}
              onBatchRename={requestBatchRename}
              onClearSelection={clearAllSelection}
            />

            {/* Workspace Toolbar & File List */}
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:gap-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="relative w-full sm:w-56">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search files or topics..."
                      className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none sm:h-9"
                    />
                  </div>

                  <div className="grid grid-cols-4 gap-1 rounded-md border border-slate-200 bg-slate-100 p-1 sm:flex sm:items-center">
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
                        className={`rounded px-2 py-1.5 text-center text-xs font-medium transition-colors whitespace-nowrap sm:px-2.5 sm:py-1 ${
                          statusFilter === tab.id
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-2 sm:justify-start">
                    <label htmlFor="naming-style-select" className="text-xs font-medium text-slate-500">
                      Format
                    </label>
                    <select
                      id="naming-style-select"
                      value={namingStyle}
                      onChange={(e) => handleNamingStyleChange(e.target.value as NamingStyle)}
                      className="h-10 flex-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-800 focus:border-blue-600 focus:outline-none sm:h-9 sm:flex-none"
                    >
                      <option value="title-case">Title Case</option>
                      <option value="kebab-case">kebab-case</option>
                      <option value="snake_case">snake_case</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
                  <button
                    type="button"
                    disabled={isAnalyzingBatch || documentFiles.length === 0}
                    onClick={() => {
                      const targets =
                        stats.selectedForAnalysis > 0 ? selectedFiles : documentFiles;
                      void handleAnalyzeFiles(targets);
                    }}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap sm:h-9 sm:px-3.5 sm:text-sm"
                  >
                    {isAnalyzingBatch ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" aria-hidden="true" />
                    ) : (
                      <Sparkles className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
                    )}
                    <span className="truncate">
                      {isAnalyzingBatch
                        ? 'Analyzing...'
                        : stats.selectedForAnalysis > 0 && stats.selectedForAnalysis < documentFiles.length
                          ? `Analyze (${stats.selectedForAnalysis})`
                          : 'Analyze All'}
                    </span>
                  </button>

                  {selectedUnanalyzedFiles.length > 0 && (
                    <button
                      type="button"
                      disabled={isAnalyzingBatch}
                      onClick={() => void handleAnalyzeFiles(selectedUnanalyzedFiles)}
                      title={`Analyze ${selectedUnanalyzedFiles.length} unanalyzed file(s) in current selection`}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap sm:h-9 sm:px-3.5 sm:text-sm"
                    >
                      <Sparkles className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
                      <span className="truncate">
                        Analyze Unanalyzed ({selectedUnanalyzedFiles.length})
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={stats.selectedReadyForRename === 0 || isExecutingRename}
                    onClick={requestBatchRename}
                    title="Trigger Batch Rename for selected ready files (Ctrl+Enter)"
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap sm:h-9 sm:px-4 sm:text-sm"
                  >
                    <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      Batch Rename
                      {stats.selectedReadyForRename > 0
                        ? ` (${stats.selectedReadyForRename})`
                        : ''}
                    </span>
                  </button>
                </div>
              </div>

              {/* Flattened All-Files Batch Bar (folders omitted, earliest-to-latest creation sort) */}
              <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <span className="text-xs text-slate-600 tabular-nums">
                  Showing {selectableVisibleDocs.length}{' '}
                  {selectableVisibleDocs.length === 1 ? 'file' : 'files'} across all folders and subfolders
                  {selectedCategory ? ` in "${selectedCategory}"` : ''} · Sorted earliest → latest created
                </span>

                <div className="flex flex-wrap items-center gap-2">
                  {selectableVisibleDocs.length > 0 && (
                    <button
                      type="button"
                      onClick={
                        allVisibleSelected ? clearAllSelection : selectAllDocumentsInScope
                      }
                      title="Select all visible files (Ctrl+A)"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                    >
                      <span>
                        {allVisibleSelected
                          ? 'Deselect All'
                          : `Select All Files (${selectableVisibleDocs.length})`}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {/* Loading Skeleton */}
              {isLoadingFiles && files.length === 0 ? (
                <div className="divide-y divide-slate-200">
                  {[1, 2, 3, 4].map((row) => (
                    <div key={row} className="grid grid-cols-12 items-center gap-4 px-4 py-4 sm:px-6">
                      <div className="col-span-6 h-4 animate-pulse rounded bg-slate-200 sm:col-span-4" />
                      <div className="col-span-6 h-4 animate-pulse rounded bg-slate-200 sm:col-span-3" />
                      <div className="hidden h-4 animate-pulse rounded bg-slate-200 sm:col-span-3 sm:block" />
                      <div className="hidden h-4 animate-pulse rounded bg-slate-200 sm:col-span-2 sm:block" />
                    </div>
                  ))}
                </div>
              ) : documentFiles.length === 0 ? (
                /* Empty State */
                <div className="px-4 py-12 text-center sm:px-6 sm:py-16">
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
                  <div className="mt-6 flex flex-col items-stretch justify-center gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                    <button
                      type="button"
                      onClick={handleSeedSamples}
                      disabled={isSeeding}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap sm:h-10"
                    >
                      <FilePlus2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{isSeeding ? 'Creating Sample Files...' : 'Create Sample Files in Drive'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap sm:h-10"
                    >
                      <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>Upload Text or Markdown</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenPicker}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap sm:h-10"
                    >
                      <FolderOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>Select from Drive</span>
                    </button>
                  </div>
                </div>
              ) : filteredFiles.length === 0 ? (
                <div className="px-4 py-12 text-center sm:px-6">
                  <p className="text-sm font-medium text-slate-900">No files match your current filter</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setStatusFilter('all');
                      setSelectedCategory(null);
                    }}
                    className="mt-2 min-h-[40px] text-sm font-medium text-blue-600 hover:underline"
                  >
                    Reset filters
                  </button>
                </div>
              ) : (
                <>
                  {/* Mobile & Tablet Stacked Card-Row List (Zero Horizontal Overflow) */}
                  <div className="lg:hidden">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600">
                      <TriStateCheckbox
                        totalCount={selectableVisibleDocs.length}
                        selectedCount={selectedVisibleDocsCount}
                        onToggle={toggleSelectAllVisible}
                        showStateText
                        ariaLabel="Select all visible documents"
                      />
                      <span className="tabular-nums text-slate-500">
                        {selectedVisibleDocsCount} of {selectableVisibleDocs.length} selected
                      </span>
                    </div>

                    <div className="divide-y divide-slate-200">
                      {filteredFiles.map((file) => {
                        const proposedValue = file.editedName ?? file.proposedName ?? '';
                        const formattedProposed = proposedValue.trim()
                          ? formatFilenamePreview(proposedValue, file.name, file.mimeType, namingStyle)
                          : '';
                        const hasProposedChange =
                          (file.status === 'ready' || file.status === 'renamed') &&
                          formattedProposed.length > 0 &&
                          formattedProposed !== file.name;

                        return (
                          <div key={file.id} className="space-y-3 px-4 py-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 flex-1 items-start gap-3">
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${file.name}`}
                                  checked={Boolean(file.selected)}
                                  onChange={() => toggleSelectFile(file.id)}
                                  className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 accent-blue-600 focus:ring-blue-600"
                                />
                                <div className="min-w-0 flex-1">
                                  <button
                                    type="button"
                                    onClick={() => setInspectedFileId(file.id)}
                                    className="block w-full break-words text-left text-sm font-semibold text-slate-900 hover:text-blue-600"
                                  >
                                    {file.name}
                                  </button>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 tabular-nums">
                                    <span>{friendlyMimeLabel(file.mimeType)}</span>
                                    <span aria-hidden="true">·</span>
                                    <span>
                                      Created {formatShortDate(file.createdTime || file.modifiedTime)}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="shrink-0 pt-0.5">
                                {file.status === 'unscanned' && (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                                    <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                    <span>Unscanned</span>
                                  </span>
                                )}
                                {file.status === 'analyzing' && (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600">
                                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                                    <span>Analyzing</span>
                                  </span>
                                )}
                                {file.status === 'ready' && (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                                    <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                    <span>{hasProposedChange ? 'Ready' : 'No Change'}</span>
                                  </span>
                                )}
                                {file.status === 'renaming' && (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600">
                                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                                    <span>Renaming</span>
                                  </span>
                                )}
                                {file.status === 'renamed' && (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                    <span>Renamed</span>
                                  </span>
                                )}
                                {file.status === 'error' && (
                                  <span
                                    className="inline-flex items-center gap-1 text-xs font-medium text-red-700"
                                    title={file.errorMessage}
                                  >
                                    <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                    <span>Error</span>
                                  </span>
                                )}
                              </div>
                            </div>

                            {file.coreTopic && (
                              <div className="pl-7">
                                <div className="text-xs font-semibold text-slate-900">
                                  {file.coreTopic}
                                  {file.category && file.category !== file.coreTopic && (
                                    <span className="ml-1.5 font-normal text-slate-500">
                                      · {file.category}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-600">
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
                            )}

                            {(file.status === 'ready' || file.status === 'renamed') && (
                              <div className="pl-7">
                                <div className="flex items-center justify-between gap-2">
                                  <label
                                    htmlFor={`mobile-proposed-${file.id}`}
                                    className="block text-xs font-medium text-slate-500"
                                  >
                                    Proposed Filename
                                  </label>
                                  <ConfidenceBadge
                                    confidenceScore={file.confidenceScore}
                                    confidence={file.confidence}
                                  />
                                </div>
                                <ProposedFilenameInput
                                  id={`mobile-proposed-${file.id}`}
                                  ariaLabel={`Proposed filename for ${file.name}`}
                                  value={proposedValue}
                                  originalName={file.name}
                                  mimeType={file.mimeType}
                                  namingStyle={namingStyle}
                                  onChange={(next) => updateEditedName(file.id, next)}
                                  className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
                                />
                              </div>
                            )}

                            <div className="flex items-center justify-between gap-2 pl-7">
                              <div className="flex items-center gap-2">
                                {file.status === 'unscanned' || file.status === 'error' ? (
                                  <button
                                    type="button"
                                    disabled={isAnalyzingBatch}
                                    onClick={() => void handleAnalyzeFiles([file])}
                                    className="inline-flex h-10 items-center rounded-md border border-slate-300 bg-white px-3.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                  >
                                    Analyze
                                  </button>
                                ) : hasProposedChange ? (
                                  <button
                                    type="button"
                                    disabled={isExecutingRename}
                                    onClick={() => requestSingleRename(file)}
                                    className="inline-flex h-10 items-center rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                  >
                                    Rename File
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={isAnalyzingBatch}
                                    onClick={() => void handleAnalyzeFiles([file])}
                                    className="inline-flex h-10 items-center rounded-md border border-slate-300 bg-white px-3.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                  >
                                    Re-analyze
                                  </button>
                                )}
                              </div>

                              {file.webViewLink && (
                                <a
                                  href={file.webViewLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex h-10 items-center gap-1 px-2 text-xs font-medium text-slate-600 hover:text-slate-900"
                                >
                                  <span>Drive</span>
                                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Desktop High-Density File Table */}
                  <div className="hidden overflow-x-auto lg:block">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                          <th className="w-12 px-5 py-2.5">
                            <TriStateCheckbox
                              totalCount={selectableVisibleDocs.length}
                              selectedCount={selectedVisibleDocsCount}
                              onToggle={toggleSelectAllVisible}
                              ariaLabel="Select all visible documents"
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
                          const formattedProposed = proposedValue.trim()
                            ? formatFilenamePreview(proposedValue, file.name, file.mimeType, namingStyle)
                            : '';
                          const hasProposedChange =
                            (file.status === 'ready' || file.status === 'renamed') &&
                            formattedProposed.length > 0 &&
                            formattedProposed !== file.name;

                          return (
                            <tr key={file.id} className="align-top hover:bg-slate-50/70">
                              <td className="px-6 py-4">
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${file.name}`}
                                  checked={Boolean(file.selected)}
                                  onChange={() => toggleSelectFile(file.id)}
                                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 accent-blue-600 focus:ring-blue-600"
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
                                  <span>
                                    Created {formatShortDate(file.createdTime || file.modifiedTime)}
                                  </span>
                                </div>
                              </td>

                              <td className="max-w-[280px] px-4 py-3.5">
                                {file.coreTopic ? (
                                  <div>
                                    <div className="text-xs font-semibold text-slate-900">
                                      {file.coreTopic}
                                      {file.category && file.category !== file.coreTopic && (
                                        <span className="ml-1.5 font-normal text-slate-500">
                                          · {file.category}
                                        </span>
                                      )}
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

                              <td className="min-w-[300px] px-4 py-3.5">
                                {file.status === 'ready' || file.status === 'renamed' ? (
                                  <div className="flex items-center gap-2">
                                    <ProposedFilenameInput
                                      ariaLabel={`Proposed filename for ${file.name}`}
                                      value={proposedValue}
                                      originalName={file.name}
                                      mimeType={file.mimeType}
                                      namingStyle={namingStyle}
                                      onChange={(next) => updateEditedName(file.id, next)}
                                      className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
                                    />
                                    <ConfidenceBadge
                                      confidenceScore={file.confidenceScore}
                                      confidence={file.confidence}
                                    />
                                  </div>
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
                </>
              )}
            </section>
          </div>
        )}
      </main>

      <SnippetDrawer
        file={inspectedFile}
        namingStyle={namingStyle}
        onClose={() => setInspectedFileId(null)}
        onUpdateProposedName={updateEditedName}
        onRequestRename={(file) => {
          setInspectedFileId(null);
          requestSingleRename(file);
        }}
      />

      <DrivePickerModal
        isOpen={isDrivePickerOpen}
        files={documentFiles}
        isLoading={isLoadingFiles}
        onRefresh={() => loadDriveFiles()}
        onLaunchExternalPicker={handleLaunchGooglePicker}
        onApplySelection={handleApplyPickerSelection}
        onClose={() => setIsDrivePickerOpen(false)}
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
