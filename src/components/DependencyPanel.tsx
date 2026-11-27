import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { triggerDirectDownload } from '../services/downloadService';
import type { ModLoader, ResolvedDependency } from '../types/migration';
import { formatBytes, formatLoaderName } from '../utils/format';

interface DependencyPanelProps {
  dependencies: ResolvedDependency[];
  targetVersion: string;
  targetLoader: ModLoader;
  onAddDependency: (dep: ResolvedDependency) => void;
}

export function DependencyPanel({
  dependencies,
  targetVersion,
  targetLoader,
  onAddDependency,
}: DependencyPanelProps) {
  if (dependencies.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        No external dependencies were reported by Modrinth for your matched target versions.
      </div>
    );
  }

  const actionableCount = dependencies.filter(
    (d) =>
      d.dependencyType === 'required' &&
      (d.status === 'compatible_found' || d.status === 'unavailable' || d.status === 'lookup_failed'),
  ).length;
  const conflictCount = dependencies.filter(
    (d) => d.status === 'incompatible_present',
  ).length;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div>
          <h3 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
            Detected Dependencies
          </h3>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            Cross-checked against your collection for Minecraft {targetVersion} ({formatLoaderName(targetLoader)}).
            Note: Modrinth dependency lists reflect author metadata and do not guarantee runtime compatibility.
          </p>
        </div>
        <div className="text-xs text-zinc-600 tabular-nums dark:text-zinc-400">
          {dependencies.length} total
          {actionableCount > 0 && ` · ${actionableCount} required to review`}
          {conflictCount > 0 && ` · ${conflictCount} conflict${conflictCount === 1 ? '' : 's'}`}
        </div>
      </div>

      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {dependencies.map((dep) => {
          const isAdded = dep.status === 'added_to_migration';
          const isPresent = dep.status === 'already_present';
          const isConflict = dep.status === 'incompatible_present';
          const isCompatibleMissing = dep.status === 'compatible_found';

          return (
            <li
              key={dep.key}
              className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {dep.projectUrl ? (
                    <a
                      href={dep.projectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-sm text-zinc-950 hover:text-emerald-700 hover:underline dark:text-zinc-100 dark:hover:text-emerald-400"
                    >
                      <span>{dep.projectTitle}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="font-medium text-sm text-zinc-950 dark:text-zinc-100">
                      {dep.projectTitle}
                    </span>
                  )}

                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    · {dep.dependencyType === 'required'
                        ? 'Required'
                        : dep.dependencyType === 'optional'
                          ? 'Optional'
                          : 'Incompatible'}
                  </span>

                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    · {formatLoaderName(targetLoader)}
                  </span>

                  {dep.targetVersion && (
                    <span className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
                      · {dep.targetVersion.version_number}
                      {dep.targetFile ? ` (${formatBytes(dep.targetFile.size)})` : ''}
                    </span>
                  )}
                </div>

                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Needed by:{' '}
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">
                    {dep.requiredBy
                      .slice(0, 4)
                      .map((r) => r.modName)
                      .join(', ')}
                    {dep.requiredBy.length > 4
                      ? ` +${dep.requiredBy.length - 4} more`
                      : ''}
                  </span>
                </p>

                <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                  {isConflict ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-red-700 dark:text-red-400">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{dep.explanation}</span>
                    </span>
                  ) : isPresent || isAdded ? (
                    <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{dep.explanation}</span>
                    </span>
                  ) : dep.status === 'circular' || dep.status === 'lookup_failed' ? (
                    <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                      <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{dep.explanation}</span>
                    </span>
                  ) : (
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {dep.explanation}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {isCompatibleMissing && dep.targetFile && (
                  <>
                    <button
                      type="button"
                      onClick={() => onAddDependency(dep)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Add to Migration</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        triggerDirectDownload(dep.targetFile!.url, dep.targetFile!.filename)
                      }
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Download</span>
                    </button>
                  </>
                )}

                {isAdded && (
                  <span className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 whitespace-nowrap dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Added to Ready</span>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
