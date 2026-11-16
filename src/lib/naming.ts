import { FOLDER_MIME_TYPE, type NamingStyle } from '../types';

export function getPreservedExtension(originalName: string, mimeType: string): string {
  if (mimeType === 'application/vnd.google-apps.document' || mimeType === FOLDER_MIME_TYPE) {
    return '';
  }
  const extMatch = originalName.match(/(\.[a-zA-Z0-9]{1,8})$/);
  return extMatch ? extMatch[1].toLowerCase() : '';
}

export function formatFilenamePreview(
  rawInput: string,
  originalName: string,
  mimeType: string,
  style: NamingStyle
): string {
  const extension = getPreservedExtension(originalName, mimeType);
  const sanitized = rawInput
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\.[a-zA-Z0-9]{1,8}$/, '')
    .trim();

  const words = sanitized.split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) {
    return `${'Untitled Document'}${extension}`;
  }

  if (style === 'kebab-case') {
    const stem = words
      .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(Boolean)
      .join('-');
    return `${stem || 'untitled-document'}${extension}`;
  }

  if (style === 'snake_case') {
    const stem = words
      .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(Boolean)
      .join('_');
    return `${stem || 'untitled_document'}${extension}`;
  }

  const titled = words
    .map((w) => (/^[A-Z0-9]{2,6}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
  return `${titled}${extension}`;
}

export function namingStyleLabel(style: NamingStyle): string {
  if (style === 'kebab-case') return 'kebab-case';
  if (style === 'snake_case') return 'snake_case';
  return 'Title Case';
}
