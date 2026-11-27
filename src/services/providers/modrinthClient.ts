import { BRAND_CONFIG } from '../../config/brand';
import type {
  ErrorKind,
  GameVersionTag,
  LoaderTag,
  ModLoader,
  ModrinthProject,
  ModrinthSearchHit,
  ModrinthVersion,
} from '../../types/migration';
import type { IModProvider, ModProviderCapabilities } from './modProvider';

export class ModrinthApiError extends Error {
  public readonly kind: ErrorKind;
  public readonly statusCode?: number;
  public readonly retryAfterMs?: number;

  constructor(
    message: string,
    kind: ErrorKind,
    statusCode?: number,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ModrinthApiError';
    this.kind = kind;
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  cacheKey?: string;
}

class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      throw new ModrinthApiError('Request was cancelled.', 'cancelled');
    }

    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          const idx = this.queue.indexOf(proceed);
          if (idx !== -1) this.queue.splice(idx, 1);
          reject(new ModrinthApiError('Request was cancelled.', 'cancelled'));
        };

        const proceed = () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };

        signal?.addEventListener('abort', onAbort, { once: true });
        this.queue.push(proceed);
      });
    }

    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ModrinthApiError('Request was cancelled.', 'cancelled'));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new ModrinthApiError('Request was cancelled.', 'cancelled'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateVersionObject(raw: unknown): raw is ModrinthVersion {
  if (!isObjectRecord(raw)) return false;
  return (
    typeof raw.id === 'string' &&
    typeof raw.project_id === 'string' &&
    typeof raw.version_number === 'string' &&
    Array.isArray(raw.files) &&
    Array.isArray(raw.game_versions) &&
    Array.isArray(raw.loaders)
  );
}

function validateProjectObject(raw: unknown): raw is ModrinthProject {
  if (!isObjectRecord(raw)) return false;
  return (
    typeof raw.id === 'string' &&
    typeof raw.slug === 'string' &&
    typeof raw.title === 'string' &&
    typeof raw.project_type === 'string'
  );
}

/**
 * Modrinth API v2 client with controlled concurrency, in-memory session caching,
 * request deduplication, rate-limit handling (429 + X-Ratelimit-*), and
 * exponential backoff retries.
 *
 * Note on User-Agent: Browser fetch() forbids setting custom User-Agent headers per
 * the Fetch specification. Modrinth explicitly supports open CORS browser requests.
 */
export class ModrinthClient implements IModProvider {
  public readonly capabilities: ModProviderCapabilities = {
    id: 'modrinth',
    displayName: 'Modrinth',
    enabled: true,
    requiresBackendCredentials: false,
  };

  private readonly baseUrl: string;
  private readonly limiter = new ConcurrencyLimiter(4);
  private readonly cache = new Map<string, unknown>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private rateLimitBlockedUntil = 0;

  constructor(baseUrl: string = BRAND_CONFIG.apiBaseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public clearSessionCache(): void {
    this.cache.clear();
  }

  private async requestJson<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const {
      method = 'GET',
      body,
      signal,
      timeoutMs = 15000,
      maxRetries = 3,
      cacheKey,
    } = options;

    if (cacheKey && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) as T;
    }

    const dedupeKey = cacheKey || (method === 'GET' ? `${method}:${path}` : undefined);
    if (dedupeKey && this.inFlight.has(dedupeKey)) {
      return this.inFlight.get(dedupeKey) as Promise<T>;
    }

    const execute = async (): Promise<T> => {
      let attempt = 0;
      while (true) {
        if (signal?.aborted) {
          throw new ModrinthApiError('Request was cancelled.', 'cancelled');
        }

        const waitUntil = this.rateLimitBlockedUntil - Date.now();
        if (waitUntil > 0) {
          await sleep(waitUntil, signal);
        }

        const result = await this.limiter.run(async () => {
          const controller = new AbortController();
          let timedOut = false;

          const onExternalAbort = () => controller.abort();
          signal?.addEventListener('abort', onExternalAbort, { once: true });

          const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs);

          try {
            const headers: Record<string, string> = {
              Accept: 'application/json',
            };
            if (body !== undefined) {
              headers['Content-Type'] = 'application/json';
            }

            const response = await fetch(`${this.baseUrl}${path}`, {
              method,
              headers,
              body: body !== undefined ? JSON.stringify(body) : undefined,
              signal: controller.signal,
            });

            // Respect Modrinth rate-limit headers proactively
            const remainingRaw = response.headers.get('X-Ratelimit-Remaining');
            const resetRaw = response.headers.get('X-Ratelimit-Reset');
            if (remainingRaw !== null && resetRaw !== null) {
              const remaining = Number(remainingRaw);
              const resetSec = Number(resetRaw);
              if (Number.isFinite(remaining) && remaining <= 1 && Number.isFinite(resetSec) && resetSec > 0) {
                this.rateLimitBlockedUntil = Math.max(
                  this.rateLimitBlockedUntil,
                  Date.now() + Math.min(resetSec * 1000, 10000),
                );
              }
            }

            if (response.status === 429) {
              const retryAfterHeader = response.headers.get('Retry-After');
              const resetHeader = response.headers.get('X-Ratelimit-Reset');
              let waitMs = 2000 * Math.pow(2, attempt);
              if (retryAfterHeader && Number.isFinite(Number(retryAfterHeader))) {
                waitMs = Math.max(500, Number(retryAfterHeader) * 1000);
              } else if (resetHeader && Number.isFinite(Number(resetHeader))) {
                waitMs = Math.max(500, Number(resetHeader) * 1000);
              }
              waitMs = Math.min(waitMs, 15000);
              this.rateLimitBlockedUntil = Math.max(this.rateLimitBlockedUntil, Date.now() + waitMs);
              throw new ModrinthApiError(
                'Modrinth rate limit reached. Waiting briefly before retrying.',
                'rate_limit',
                429,
                waitMs,
              );
            }

            if (!response.ok) {
              if (response.status >= 500) {
                throw new ModrinthApiError(
                  `Modrinth returned a server error (HTTP ${response.status}).`,
                  'server_error',
                  response.status,
                );
              }
              throw new ModrinthApiError(
                `Modrinth API request failed (HTTP ${response.status}).`,
                'invalid_response',
                response.status,
              );
            }

            let parsed: unknown;
            try {
              parsed = await response.json();
            } catch {
              throw new ModrinthApiError(
                'Received malformed JSON from Modrinth API.',
                'invalid_response',
                response.status,
              );
            }
            return parsed as T;
          } catch (err) {
            if (err instanceof ModrinthApiError) {
              throw err;
            }
            if (signal?.aborted) {
              throw new ModrinthApiError('Request was cancelled.', 'cancelled');
            }
            if (timedOut || (err instanceof DOMException && err.name === 'AbortError')) {
              throw new ModrinthApiError(
                'Modrinth request timed out. Check your connection and retry.',
                'timeout',
              );
            }
            throw new ModrinthApiError(
              'Network error reaching Modrinth API. Check your internet connection.',
              'network',
            );
          } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onExternalAbort);
          }
        }, signal);

        return result;
      }
    };

    const runWithRetry = async (): Promise<T> => {
      let attempt = 0;
      while (true) {
        try {
          const data = await execute();
          if (cacheKey) {
            this.cache.set(cacheKey, data);
          }
          return data;
        } catch (err) {
          const apiErr =
            err instanceof ModrinthApiError
              ? err
              : new ModrinthApiError('Unexpected Modrinth client error.', 'network');

          const isRetryable =
            apiErr.kind === 'rate_limit' ||
            apiErr.kind === 'server_error' ||
            apiErr.kind === 'timeout' ||
            apiErr.kind === 'network';

          if (!isRetryable || attempt >= maxRetries || signal?.aborted) {
            throw apiErr;
          }

          const baseDelay =
            apiErr.retryAfterMs ?? Math.min(1000 * Math.pow(2, attempt), 8000);
          const jitter = Math.floor(Math.random() * 350);
          attempt++;
          await sleep(baseDelay + jitter, signal);
        }
      }
    };

    const promise = runWithRetry();
    if (dedupeKey) {
      this.inFlight.set(dedupeKey, promise);
      promise.finally(() => {
        this.inFlight.delete(dedupeKey);
      });
    }
    return promise;
  }

  public async getGameVersions(signal?: AbortSignal): Promise<GameVersionTag[]> {
    const raw = await this.requestJson<unknown>('/tag/game_version', {
      signal,
      cacheKey: 'tag:game_version',
    });
    if (!Array.isArray(raw)) {
      throw new ModrinthApiError(
        'Unexpected game version list format from Modrinth.',
        'invalid_response',
      );
    }
    return raw.filter(
      (item): item is GameVersionTag =>
        isObjectRecord(item) &&
        typeof item.version === 'string' &&
        typeof item.version_type === 'string',
    );
  }

  public async getLoaders(signal?: AbortSignal): Promise<LoaderTag[]> {
    const raw = await this.requestJson<unknown>('/tag/loader', {
      signal,
      cacheKey: 'tag:loader',
    });
    if (!Array.isArray(raw)) {
      throw new ModrinthApiError(
        'Unexpected loader tag list format from Modrinth.',
        'invalid_response',
      );
    }
    return raw.filter(
      (item): item is LoaderTag =>
        isObjectRecord(item) &&
        typeof item.name === 'string' &&
        Array.isArray(item.supported_project_types),
    );
  }

  public async lookupVersionFilesByHashes(
    hashes: string[],
    algorithm: 'sha1' | 'sha512' = 'sha1',
    signal?: AbortSignal,
  ): Promise<Record<string, ModrinthVersion>> {
    if (hashes.length === 0) return {};

    // Check cache per hash first
    const result: Record<string, ModrinthVersion> = {};
    const missingHashes: string[] = [];

    for (const h of hashes) {
      const cached = this.cache.get(`vf:${algorithm}:${h}`);
      if (cached === null) {
        // Explicitly cached miss
        continue;
      } else if (cached && validateVersionObject(cached)) {
        result[h] = cached;
      } else {
        missingHashes.push(h);
      }
    }

    if (missingHashes.length === 0) {
      return result;
    }

    const raw = await this.requestJson<unknown>('/version_files', {
      method: 'POST',
      body: {
        hashes: missingHashes,
        algorithm,
      },
      signal,
    });

    if (!isObjectRecord(raw)) {
      throw new ModrinthApiError(
        'Unexpected response format from Modrinth version_files lookup.',
        'invalid_response',
      );
    }

    for (const h of missingHashes) {
      const val = raw[h];
      if (validateVersionObject(val)) {
        this.cache.set(`vf:${algorithm}:${h}`, val);
        result[h] = val;
      } else if (val === undefined) {
        this.cache.set(`vf:${algorithm}:${h}`, null);
      }
    }

    return result;
  }

  public async findUpdatedVersionsByHashes(
    hashes: string[],
    algorithm: 'sha1' | 'sha512' = 'sha1',
    loaders: ModLoader[],
    gameVersions: string[],
    signal?: AbortSignal,
  ): Promise<Record<string, ModrinthVersion>> {
    if (hashes.length === 0) return {};

    const configSig = `${loaders.join(',')}:${gameVersions.join(',')}`;
    const result: Record<string, ModrinthVersion> = {};
    const uncachedHashes: string[] = [];

    for (const h of hashes) {
      const cached = this.cache.get(`vfu:${algorithm}:${configSig}:${h}`);
      if (cached === null) {
        continue;
      } else if (cached && validateVersionObject(cached)) {
        result[h] = cached;
      } else {
        uncachedHashes.push(h);
      }
    }

    if (uncachedHashes.length === 0) {
      return result;
    }

    const raw = await this.requestJson<unknown>('/version_files/update', {
      method: 'POST',
      body: {
        hashes: uncachedHashes,
        algorithm,
        loaders,
        game_versions: gameVersions,
      },
      signal,
    });

    if (!isObjectRecord(raw)) {
      throw new ModrinthApiError(
        'Unexpected response format from Modrinth version_files/update lookup.',
        'invalid_response',
      );
    }

    for (const h of uncachedHashes) {
      const val = raw[h];
      if (validateVersionObject(val)) {
        this.cache.set(`vfu:${algorithm}:${configSig}:${h}`, val);
        result[h] = val;
      } else if (val === undefined) {
        this.cache.set(`vfu:${algorithm}:${configSig}:${h}`, null);
      }
    }

    return result;
  }

  public async getProjects(
    ids: string[],
    signal?: AbortSignal,
  ): Promise<ModrinthProject[]> {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return [];

    const results: ModrinthProject[] = [];
    const missing: string[] = [];

    for (const id of uniqueIds) {
      const cached = this.cache.get(`proj:${id}`);
      if (cached && validateProjectObject(cached)) {
        results.push(cached);
      } else {
        missing.push(id);
      }
    }

    // Batch in groups of 100
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      const encodedIds = encodeURIComponent(JSON.stringify(chunk));
      const raw = await this.requestJson<unknown>(`/projects?ids=${encodedIds}`, {
        signal,
      });
      if (!Array.isArray(raw)) {
        throw new ModrinthApiError(
          'Unexpected response format from Modrinth batch project lookup.',
          'invalid_response',
        );
      }
      for (const item of raw) {
        if (validateProjectObject(item)) {
          this.cache.set(`proj:${item.id}`, item);
          results.push(item);
        }
      }
    }

    return results;
  }

  public async getProjectVersions(
    idOrSlug: string,
    loaders?: ModLoader[],
    gameVersions?: string[],
    signal?: AbortSignal,
  ): Promise<ModrinthVersion[]> {
    const params = new URLSearchParams();
    if (loaders && loaders.length > 0) {
      params.set('loaders', JSON.stringify(loaders));
    }
    if (gameVersions && gameVersions.length > 0) {
      params.set('game_versions', JSON.stringify(gameVersions));
    }
    params.set('include_changelog', 'true');

    const queryStr = params.toString();
    const path = `/project/${encodeURIComponent(idOrSlug)}/version${queryStr ? `?${queryStr}` : ''}`;

    const raw = await this.requestJson<unknown>(path, {
      signal,
      cacheKey: `pvers:${path}`,
    });

    if (!Array.isArray(raw)) {
      throw new ModrinthApiError(
        'Unexpected response format from Modrinth project versions lookup.',
        'invalid_response',
      );
    }

    return raw.filter(validateVersionObject);
  }

  public async getVersion(
    versionId: string,
    signal?: AbortSignal,
  ): Promise<ModrinthVersion> {
    const raw = await this.requestJson<unknown>(
      `/version/${encodeURIComponent(versionId)}`,
      {
        signal,
        cacheKey: `ver:${versionId}`,
      },
    );
    if (!validateVersionObject(raw)) {
      throw new ModrinthApiError(
        'Unexpected version object returned from Modrinth.',
        'invalid_response',
      );
    }
    return raw;
  }

  public async searchProjects(
    query: string,
    loader?: ModLoader,
    gameVersion?: string,
    limit = 10,
    signal?: AbortSignal,
  ): Promise<ModrinthSearchHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const facets: string[][] = [['project_type:mod']];
    if (loader) {
      facets.push([`categories:${loader}`]);
    }
    if (gameVersion) {
      facets.push([`versions:${gameVersion}`]);
    }

    const params = new URLSearchParams({
      query: trimmed,
      limit: String(limit),
      facets: JSON.stringify(facets),
    });

    const path = `/search?${params.toString()}`;
    const raw = await this.requestJson<unknown>(path, {
      signal,
      cacheKey: `search:${path}`,
    });

    if (!isObjectRecord(raw) || !Array.isArray(raw.hits)) {
      throw new ModrinthApiError(
        'Unexpected response format from Modrinth search.',
        'invalid_response',
      );
    }

    return raw.hits.filter(
      (hit): hit is ModrinthSearchHit =>
        isObjectRecord(hit) &&
        typeof hit.project_id === 'string' &&
        typeof hit.title === 'string' &&
        typeof hit.slug === 'string',
    );
  }
}

export const modrinthClient = new ModrinthClient();
