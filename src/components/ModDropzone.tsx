import {
  AlertTriangle,
  FileArchive,
  FolderOpen,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LocalModFile, RejectedFileNotice } from '../types/migration';
import { formatBytes } from '../utils/format';

interface ModDropzoneProps {
  files: LocalModFile[];
  rejectedNotices: RejectedFileNotice[];
  mrpackBanner?: {
    packName: string;
    count: number;
    skippedCount: number;
  } | null;
  isImportingMrpack?: boolean;
  disabled?: boolean;
  onFilesAdded: (fileList: FileList | File[]) => void;
  onRemoveFile: (id: string) => void;
  onClearAll: () => void;
  onDismissRejected: () => void;
}

export function ModDropzone({
  files,
  rejectedNotices,
  mrpackBanner = null,
  isImportingMrpack = false,
  disabled = false,
  onFilesAdded,
  onRemoveFile,
  onClearAll,
  onDismissRejected,
}: ModDropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [supportsDirectoryPicker, setSupportsDirectoryPicker] = useState(true);
  const [fileQuery, setFileQuery] = useState('');

  useEffect(() => {
    const input = document.createElement('input');
    const supported = 'webkitdirectory' in input || 'directory' in input;
    setSupportsDirectoryPicker(supported);
    if (folderInputRef.current && supported) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  const totalBytes = useMemo(
    () => files.reduce((sum, item) => sum + item.size, 0),
    [files],
  );

  const filteredFiles = useMemo(() => {
    const q = fileQuery.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, fileQuery]);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesAdded(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  return (
    <section
      aria-labelledby="upload-step-heading"
      className="rounded-xl border border-zinc-200 bg-white p-5 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            Step 1 of 2
          </p>
          <h2
            id="upload-step-heading"
            className="mt-1 font-display text-lg font-semibold text-zinc-950 dark:text-zinc-50"
          >
            Select your existing mod JARs or .mrpack modpack
          </h2>
        </div>

        {files.length > 0 && (
          <div className="flex items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="font-mono tabular-nums">
              {files.length} {files.length === 1 ? 'file' : 'files'} · {formatBytes(totalBytes)}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={onClearAll}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Clear All</span>
            </button>
          </div>
        )}
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-8 text-center transition-colors ${
          isDragging
            ? 'border-emerald-600 bg-emerald-50/70 dark:border-emerald-500 dark:bg-emerald-950/30'
            : 'border-zinc-300 bg-zinc-50/70 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950/50 dark:hover:border-zinc-600'
        } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          <Upload className="h-5 w-5" aria-hidden="true" />
        </div>

        <p className="mt-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Drag and drop <span className="font-mono">.jar</span> mod files or a <span className="font-mono">.mrpack</span> modpack here
        </p>
        <p className="mt-1 max-w-md text-xs text-zinc-500 dark:text-zinc-400">
          Files stay on your device. Local SHA-1 hashes or pre-hashed modrinth.index.json manifests are used to match updates.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            disabled={disabled || isImportingMrpack}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            <FileArchive className="h-4 w-4" aria-hidden="true" />
            <span>
              {isImportingMrpack
                ? 'Reading .mrpack...'
                : files.length > 0
                ? 'Add .jar or .mrpack'
                : 'Select .jar or .mrpack'}
            </span>
          </button>

          {supportsDirectoryPicker && (
            <button
              type="button"
              disabled={disabled || isImportingMrpack}
              onClick={() => folderInputRef.current?.click()}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              <span>Select Mods Folder</span>
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".jar,.mrpack"
          className="hidden"
          aria-label="Select Minecraft mod JAR files or .mrpack modpacks"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onFilesAdded(e.target.files);
            }
            e.target.value = '';
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          aria-label="Select mods folder"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onFilesAdded(e.target.files);
            }
            e.target.value = '';
          }}
        />
      </div>

      {mrpackBanner && (
        <div
          role="status"
          className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          Imported <strong className="font-semibold">{mrpackBanner.count}</strong> pre-hashed mod
          {mrpackBanner.count === 1 ? '' : 's'} from modpack{' '}
          <span className="font-mono font-medium">{mrpackBanner.packName}</span>
          {mrpackBanner.skippedCount > 0
            ? ` (${mrpackBanner.skippedCount} non-mod or duplicate entries skipped).`
            : '.'}
        </div>
      )}

      {rejectedNotices.length > 0 && (
        <div
          role="status"
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <div>
                <p className="font-medium">
                  {rejectedNotices.length} {rejectedNotices.length === 1 ? 'file was' : 'files were'} skipped during validation
                </p>
                <ul className="mt-1.5 space-y-1 text-amber-900/90 dark:text-amber-200/90">
                  {rejectedNotices.slice(0, 5).map((item) => (
                    <li key={item.id} className="break-all">
                      <span className="font-mono">{item.name}</span> — {item.message}
                    </li>
                  ))}
                  {rejectedNotices.length > 5 && (
                    <li>And {rejectedNotices.length - 5} more skipped files.</li>
                  )}
                </ul>
              </div>
            </div>
            <button
              type="button"
              onClick={onDismissRejected}
              aria-label="Dismiss skipped files notice"
              className="rounded p-1 text-amber-800 hover:bg-amber-200/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:text-amber-300 dark:hover:bg-amber-900/50"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-5">
          {files.length > 8 && (
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                <input
                  type="search"
                  value={fileQuery}
                  onChange={(e) => setFileQuery(e.target.value)}
                  placeholder="Filter selected JARs..."
                  aria-label="Filter selected JAR files"
                  className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </div>
              <span className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                Showing {filteredFiles.length} of {files.length}
              </span>
            </div>
          )}

          <div className="max-h-64 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-zinc-50 text-zinc-500 border-b border-zinc-200 dark:bg-zinc-950 dark:text-zinc-400 dark:border-zinc-800">
                <tr>
                  <th scope="col" className="px-3.5 py-2.5 font-medium">
                    Filename
                  </th>
                  <th scope="col" className="px-3.5 py-2.5 font-medium text-right">
                    Size
                  </th>
                  <th scope="col" className="hidden sm:table-cell px-3.5 py-2.5 font-medium">
                    Local Hash
                  </th>
                  <th scope="col" className="px-2.5 py-2.5 font-medium text-right">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {filteredFiles.map((mod) => (
                  <tr
                    key={mod.id}
                    className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40"
                  >
                    <td className="px-3.5 py-2 font-mono text-zinc-900 dark:text-zinc-100">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate max-w-[240px] sm:max-w-[340px]" title={mod.name}>
                          {mod.name}
                        </span>
                        {mod.isLargeFile && (
                          <span className="text-[11px] font-sans text-amber-700 dark:text-amber-400 whitespace-nowrap">
                            · Large file
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3.5 py-2 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                      {formatBytes(mod.size)}
                    </td>
                    <td className="hidden sm:table-cell px-3.5 py-2 font-mono text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                      {mod.status === 'hashed' && mod.sha1
                        ? mod.sha1.slice(0, 10)
                        : mod.status === 'hashing'
                          ? 'Hashing...'
                          : mod.status === 'error'
                            ? 'Error'
                            : 'Pending'}
                    </td>
                    <td className="px-2.5 py-2 text-right">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onRemoveFile(mod.id)}
                        aria-label={`Remove ${mod.name}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
