export type NamingStyle = 'title-case' | 'kebab-case' | 'snake_case';

export type FileRowStatus =
  | 'unscanned'
  | 'analyzing'
  | 'ready'
  | 'renaming'
  | 'renamed'
  | 'error';

export type AnalysisConfidence = 'high' | 'medium' | 'low';

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  status: FileRowStatus;
  snippet?: string;
  coreTopic?: string;
  summary?: string;
  keywords?: string[];
  confidence?: AnalysisConfidence;
  proposedName?: string;
  editedName?: string;
  errorMessage?: string;
  selected?: boolean;
}

export interface AnalyzeResponseItem {
  fileId: string;
  snippet: string;
  coreTopic: string;
  summary: string;
  proposedName: string;
  confidence: AnalysisConfidence;
  keywords: string[];
  error?: string;
}

export interface RenameAuditEntry {
  id: string;
  timestamp: string;
  fileId: string;
  originalName: string;
  newName: string;
  coreTopic: string;
  action: 'rename' | 'revert' | 'seed' | 'upload';
  status: 'success' | 'failed';
  webViewLink?: string;
  errorMessage?: string;
  reverted?: boolean;
}

export interface RenameTarget {
  fileId: string;
  originalName: string;
  newName: string;
  coreTopic: string;
  mode: 'rename' | 'revert';
  auditEntryId?: string;
}
