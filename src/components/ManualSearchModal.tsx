import {
  Check,
  ExternalLink,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { modrinthClient } from '../services/providers/modrinthClient';
import { selectPreferredVersion } from '../services/migrationEngine';
import type {
  MigrationTargetConfig,
  ModMigrationResult,
  ModrinthProject,
  ModrinthSearchHit,
  ModrinthVersion,
} from '../types/migration';
import { formatLoaderName, formatShortDate, getModrinthProjectUrl } from '../utils/format';

interface ManualSearchModalProps {
  result: ModMigrationResult | null;
  config: MigrationTargetConfig;
  onClose: () => void;
  onSelectMatch: (
    originalResult: ModMigrationResult,
    project: ModrinthProject,
    version: ModrinthVersion,
  ) => void;
}

function suggestQueryFromFilename(filename: string): string {
  return filename
    .replace(/\.jar$/i, '')
    .replace(/[-_+]?(mc|fabric|neoforge|forge|quilt)?[-_+.]?\d+\.\d+(?:\.\d+)?.*$/i, '')
    .replace(/[-_+]+/g, ' ')
    .trim();
}

export function ManualSearchModal({
  result,
  config,
  onClose,
  onSelectMatch,
}: ManualSearchModalProps) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hits, setHits] = useState<ModrinthSearchHit[]>([]);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);

  useEffect(() => {
    if (!result) return;
    const metaSuggestion =
      result.localFile.jarMetadata?.name || result.localFile.jarMetadata?.modId;
    const initialQuery =
      metaSuggestion?.trim() || suggestQueryFromFilename(result.localFile.name);
    setQuery(initialQuery);
    setHits([]);
    setSearchError(null);
    setAttachError(null);

    if (initialQuery.length >= 2) {
      void runSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.id]);

  useEffect(() => {
    if (!result) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [result, onClose]);

  if (!result) return null;

  async function runSearch(searchText: string) {
    const trimmed = searchText.trim();
    if (!trimmed) {
      setHits([]);
      return;
    }
    setSearching(true);
    setSearchError(null);
    setAttachError(null);
    try {
      const found = await modrinthClient.searchProjects(
        trimmed,
        config.loader,
        config.gameVersion,
        12,
      );
      setHits(found);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : 'Failed to search Modrinth.',
      );
    } finally {
      setSearching(false);
    }
  }

  async function handleAttach(hit: ModrinthSearchHit) {
    if (!result) return;
    setAttachingId(hit.project_id);
    setAttachError(null);
    try {
      const [projects, versions] = await Promise.all([
        modrinthClient.getProjects([hit.project_id]),
        modrinthClient.getProjectVersions(
          hit.project_id,
          [config.loader],
          [config.gameVersion],
        ),
      ]);
      const preferred = selectPreferredVersion(
        versions,
        config.allowPrereleasesDirectly,
      );
      if (!preferred.version) {
        setAttachError(
          `"${hit.title}" has no ${formatLoaderName(config.loader)} release for Minecraft ${config.gameVersion}.`,
        );
        return;
      }
      const project: ModrinthProject = projects[0] ?? {
        id: hit.project_id,
        slug: hit.slug,
        project_type: hit.project_type,
        title: hit.title,
        description: hit.description,
        icon_url: hit.icon_url,
      };
      onSelectMatch(result, project, preferred.version);
      onClose();
    } catch (err) {
      setAttachError(
        err instanceof Error
          ? err.message
          : 'Unable to verify compatible version for this project.',
      );
    } finally {
      setAttachingId(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-search-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h3
              id="manual-search-title"
              className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50"
            >
              Search Modrinth manually
            </h3>
            <p className="mt-0.5 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {result.localFile.name} · Target: {config.gameVersion} ({formatLoaderName(config.loader)})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close manual search"
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(query);
          }}
          className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800"
        >
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Modrinth project name..."
              aria-label="Modrinth project search query"
              className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-zinc-950 px-4 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {searching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>Search</span>
          </button>
        </form>

        <div className="flex-1 overflow-y-auto p-5">
          {attachError && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50/70 p-3 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
            >
              {attachError}
            </div>
          )}

          {searchError ? (
            <div className="rounded-lg border border-red-200 bg-red-50/70 p-4 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {searchError}
            </div>
          ) : searching ? (
            <div className="flex items-center justify-center py-10 text-xs text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Searching Modrinth for compatible mods...
            </div>
          ) : hits.length === 0 ? (
            <p className="py-10 text-center text-xs text-zinc-500 dark:text-zinc-400">
              No Modrinth projects matched your query for {config.gameVersion} ({formatLoaderName(config.loader)}). Try a shorter mod name.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {hits.map((hit) => (
                <li
                  key={hit.project_id}
                  className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <a
                        href={getModrinthProjectUrl(hit.slug, hit.project_type)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-sm text-zinc-950 hover:text-emerald-700 hover:underline dark:text-zinc-100 dark:hover:text-emerald-400"
                      >
                        <span className="truncate">{hit.title}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                      </a>
                      <span className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                        · {hit.downloads.toLocaleString()} downloads
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">
                      {hit.description}
                    </p>
                    {hit.versions.length > 0 && (
                      <p className="mt-1 text-[11px] font-mono text-zinc-500 dark:text-zinc-500">
                        Latest tagged: {formatShortDate(hit.versions[hit.versions.length - 1]) || hit.versions.slice(-1)[0]}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={attachingId === hit.project_id}
                    onClick={() => void handleAttach(hit)}
                    className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-900 whitespace-nowrap shrink-0 transition-colors hover:border-emerald-600 hover:bg-emerald-50 hover:text-emerald-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-emerald-500 dark:hover:bg-emerald-950/40"
                  >
                    {attachingId === hit.project_id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span>Select Match</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
