import JSZip from 'jszip';
import { BRAND_CONFIG } from '../config/brand';
import type {
  LocalModFile,
  MigrationTargetConfig,
  ModLoader,
  ModMigrationResult,
} from '../types/migration';
import { sanitizeDisplayName } from '../utils/format';

const MAX_MRPACK_BYTES = 150 * 1024 * 1024;
const MAX_INDEX_JSON_BYTES = 10 * 1024 * 1024;

export interface ParsedMrpackOutcome {
  packName: string;
  packVersionId: string;
  detectedMinecraftVersion?: string;
  detectedLoader?: ModLoader;
  files: LocalModFile[];
  skippedCount: number;
}

interface ModrinthIndexFileEntry {
  path?: unknown;
  hashes?: {
    sha1?: unknown;
    sha512?: unknown;
  };
  downloads?: unknown;
  fileSize?: unknown;
}

interface ModrinthIndexJson {
  formatVersion?: unknown;
  name?: unknown;
  versionId?: unknown;
  dependencies?: Record<string, unknown>;
  files?: unknown;
}

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isSafeModArchivePath(rawPath: string): boolean {
  if (!rawPath || rawPath.includes('..') || rawPath.includes('\\') || rawPath.startsWith('/')) {
    return false;
  }
  const lower = rawPath.toLowerCase();
  return lower.startsWith('mods/') && lower.endsWith('.jar');
}

function isValidSha1(hash: unknown): hash is string {
  return typeof hash === 'string' && /^[a-f0-9]{40}$/i.test(hash);
}

function detectLoaderFromDependencies(deps?: Record<string, unknown>): ModLoader | undefined {
  if (!deps) return undefined;
  if (typeof deps['neoforge'] === 'string') return 'neoforge';
  if (typeof deps['fabric-loader'] === 'string') return 'fabric';
  if (typeof deps['quilt-loader'] === 'string') return 'quilt';
  if (typeof deps['forge'] === 'string') return 'forge';
  return undefined;
}

/**
 * Parses a Modrinth .mrpack archive in the browser, extracting pre-hashed mod entries
 * from modrinth.index.json without downloading anything upfront.
 */
export async function parseMrpackArchive(file: File): Promise<ParsedMrpackOutcome> {
  if (!file.name.toLowerCase().endsWith('.mrpack')) {
    throw new Error(`"${file.name}" is not a .mrpack archive.`);
  }
  if (file.size === 0 || file.size > MAX_MRPACK_BYTES) {
    throw new Error(`"${file.name}" exceeds the supported .mrpack size limit.`);
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error(`Could not open "${file.name}" as a valid .mrpack zip archive.`);
  }

  const indexEntry = zip.file('modrinth.index.json');
  if (!indexEntry || indexEntry.dir) {
    throw new Error(`"${file.name}" does not contain a modrinth.index.json manifest.`);
  }

  const rawText = await indexEntry.async('string');
  if (rawText.length > MAX_INDEX_JSON_BYTES) {
    throw new Error('modrinth.index.json is larger than the 10 MB safety limit.');
  }

  let parsed: ModrinthIndexJson;
  try {
    parsed = JSON.parse(rawText) as ModrinthIndexJson;
  } catch {
    throw new Error('modrinth.index.json contains invalid JSON.');
  }

  if (!Array.isArray(parsed.files)) {
    throw new Error('modrinth.index.json has no files array.');
  }

  const packName =
    typeof parsed.name === 'string' && parsed.name.trim()
      ? sanitizeDisplayName(parsed.name)
      : sanitizeDisplayName(file.name.replace(/\.mrpack$/i, ''));
  const packVersionId =
    typeof parsed.versionId === 'string' && parsed.versionId.trim()
      ? parsed.versionId.trim().slice(0, 64)
      : '1.0.0';

  const deps = parsed.dependencies && typeof parsed.dependencies === 'object' ? parsed.dependencies : undefined;
  const detectedMinecraftVersion =
    typeof deps?.minecraft === 'string' && deps.minecraft.trim()
      ? deps.minecraft.trim()
      : undefined;
  const detectedLoader = detectLoaderFromDependencies(deps);

  const files: LocalModFile[] = [];
  const seenSha1 = new Set<string>();
  let skippedCount = 0;

  for (const rawEntry of parsed.files as ModrinthIndexFileEntry[]) {
    const rawPath = typeof rawEntry?.path === 'string' ? rawEntry.path : '';
    const sha1 = isValidSha1(rawEntry?.hashes?.sha1)
      ? rawEntry.hashes!.sha1.toLowerCase()
      : null;

    if (!isSafeModArchivePath(rawPath) || !sha1) {
      skippedCount++;
      continue;
    }

    if (seenSha1.has(sha1)) {
      skippedCount++;
      continue;
    }
    seenSha1.add(sha1);

    const baseName = sanitizeDisplayName(rawPath.split('/').pop() || 'mod.jar');
    const downloads = Array.isArray(rawEntry.downloads)
      ? rawEntry.downloads.filter(
          (u): u is string => typeof u === 'string' && u.startsWith('https://'),
        )
      : [];
    const fileSize =
      typeof rawEntry.fileSize === 'number' && Number.isFinite(rawEntry.fileSize) && rawEntry.fileSize >= 0
        ? rawEntry.fileSize
        : 0;

    const placeholderFile = new File([], baseName, {
      type: 'application/java-archive',
    });

    files.push({
      id: makeId('mrpack'),
      file: placeholderFile,
      name: baseName,
      relativePath: rawPath,
      size: fileSize,
      sha1,
      mrpackDownloadUrl: downloads[0],
      status: 'hashed',
    });
  }

  return {
    packName,
    packVersionId,
    detectedMinecraftVersion,
    detectedLoader,
    files,
    skippedCount,
  };
}

async function resolveLoaderDependency(
  loader: ModLoader,
  gameVersion: string,
): Promise<Record<string, string>> {
  const dependencies: Record<string, string> = {
    minecraft: gameVersion,
  };

  if (loader !== 'fabric' && loader !== 'quilt') {
    return dependencies;
  }

  const endpoint =
    loader === 'fabric'
      ? `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(gameVersion)}`
      : `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(gameVersion)}`;
  const depKey = loader === 'fabric' ? 'fabric-loader' : 'quilt-loader';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) return dependencies;
    const entries = (await res.json()) as Array<{
      loader?: { version?: unknown; stable?: unknown };
    }>;
    if (Array.isArray(entries) && entries.length > 0) {
      const stableEntry =
        entries.find((e) => e?.loader?.stable === true && typeof e.loader.version === 'string') ??
        entries.find((e) => typeof e?.loader?.version === 'string');
      if (typeof stableEntry?.loader?.version === 'string' && stableEntry.loader.version.trim()) {
        dependencies[depKey] = stableEntry.loader.version.trim();
      }
    }
  } catch {
    // Non-blocking fallback: export still succeeds with minecraft dependency
  } finally {
    clearTimeout(timer);
  }

  return dependencies;
}

/**
 * Generates and downloads a Modrinth-compliant .mrpack archive containing all ready
 * migration targets (referencing official Modrinth CDN URLs and hashes).
 */
export async function exportMrpackArchive(
  results: ModMigrationResult[],
  config: MigrationTargetConfig,
  packName?: string,
): Promise<{ exportedCount: number; filename: string }> {
  const readyWithFiles = results.filter(
    (r) =>
      r.category === 'ready' &&
      r.targetFile?.url &&
      r.targetFile.url.startsWith('https://') &&
      r.targetFile.hashes?.sha1,
  );

  if (readyWithFiles.length === 0) {
    throw new Error('No ready Modrinth mods with verified hashes and download URLs are available to export as .mrpack.');
  }

  const seenPaths = new Set<string>();
  const indexFiles = readyWithFiles
    .map((r) => {
      const safeFile = sanitizeDisplayName(r.targetFile!.filename);
      const path = `mods/${safeFile}`;
      if (seenPaths.has(path.toLowerCase())) {
        return null;
      }
      seenPaths.add(path.toLowerCase());

      const hashes: Record<string, string> = {
        sha1: r.targetFile!.hashes.sha1!,
      };
      if (r.targetFile!.hashes.sha512) {
        hashes.sha512 = r.targetFile!.hashes.sha512;
      }

      return {
        path,
        hashes,
        env: {
          client: 'required',
          server: 'required',
        },
        downloads: [r.targetFile!.url],
        fileSize: r.targetFile!.size,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const cleanName = sanitizeDisplayName(
    packName?.trim() || `${BRAND_CONFIG.name} ${config.loader} ${config.gameVersion}`,
  );

  const dependencies = await resolveLoaderDependency(config.loader, config.gameVersion);

  const indexPayload = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: `${config.gameVersion}-${config.loader}`,
    name: cleanName,
    summary: `Migrated with ${BRAND_CONFIG.name} for Minecraft ${config.gameVersion} (${config.loader})`,
    files: indexFiles,
    dependencies,
  };

  const zip = new JSZip();
  zip.file('modrinth.index.json', JSON.stringify(indexPayload, null, 2));
  zip.folder('overrides');

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const archiveName = sanitizeDisplayName(
    `${BRAND_CONFIG.name.toLowerCase()}-${config.loader}-${config.gameVersion}.mrpack`,
  );

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = archiveName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return {
    exportedCount: indexFiles.length,
    filename: archiveName,
  };
}
