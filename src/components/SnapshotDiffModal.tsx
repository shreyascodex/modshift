import { ArrowRight, GitCompare, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { SavedMigrationRecord } from '../services/savedMigrationsService';
import { formatLoaderName } from '../utils/format';
import { computeSnapshotDiff } from '../utils/modEnvironment';

interface SnapshotDiffModalProps {
  open: boolean;
  snapshots: SavedMigrationRecord[];
  onClose: () => void;
}

type DiffFilter = 'all' | 'added' | 'removed' | 'updated' | 'unchanged';

export function SnapshotDiffModal({
  open,
  snapshots,
  onClose,
}: SnapshotDiffModalProps) {
  const [baseId, setBaseId] = useState<string>(() => snapshots[1]?.id ?? snapshots[0]?.id ?? '');
  const [targetId, setTargetId] = useState<string>(() => snapshots[0]?.id ?? '');
  const [filter, setFilter] = useState<DiffFilter>('all');
  const [queryText, setQueryText] = useState('');

  const effectiveBase =
    snapshots.find((s) => s.id === baseId) ?? snapshots[1] ?? snapshots[0];
  const effectiveTarget =
    snapshots.find((s) => s.id === targetId) ?? snapshots[0];

  const report = useMemo(() => {
    if (!effectiveBase || !effectiveTarget) return null;
    return computeSnapshotDiff(effectiveBase, effectiveTarget);
  }, [effectiveBase, effectiveTarget]);

  const entries = useMemo(() => {
    if (!report) return [];
    const pool =
      filter === 'added'
        ? report.added
        : filter === 'removed'
        ? report.removed
        : filter === 'updated'
        ? report.updated
        : filter === 'unchanged'
        ? report.unchanged
        : [
            ...report.added,
            ...report.removed,
            ...report.updated,
            ...report.unchanged,
          ];
    const q = queryText.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        (e.baseVersion?.toLowerCase().includes(q) ?? false) ||
        (e.targetVersion?.toLowerCase().includes(q) ?? false),
    );
  }, [report, filter, queryText]);

  if (!open || snapshots.length < 2 || !effectiveBase || !effectiveTarget || !report) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="snapshot-diff-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-[2px]"
    >
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-emerald-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-emerald-400">
              <GitCompare className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="snapshot-diff-heading"
                className="font-display text-base font-bold text-zinc-950 dark:text-zinc-50"
              >
                Compare Migration Snapshots
              </h2>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                Inspect added, removed, and updated mods between two saved snapshots.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close snapshot comparison"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Selector bar */}
        <div className="grid gap-3 border-b border-zinc-200 bg-zinc-50/70 px-5 py-3.5 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-950/50">
          <div>
            <label
              htmlFor="diff-base-select"
              className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400"
            >
              Base Snapshot (Before)
            </label>
            <select
              id="diff-base-select"
              value={effectiveBase.id}
              onChange={(e) => setBaseId(e.target.value)}
              className="mt-1 min-h-9 w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-xs text-zinc-950 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.gameVersion} · {formatLoaderName(s.loader)} · {s.summary.total} mods)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="diff-target-select"
              className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400"
            >
              Target Snapshot (After)
            </label>
            <select
              id="diff-target-select"
              value={effectiveTarget.id}
              onChange={(e) => setTargetId(e.target.value)}
              className="mt-1 min-h-9 w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-xs text-zinc-950 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.gameVersion} · {formatLoaderName(s.loader)} · {s.summary.total} mods)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Summary & filter strip */}
        <div className="flex flex-col gap-3 border-b border-zinc-200 px-5 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                {
                  id: 'all',
                  label: `All (${report.added.length + report.removed.length + report.updated.length + report.unchanged.length})`,
                },
                { id: 'added', label: `Added (${report.added.length})` },
                { id: 'removed', label: `Removed (${report.removed.length})` },
                { id: 'updated', label: `Changed (${report.updated.length})` },
                { id: 'unchanged', label: `Same (${report.unchanged.length})` },
              ] as const
            ).map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950'
                      : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-56">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Filter mods..."
              aria-label="Filter comparison entries"
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-2.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>
        </div>

        {/* Entries list */}
        <div className="flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <p className="p-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
              No mods match the selected diff filter.
            </p>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Mod</th>
                  <th scope="col" className="px-5 py-2.5 font-medium">Version Comparison</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {entries.map((entry) => (
                  <tr key={`${entry.change}-${entry.key}`}>
                    <td className="px-5 py-2.5 whitespace-nowrap font-medium">
                      {entry.change === 'added' ? (
                        <span className="text-emerald-700 dark:text-emerald-400">+ Added</span>
                      ) : entry.change === 'removed' ? (
                        <span className="text-red-700 dark:text-red-400">- Removed</span>
                      ) : entry.change === 'updated' ? (
                        <span className="text-amber-700 dark:text-amber-400">~ Changed</span>
                      ) : (
                        <span className="text-zinc-500 dark:text-zinc-400">= Same</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-zinc-950 dark:text-zinc-100">
                      {entry.title}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                      {entry.change === 'added' ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          {entry.targetVersion}
                        </span>
                      ) : entry.change === 'removed' ? (
                        <span className="line-through opacity-75">{entry.baseVersion}</span>
                      ) : entry.change === 'updated' ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span>{entry.baseVersion}</span>
                          <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="text-zinc-950 dark:text-zinc-100">
                            {entry.targetVersion}
                          </span>
                        </span>
                      ) : (
                        <span>{entry.targetVersion}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
