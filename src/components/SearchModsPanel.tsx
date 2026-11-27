import {
  BookmarkPlus,
  Check,
  Download,
  ExternalLink,
  Loader2,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SUPPORTED_LOADERS } from '../config/brand';
import { useAuth } from '../contexts/AuthContext';
import { triggerDirectDownload } from '../services/downloadService';
import { pickTargetJarFile, selectPreferredVersion } from '../services/migrationEngine';
import { modrinthClient } from '../services/providers/modrinthClient';
import { saveTrackedMod, type TrackedModRecord } from '../services/trackedModsService';
import type {
  GameVersionTag,
  ModLoader,
  ModrinthSearchHit,
  ModrinthVersion,
} from '../types/migration';
import { formatLoaderName, getModrinthProjectUrl } from '../utils/format';

interface SearchModsPanelProps {
  gameVersions: GameVersionTag[];
  defaultGameVersion: string;
  defaultLoader: ModLoader;
  trackedMods: TrackedModRecord[];
}

export function SearchModsPanel({
  gameVersions,
  defaultGameVersion,
  defaultLoader,
  trackedMods,
}: SearchModsPanelProps) {
  const { user } = useAuth();
  const [query, setQuery] = useState('sodium');
  const [loader, setLoader] = useState<ModLoader>(defaultLoader);
  const [gameVersion, setGameVersion] = useState<string>(defaultGameVersion);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hits, setHits] = useState<ModrinthSearchHit[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [resolvedVersions, setResolvedVersions] = useState<
    Record<string, ModrinthVersion | null>
  >({});

  useEffect(() => {
    if (!gameVersion && defaultGameVersion) {
      setGameVersion(defaultGameVersion);
    }
  }, [defaultGameVersion, gameVersion]);

  const releaseVersions = useMemo(() => {
    const releases = gameVersions.filter((v) => v.version_type === 'release').slice(0, 100);
    if (gameVersion && !releases.some((v) => v.version === gameVersion)) {
      return [
        { version: gameVersion, version_type: 'release' as const, date: '', major: false },
        ...releases,
      ];
    }
    return releases;
  }, [gameVersions, gameVersion]);

  const trackedKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const m of trackedMods) {
      set.add(`${m.projectId}:${m.loader}`);
    }
    return set;
  }, [trackedMods]);

  const runSearch = async (searchText: string, targetLoader = loader, targetMc = gameVersion) => {
    const trimmed = searchText.trim();
    if (!trimmed) {
      setHits([]);
      return;
    }
    setSearching(true);
    setSearchError(null);
    setActionMessage(null);
    try {
      const results = await modrinthClient.searchProjects(
        trimmed,
        targetLoader,
        targetMc || undefined,
        15,
      );
      setHits(results);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : 'Unable to search Modrinth right now.',
      );
    } finally {
      setSearching(false);
    }
  };

  const hasAutoSearchedRef = useRef(false);
  useEffect(() => {
    if (!hasAutoSearchedRef.current && gameVersion) {
      hasAutoSearchedRef.current = true;
      void runSearch(query, loader, gameVersion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameVersion]);

  const fetchCompatibleVersion = async (
    projectId: string,
  ): Promise<ModrinthVersion | null> => {
    const cacheKey = `${projectId}:${loader}:${gameVersion}`;
    if (cacheKey in resolvedVersions) {
      return resolvedVersions[cacheKey];
    }
    const versions = await modrinthClient.getProjectVersions(
      projectId,
      [loader],
      gameVersion ? [gameVersion] : undefined,
    );
    const preferred = selectPreferredVersion(versions, false);
    const chosen = preferred.version ?? null;
    setResolvedVersions((prev) => ({ ...prev, [cacheKey]: chosen }));
    return chosen;
  };

  const handleSaveMod = async (hit: ModrinthSearchHit) => {
    if (!user) return;
    setSavingId(hit.project_id);
    setActionMessage(null);
    setSearchError(null);
    try {
      const version = await fetchCompatibleVersion(hit.project_id);
      const picked = version ? pickTargetJarFile(version).file : undefined;
      await saveTrackedMod(user, {
        projectId: hit.project_id,
        slug: hit.slug,
        title: hit.title,
        loader,
        targetVersion: gameVersion || '1.21.4',
        latestVersionNumber: version?.version_number,
        latestFilename: picked?.filename,
        latestDownloadUrl: picked?.url,
      });
      setActionMessage(`Saved "${hit.title}" to your Manage Mods library.`);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : 'Failed to save mod to your account.',
      );
    } finally {
      setSavingId(null);
    }
  };

  const handleDownloadMod = async (hit: ModrinthSearchHit) => {
    setDownloadingId(hit.project_id);
    setSearchError(null);
    try {
      const version = await fetchCompatibleVersion(hit.project_id);
      const picked = version ? pickTargetJarFile(version).file : undefined;
      if (!picked?.url) {
        setSearchError(
          `No ${formatLoaderName(loader)} .jar file found for "${hit.title}" on Minecraft ${gameVersion}.`,
        );
        return;
      }
      triggerDirectDownload(picked.url, picked.filename);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : 'Unable to fetch download URL from Modrinth.',
      );
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <section aria-labelledby="search-panel-heading" className="space-y-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-5 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2
          id="search-panel-heading"
          className="font-display text-lg font-semibold text-zinc-950 dark:text-zinc-50"
        >
          Search Modrinth Mods
        </h2>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          Search Modrinth directly, download verified releases for your Minecraft version and loader, or save mods to your personal library.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(query, loader, gameVersion);
          }}
          className="mt-4 grid gap-3 sm:grid-cols-12"
        >
          <div className="relative sm:col-span-5">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search mods (e.g. Sodium, Lithium, Iris)..."
              aria-label="Search Modrinth mods"
              className="min-h-10 w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>

          <div className="sm:col-span-3">
            <select
              aria-label="Filter by Minecraft version"
              value={gameVersion}
              onChange={(e) => {
                const nextGv = e.target.value;
                setGameVersion(nextGv);
                void runSearch(query, loader, nextGv);
              }}
              className="min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-950 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              {releaseVersions.map((gv) => (
                <option key={gv.version} value={gv.version}>
                  Minecraft {gv.version}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <select
              aria-label="Filter by mod loader"
              value={loader}
              onChange={(e) => {
                const nextLoader = e.target.value as ModLoader;
                setLoader(nextLoader);
                void runSearch(query, nextLoader, gameVersion);
              }}
              className="min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-950 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              {SUPPORTED_LOADERS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={searching || !query.trim()}
              className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white whitespace-nowrap transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {searching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>Search</span>
            </button>
          </div>
        </form>

        {actionMessage && (
          <p
            role="status"
            className="mt-3 text-xs font-medium text-emerald-700 dark:text-emerald-400"
          >
            {actionMessage}
          </p>
        )}

        {searchError && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-red-200 bg-red-50/70 p-3 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
          >
            {searchError}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {searching ? (
          <div className="flex items-center justify-center py-12 text-xs text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Searching Modrinth...</span>
          </div>
        ) : !gameVersion && hits.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-xs text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Loading Minecraft versions...</span>
          </div>
        ) : hits.length === 0 ? (
          <p className="p-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
            No matching mods found for Minecraft {gameVersion} ({formatLoaderName(loader)}). Try another search term or version.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {hits.map((hit) => {
              const isSaved = trackedKeySet.has(`${hit.project_id}:${loader}`);
              return (
                <li
                  key={hit.project_id}
                  className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <a
                        href={getModrinthProjectUrl(hit.slug, hit.project_type)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-sm text-zinc-950 hover:text-emerald-700 hover:underline dark:text-zinc-100 dark:hover:text-emerald-400"
                      >
                        <span>{hit.title}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                      </a>
                      <span className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                        · {hit.downloads.toLocaleString()} downloads
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">
                      {hit.description}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={savingId === hit.project_id}
                      onClick={() => void handleSaveMod(hit)}
                      className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                        isSaved
                          ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200'
                      }`}
                    >
                      {savingId === hit.project_id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : isSaved ? (
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>{isSaved ? 'In My Mods' : 'Save to My Mods'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={downloadingId === hit.project_id}
                      onClick={() => void handleDownloadMod(hit)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 whitespace-nowrap shrink-0 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      {downloadingId === hit.project_id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>Download</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
