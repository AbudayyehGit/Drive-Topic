import type { DriveSortOption } from '../types';

export const DEFAULT_EXCLUDED_EXTENSIONS = ['.js', '.css', '.apsx', '.aspx'] as const;
export const CORE_EXCLUDED_EXTENSIONS = new Set(['.js', '.css']);

export const DRIVE_SORT_OPTIONS: ReadonlyArray<{
  value: DriveSortOption;
  label: string;
}> = [
  { value: 'created-asc', label: 'Created: Oldest → Newest' },
  { value: 'created-desc', label: 'Created: Newest → Oldest' },
  { value: 'modified-desc', label: 'Modified: Newest → Oldest' },
  { value: 'modified-asc', label: 'Modified: Oldest → Newest' },
  { value: 'name-asc', label: 'Filename: A → Z' },
  { value: 'name-desc', label: 'Filename: Z → A' },
];

export function normalizeExtension(raw: string): string | null {
  const cleaned = raw.trim().replace(/^\*+/, '').replace(/^\.+/, '').toLowerCase();
  if (!cleaned || !/^[a-z0-9]{1,12}$/.test(cleaned)) {
    return null;
  }
  return `.${cleaned}`;
}

export function parseExtensionInput(raw: string): string[] {
  const parts = raw
    .split(/[\s,;]+/)
    .map(normalizeExtension)
    .filter((ext): ext is string => ext !== null);
  return Array.from(new Set(parts));
}

export function isExcludedFile(
  fileName: string,
  mimeType: string,
  excludedExtensions: string[]
): boolean {
  const lowerName = fileName.trim().toLowerCase();
  const lowerMime = mimeType.trim().toLowerCase();

  if (
    lowerMime === 'text/css' ||
    lowerMime === 'text/javascript' ||
    lowerMime === 'application/javascript' ||
    lowerMime === 'application/x-javascript'
  ) {
    return true;
  }

  for (const ext of excludedExtensions) {
    const normalized = normalizeExtension(ext);
    if (normalized && lowerName.endsWith(normalized)) {
      return true;
    }
  }
  return false;
}

export function sortDriveFiles<
  T extends { name: string; createdTime?: string; modifiedTime?: string },
>(items: T[], sortOption: DriveSortOption): T[] {
  return [...items].sort((a, b) => {
    if (sortOption === 'created-asc' || sortOption === 'created-desc') {
      const aTime = Date.parse(a.createdTime || a.modifiedTime || '') || 0;
      const bTime = Date.parse(b.createdTime || b.modifiedTime || '') || 0;
      if (aTime !== bTime) {
        return sortOption === 'created-asc' ? aTime - bTime : bTime - aTime;
      }
      return a.name.localeCompare(b.name);
    }

    if (sortOption === 'modified-asc' || sortOption === 'modified-desc') {
      const aTime = Date.parse(a.modifiedTime || a.createdTime || '') || 0;
      const bTime = Date.parse(b.modifiedTime || b.createdTime || '') || 0;
      if (aTime !== bTime) {
        return sortOption === 'modified-asc' ? aTime - bTime : bTime - aTime;
      }
      return a.name.localeCompare(b.name);
    }

    if (sortOption === 'name-desc') {
      return b.name.localeCompare(a.name, undefined, { sensitivity: 'base' });
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}
