import { BRAND_CONFIG } from '../config/brand';
import type { LocalModFile, RejectedFileNotice } from '../types/migration';
import { isJarFilename, sanitizeDisplayName } from '../utils/format';
import type { HashWorkerRequest, HashWorkerResponse } from '../workers/hash.worker';

export interface FileIntakeResult {
  accepted: LocalModFile[];
  rejected: RejectedFileNotice[];
}

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Validates newly selected or dropped files without touching the network.
 * Rejects non-.jar files, empty 0-byte files, and obvious duplicates already in the list.
 */
export function intakeModFiles(
  incomingFiles: FileList | File[],
  existingFiles: LocalModFile[],
): FileIntakeResult {
  const accepted: LocalModFile[] = [];
  const rejected: RejectedFileNotice[] = [];

  const seenNameSize = new Map<string, string>();
  for (const existing of existingFiles) {
    seenNameSize.set(`${existing.name.toLowerCase()}::${existing.size}`, existing.name);
  }

  const list = Array.from(incomingFiles);
  for (const file of list) {
    const cleanName = sanitizeDisplayName(file.name);

    if (!isJarFilename(cleanName)) {
      rejected.push({
        id: makeId('rej'),
        name: cleanName,
        size: file.size,
        reason: 'invalid_extension',
        message: 'Skipped because only .jar mod files are supported.',
      });
      continue;
    }

    if (file.size === 0) {
      rejected.push({
        id: makeId('rej'),
        name: cleanName,
        size: 0,
        reason: 'empty_file',
        message: 'Skipped because this file is empty (0 bytes).',
      });
      continue;
    }

    const dedupeKey = `${cleanName.toLowerCase()}::${file.size}`;
    const existingMatch = seenNameSize.get(dedupeKey);
    if (existingMatch) {
      rejected.push({
        id: makeId('rej'),
        name: cleanName,
        size: file.size,
        reason: 'duplicate_file',
        duplicateOf: existingMatch,
        message: `Duplicate of "${existingMatch}" already in your selection.`,
      });
      continue;
    }

    seenNameSize.set(dedupeKey, cleanName);
    const relativePath =
      'webkitRelativePath' in file && typeof (file as File & { webkitRelativePath?: string }).webkitRelativePath === 'string'
        ? sanitizeDisplayName((file as File & { webkitRelativePath: string }).webkitRelativePath)
        : undefined;

    accepted.push({
      id: makeId('mod'),
      file,
      name: cleanName,
      relativePath: relativePath && relativePath !== cleanName ? relativePath : undefined,
      size: file.size,
      status: 'queued',
      isLargeFile: file.size >= BRAND_CONFIG.largeFileWarningBytes,
    });
  }

  return { accepted, rejected };
}

async function hashFileOnMainThread(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto SHA-1 hashing is unavailable in this browser context.');
  }
  const digest = await crypto.subtle.digest('SHA-1', buffer);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface HashBatchOptions {
  signal?: AbortSignal;
  onFileProgress?: (updatedFile: LocalModFile, completedCount: number, totalCount: number) => void;
}

export interface HashBatchOutcome {
  hashedFiles: LocalModFile[];
  duplicateNotices: RejectedFileNotice[];
  cancelled: boolean;
}

/**
 * Calculates local SHA-1 hashes for a list of LocalModFile items using a
 * Web Worker pool so large collections (200+ mods) do not freeze the UI.
 * Also performs exact content-based duplicate detection using the computed SHA-1.
 */
export async function hashModCollection(
  files: LocalModFile[],
  options: HashBatchOptions = {},
): Promise<HashBatchOutcome> {
  const { signal, onFileProgress } = options;
  const totalCount = files.length;
  if (totalCount === 0) {
    return { hashedFiles: [], duplicateNotices: [], cancelled: false };
  }

  const results: LocalModFile[] = files.map((f) => ({ ...f }));
  let completed = 0;

  // Already-hashed files count as completed right away
  const pendingIndices: number[] = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'hashed' && results[i].sha1) {
      completed++;
    } else {
      pendingIndices.push(i);
    }
  }

  const canUseWorkers = typeof Worker !== 'undefined';
  const concurrency = canUseWorkers
    ? Math.min(4, Math.max(2, typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2))
    : 2;

  const workers: Worker[] = [];
  let aborted = Boolean(signal?.aborted);

  const cleanupWorkers = () => {
    for (const w of workers) {
      try {
        w.terminate();
      } catch {
        // Ignore worker termination errors
      }
    }
    workers.length = 0;
  };

  if (signal) {
    signal.addEventListener(
      'abort',
      () => {
        aborted = true;
        cleanupWorkers();
      },
      { once: true },
    );
  }

  let cursor = 0;

  const hashSingleWithWorker = (worker: Worker, item: LocalModFile): Promise<string> =>
    new Promise((resolve, reject) => {
      if (aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const handleMessage = (ev: MessageEvent<HashWorkerResponse>) => {
        if (ev.data.id !== item.id) return;
        cleanup();
        if (ev.data.type === 'result' && ev.data.sha1) {
          resolve(ev.data.sha1);
        } else {
          reject(new Error(ev.data.error || 'Failed to calculate SHA-1 hash.'));
        }
      };

      const handleError = (err: ErrorEvent) => {
        cleanup();
        reject(new Error(err.message || 'Hash worker encountered an error.'));
      };

      const handleAbort = () => {
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      };

      const cleanup = () => {
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        signal?.removeEventListener('abort', handleAbort);
      };

      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);
      signal?.addEventListener('abort', handleAbort, { once: true });

      const request: HashWorkerRequest = {
        type: 'hash',
        id: item.id,
        file: item.file,
      };
      worker.postMessage(request);
    });

  const runWorkerSlot = async (worker: Worker | null) => {
    while (!aborted) {
      const idxPos = cursor++;
      if (idxPos >= pendingIndices.length) break;
      const targetIndex = pendingIndices[idxPos];
      const item = results[targetIndex];

      results[targetIndex] = { ...item, status: 'hashing', error: undefined };
      onFileProgress?.(results[targetIndex], completed, totalCount);

      try {
        const sha1 = worker
          ? await hashSingleWithWorker(worker, item)
          : await hashFileOnMainThread(item.file);

        if (aborted) break;

        results[targetIndex] = {
          ...item,
          sha1,
          status: 'hashed',
          error: undefined,
        };
      } catch (err) {
        if (aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          results[targetIndex] = { ...item, status: 'queued' };
          break;
        }
        results[targetIndex] = {
          ...item,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unable to read file.',
        };
      }

      completed++;
      onFileProgress?.(results[targetIndex], completed, totalCount);
    }
  };

  try {
    const slotPromises: Promise<void>[] = [];
    const slotCount = Math.min(concurrency, Math.max(1, pendingIndices.length));

    for (let s = 0; s < slotCount; s++) {
      let worker: Worker | null = null;
      if (canUseWorkers) {
        try {
          worker = new Worker(new URL('../workers/hash.worker.ts', import.meta.url), {
            type: 'module',
          });
          workers.push(worker);
        } catch {
          worker = null;
        }
      }
      slotPromises.push(runWorkerSlot(worker));
    }

    await Promise.all(slotPromises);
  } finally {
    cleanupWorkers();
  }

  if (aborted) {
    return { hashedFiles: results, duplicateNotices: [], cancelled: true };
  }

  // Exact SHA-1 duplicate detection across the entire batch
  const seenHashes = new Map<string, LocalModFile>();
  const uniqueFiles: LocalModFile[] = [];
  const duplicateNotices: RejectedFileNotice[] = [];

  for (const item of results) {
    if (item.status === 'hashed' && item.sha1) {
      const existing = seenHashes.get(item.sha1);
      if (existing) {
        duplicateNotices.push({
          id: makeId('dup'),
          name: item.name,
          size: item.size,
          reason: 'duplicate_file',
          duplicateOf: existing.name,
          message: `Identical SHA-1 content to "${existing.name}" — skipped duplicate.`,
        });
        continue;
      }
      seenHashes.set(item.sha1, item);
    }
    uniqueFiles.push(item);
  }

  return {
    hashedFiles: uniqueFiles,
    duplicateNotices,
    cancelled: false,
  };
}
