import JSZip from 'jszip';
import { BRAND_CONFIG } from '../config/brand';
import type {
  BulkDownloadItem,
  MigrationTargetConfig,
  ModMigrationResult,
  ResolvedDependency,
} from '../types/migration';
import { formatBytes, formatLoaderName, sanitizeDisplayName } from '../utils/format';

/**
 * Triggers a single browser file download directly from the official Modrinth CDN URL
 * without rehosting or proxying the JAR file.
 */
export function triggerDirectDownload(url: string, filename: string): void {
  const safeName = sanitizeDisplayName(filename);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName;
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export function buildDownloadQueue(results: ModMigrationResult[]): BulkDownloadItem[] {
  const seenUrls = new Set<string>();
  const items: BulkDownloadItem[] = [];

  for (const res of results) {
    if (res.category !== 'ready' || !res.targetFile?.url) continue;
    if (seenUrls.has(res.targetFile.url)) continue;
    seenUrls.add(res.targetFile.url);

    items.push({
      resultId: res.id,
      filename: sanitizeDisplayName(res.targetFile.filename),
      projectTitle: res.project?.title ?? res.localFile.name,
      url: res.targetFile.url,
      size: res.targetFile.size,
      status: 'pending',
    });
  }

  return items;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface SequentialBulkCallbacks {
  signal?: AbortSignal;
  delayMs?: number;
  onItemUpdate: (items: BulkDownloadItem[]) => void;
}

/**
 * Triggers sequential direct downloads from official Modrinth URLs with controlled
 * spacing to reduce browser multiple-download blocking.
 */
export async function runSequentialDownloads(
  initialItems: BulkDownloadItem[],
  callbacks: SequentialBulkCallbacks,
): Promise<BulkDownloadItem[]> {
  const { signal, delayMs = 550, onItemUpdate } = callbacks;
  const items = initialItems.map((it) => ({ ...it }));

  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) break;
    if (items[i].status === 'completed') continue;

    items[i] = { ...items[i], status: 'downloading', error: undefined };
    onItemUpdate([...items]);

    try {
      triggerDirectDownload(items[i].url, items[i].filename);
      items[i] = { ...items[i], status: 'completed' };
    } catch (err) {
      items[i] = {
        ...items[i],
        status: 'failed',
        error:
          err instanceof Error
            ? err.message
            : 'Browser blocked automatic download. Use the direct download button.',
      };
    }
    onItemUpdate([...items]);

    if (i < items.length - 1 && !signal?.aborted) {
      try {
        await sleep(delayMs, signal);
      } catch {
        break;
      }
    }
  }

  return items;
}

export interface ZipBundleProgress {
  completed: number;
  total: number;
  currentFilename: string;
  failedItems: Array<{ filename: string; reason: string }>;
}

export interface ZipBundleOutcome {
  succeededCount: number;
  failedItems: Array<{ filename: string; reason: string }>;
  corsBlocked: boolean;
  cancelled: boolean;
}

/**
 * Optional browser-side ZIP archive builder that fetches ready JARs directly from
 * Modrinth's CDN. If CORS or network protections block any fetch, reports failures
 * honestly rather than creating an incomplete or broken archive silently.
 */
export async function buildAndDownloadZipBundle(
  items: BulkDownloadItem[],
  config: MigrationTargetConfig,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: ZipBundleProgress) => void;
  } = {},
): Promise<ZipBundleOutcome> {
  const { signal, onProgress } = options;
  const zip = new JSZip();
  const folder = zip.folder('mods') ?? zip;

  const failedItems: Array<{ filename: string; reason: string }> = [];
  let completed = 0;
  let corsBlocked = false;
  let succeededCount = 0;

  // Controlled concurrency of 3 fetches at a time
  let cursor = 0;
  const concurrency = Math.min(3, Math.max(1, items.length));

  const worker = async () => {
    while (!signal?.aborted) {
      const idx = cursor++;
      if (idx >= items.length) break;
      const item = items[idx];

      onProgress?.({
        completed,
        total: items.length,
        currentFilename: item.filename,
        failedItems: [...failedItems],
      });

      try {
        const res = await fetch(item.url, { signal, mode: 'cors' });
        if (!res.ok) {
          failedItems.push({
            filename: item.filename,
            reason: `HTTP ${res.status} from CDN`,
          });
        } else {
          const buf = await res.arrayBuffer();
          folder.file(item.filename, buf);
          succeededCount++;
        }
      } catch (err) {
        if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        corsBlocked = true;
        failedItems.push({
          filename: item.filename,
          reason:
            err instanceof Error
              ? err.message
              : 'Blocked by CORS or network restriction.',
        });
      } finally {
        completed++;
        onProgress?.({
          completed,
          total: items.length,
          currentFilename: item.filename,
          failedItems: [...failedItems],
        });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (signal?.aborted) {
    return {
      succeededCount,
      failedItems,
      corsBlocked,
      cancelled: true,
    };
  }

  if (succeededCount === 0) {
    return {
      succeededCount: 0,
      failedItems,
      corsBlocked,
      cancelled: false,
    };
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const zipFilename = sanitizeDisplayName(
    `${BRAND_CONFIG.name.toLowerCase()}-${config.loader}-${config.gameVersion}-mods.zip`,
  );
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = zipFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  }

  return {
    succeededCount,
    failedItems,
    corsBlocked,
    cancelled: false,
  };
}

function triggerTextDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeDisplayName(filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

export function exportMigrationJson(
  results: ModMigrationResult[],
  dependencies: ResolvedDependency[],
  config: MigrationTargetConfig,
): void {
  const payload = {
    generatedAt: new Date().toISOString(),
    tool: BRAND_CONFIG.name,
    provider: 'Modrinth',
    target: {
      gameVersion: config.gameVersion,
      loader: config.loader,
    },
    summary: {
      total: results.length,
      ready: results.filter((r) => r.category === 'ready').length,
      noUpdate: results.filter((r) => r.category === 'no_update').length,
      notFound: results.filter((r) => r.category === 'not_found').length,
      needsReview: results.filter((r) => r.category === 'needs_review').length,
      failed: results.filter((r) => r.category === 'failed').length,
    },
    mods: results.map((r) => ({
      originalFilename: r.localFile.name,
      originalSizeBytes: r.localFile.size,
      sha1: r.localFile.sha1 ?? null,
      category: r.category,
      projectTitle: r.project?.title ?? null,
      projectSlug: r.project?.slug ?? null,
      targetVersionNumber: r.targetVersion?.version_number ?? null,
      targetFileName: r.targetFile?.filename ?? null,
      targetDownloadUrl: r.targetFile?.url ?? null,
      explanation: r.explanation,
      errorMessage: r.errorMessage ?? null,
    })),
    dependencies: dependencies.map((d) => ({
      projectTitle: d.projectTitle,
      dependencyType: d.dependencyType,
      status: d.status,
      requiredBy: d.requiredBy.map((x) => x.modName),
      targetVersionNumber: d.targetVersion?.version_number ?? null,
      downloadUrl: d.targetFile?.url ?? null,
      explanation: d.explanation,
    })),
  };

  triggerTextDownload(
    JSON.stringify(payload, null, 2),
    `mod-migration-${config.loader}-${config.gameVersion}.json`,
    'application/json;charset=utf-8',
  );
}

export function exportMigrationMarkdown(
  results: ModMigrationResult[],
  dependencies: ResolvedDependency[],
  config: MigrationTargetConfig,
): void {
  const ready = results.filter((r) => r.category === 'ready');
  const noUpdate = results.filter((r) => r.category === 'no_update');
  const notFound = results.filter((r) => r.category === 'not_found');
  const needsReview = results.filter((r) => r.category === 'needs_review');
  const failed = results.filter((r) => r.category === 'failed');

  const lines: string[] = [
    `# ${BRAND_CONFIG.name} Migration Report`,
    '',
    `- **Target Minecraft Version:** ${config.gameVersion}`,
    `- **Target Loader:** ${formatLoaderName(config.loader)}`,
    `- **Generated:** ${new Date().toLocaleString()}`,
    `- **Total Analyzed:** ${results.length}`,
    `- **Ready:** ${ready.length} | **No Update:** ${noUpdate.length} | **Not Found:** ${notFound.length} | **Needs Review:** ${needsReview.length} | **Failed:** ${failed.length}`,
    '',
  ];

  if (ready.length > 0) {
    lines.push('## Ready to Download', '');
    for (const r of ready) {
      const name = r.project?.title ?? r.localFile.name;
      const ver = r.targetVersion?.version_number ?? 'unknown';
      const size = r.targetFile ? formatBytes(r.targetFile.size) : '';
      lines.push(
        `- **${name}** (${ver}${size ? `, ${size}` : ''}) — [${r.targetFile?.filename ?? 'Download'}](${r.targetFile?.url ?? '#'})`,
      );
    }
    lines.push('');
  }

  if (needsReview.length > 0) {
    lines.push('## Needs Review', '');
    for (const r of needsReview) {
      lines.push(`- **${r.project?.title ?? r.localFile.name}**: ${r.explanation}`);
    }
    lines.push('');
  }

  if (noUpdate.length > 0) {
    lines.push('## No Compatible Update Found', '');
    for (const r of noUpdate) {
      lines.push(`- **${r.project?.title ?? r.localFile.name}** (\`${r.localFile.name}\`): ${r.explanation}`);
    }
    lines.push('');
  }

  if (notFound.length > 0) {
    lines.push('## Not Found on Modrinth', '');
    for (const r of notFound) {
      lines.push(`- \`${r.localFile.name}\` (SHA-1: \`${r.localFile.sha1 ?? 'N/A'}\`)`);
    }
    lines.push('');
  }

  if (dependencies.length > 0) {
    lines.push('## Dependencies', '');
    for (const d of dependencies) {
      lines.push(
        `- **${d.projectTitle}** (${d.dependencyType}, status: ${d.status}) — required by: ${d.requiredBy.map((x) => x.modName).join(', ')}`,
      );
    }
    lines.push('');
  }

  triggerTextDownload(
    lines.join('\n'),
    `mod-migration-${config.loader}-${config.gameVersion}.md`,
    'text/markdown;charset=utf-8',
  );
}

export function exportDownloadUrlsTxt(
  results: ModMigrationResult[],
  config: MigrationTargetConfig,
): void {
  const urls = results
    .filter((r) => r.category === 'ready' && r.targetFile?.url)
    .map((r) => r.targetFile!.url);

  triggerTextDownload(
    urls.join('\n') + '\n',
    `mod-urls-${config.loader}-${config.gameVersion}.txt`,
    'text/plain;charset=utf-8',
  );
}
