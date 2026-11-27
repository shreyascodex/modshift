import type { ModLoader } from '../types/migration';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/**
 * Sanitizes untrusted filenames before rendering or exporting so control characters
 * or HTML-like sequences never cause display issues or unsafe downloads.
 */
export function sanitizeDisplayName(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F<>]/g, '').trim() || 'unnamed.jar';
}

export function formatLoaderName(loader: ModLoader | string): string {
  switch (loader.toLowerCase()) {
    case 'fabric':
      return 'Fabric';
    case 'neoforge':
      return 'NeoForge';
    case 'forge':
      return 'Forge';
    case 'quilt':
      return 'Quilt';
    default:
      return loader;
  }
}

export function formatShortDate(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function isJarFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith('.jar');
}

export function getModrinthProjectUrl(slugOrId: string, projectType = 'mod'): string {
  const segment = projectType === 'modpack' ? 'modpack' : projectType === 'resourcepack' ? 'resourcepack' : 'mod';
  return `https://modrinth.com/${segment}/${encodeURIComponent(slugOrId)}`;
}
