import type {
  JarEmbeddedMetadata,
  LocalModFile,
  MigrationProgress,
  MigrationTargetConfig,
  ModLoader,
  ModMigrationResult,
  ModrinthProject,
  ModrinthVersion,
  ModrinthVersionFile,
  ReviewReason,
} from '../types/migration';
import { formatLoaderName, getModrinthProjectUrl, isJarFilename } from '../utils/format';
import { extractJarMetadata } from './jarMetadataService';
import {
  computeCurseForgeFingerprint,
  getCurseForgeStatus,
  matchCurseForgeFingerprints,
} from './providers/curseforgeClient';
import type { IModProvider } from './providers/modProvider';
import { ModrinthApiError, modrinthClient } from './providers/modrinthClient';

const HASH_BATCH_SIZE = 50;

export function pickTargetJarFile(version: ModrinthVersion): {
  file?: ModrinthVersionFile;
  ambiguous: boolean;
  reason?: string;
} {
  const jarFiles = version.files.filter((f) => isJarFilename(f.filename));
  if (jarFiles.length === 0) {
    if (version.files.length === 1) {
      return {
        file: version.files[0],
        ambiguous: true,
        reason: `Version "${version.version_number}" provides "${version.files[0].filename}" instead of a .jar file.`,
      };
    }
    return {
      ambiguous: true,
      reason: `Version "${version.version_number}" has no .jar download artifact.`,
    };
  }

  if (jarFiles.length === 1) {
    return { file: jarFiles[0], ambiguous: false };
  }

  const primaryJars = jarFiles.filter((f) => f.primary);
  if (primaryJars.length === 1) {
    return { file: primaryJars[0], ambiguous: false };
  }

  return {
    file: jarFiles[0],
    ambiguous: true,
    reason: `Version "${version.version_number}" contains ${jarFiles.length} .jar files without a single primary artifact.`,
  };
}

export function selectPreferredVersion(
  versions: ModrinthVersion[],
  allowPrereleases: boolean,
): { version?: ModrinthVersion; isPrereleaseOnly: boolean } {
  if (versions.length === 0) {
    return { isPrereleaseOnly: false };
  }

  const sorted = [...versions].sort(
    (a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime(),
  );

  const stable = sorted.find((v) => v.version_type === 'release');
  if (stable) {
    return { version: stable, isPrereleaseOnly: false };
  }

  const latestPre = sorted[0];
  return {
    version: latestPre,
    isPrereleaseOnly: !allowPrereleases,
  };
}

function classifyError(err: unknown): { kind: ModMigrationResult['errorKind']; message: string } {
  if (err instanceof ModrinthApiError) {
    return { kind: err.kind, message: err.message };
  }
  return {
    kind: 'network',
    message: err instanceof Error ? err.message : 'Unexpected error querying Modrinth.',
  };
}

function buildMatchedResult(
  localFile: LocalModFile,
  sourceVersion: ModrinthVersion,
  targetVersion: ModrinthVersion,
  project: ModrinthProject | undefined,
  config: MigrationTargetConfig,
): ModMigrationResult {
  const reviewReasons: ReviewReason[] = [];
  const explanationNotes: string[] = [];

  const filePick = pickTargetJarFile(targetVersion);
  if (filePick.ambiguous) {
    reviewReasons.push('ambiguous_files');
    if (filePick.reason) explanationNotes.push(filePick.reason);
  }

  if (project && project.project_type !== 'mod') {
    reviewReasons.push('non_mod_project');
    explanationNotes.push(
      `Listed on Modrinth as project type "${project.project_type}" rather than "mod".`,
    );
  }

  if (targetVersion.version_type !== 'release' && !config.allowPrereleasesDirectly) {
    reviewReasons.push('prerelease_only');
    explanationNotes.push(
      `Only a ${targetVersion.version_type} release (${targetVersion.version_number}) was found for Minecraft ${config.gameVersion} (${formatLoaderName(config.loader)}). Verify stability before installing.`,
    );
  }

  const loaderConfirmed = targetVersion.loaders.some(
    (l) => l.toLowerCase() === config.loader.toLowerCase(),
  );
  const mcConfirmed = targetVersion.game_versions.includes(config.gameVersion);
  if (!loaderConfirmed || !mcConfirmed) {
    reviewReasons.push('unverified_metadata');
    explanationNotes.push('Returned version metadata did not explicitly list the exact target loader and version.');
  }

  if (reviewReasons.length > 0) {
    return {
      id: localFile.id,
      localFile,
      category: 'needs_review',
      provider: 'Modrinth',
      sourceVersion,
      project,
      targetVersion,
      targetFile: filePick.file,
      reviewReasons,
      explanation: explanationNotes.join(' '),
    };
  }

  return {
    id: localFile.id,
    localFile,
    category: 'ready',
    provider: 'Modrinth',
    sourceVersion,
    project,
    targetVersion,
    targetFile: filePick.file,
    explanation: `Verified ${formatLoaderName(config.loader)} release for Minecraft ${config.gameVersion}.`,
  };
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function scoreModrinthCandidate(
  meta: JarEmbeddedMetadata,
  hit: { slug: string; title: string; downloads: number },
): number {
  const idNorm = normalizeToken(meta.modId);
  const nameNorm = normalizeToken(meta.name ?? meta.modId);
  const slugNorm = normalizeToken(hit.slug);
  const titleNorm = normalizeToken(hit.title);

  let score = 0;
  if (slugNorm === idNorm) score += 100;
  else if (slugNorm.includes(idNorm) || idNorm.includes(slugNorm)) score += 50;

  if (titleNorm === nameNorm || titleNorm === idNorm) score += 80;
  else if (titleNorm.includes(nameNorm) || nameNorm.includes(titleNorm)) score += 35;

  if (hit.downloads > 100000) score += 10;
  return score;
}

export interface RunMigrationOptions {
  provider?: IModProvider;
  signal?: AbortSignal;
  enableCurseForgeFallback?: boolean;
  enableMetadataFallback?: boolean;
  onProgress?: (progress: MigrationProgress) => void;
  onPartialResults?: (results: ModMigrationResult[]) => void;
}

export async function analyzeModCollection(
  hashedFiles: LocalModFile[],
  config: MigrationTargetConfig,
  options: RunMigrationOptions = {},
): Promise<ModMigrationResult[]> {
  const provider = options.provider ?? modrinthClient;
  const enableCurseForgeFallback = options.enableCurseForgeFallback ?? !options.provider;
  const enableMetadataFallback = options.enableMetadataFallback ?? !options.provider;
  const { signal, onProgress, onPartialResults } = options;

  const resultMap = new Map<string, ModMigrationResult>();
  const queryableFiles: LocalModFile[] = [];

  for (const file of hashedFiles) {
    if (file.status === 'error' || !file.sha1) {
      resultMap.set(file.id, {
        id: file.id,
        localFile: file,
        category: 'failed',
        provider: 'Modrinth',
        errorKind: 'invalid_response',
        errorMessage: file.error || 'Could not calculate local SHA-1 hash for this file.',
        explanation: file.error || 'Local file read or hash calculation failed.',
      });
    } else {
      queryableFiles.push(file);
    }
  }

  // Deduplicate hashes when querying API (in case caller bypassed hashService dedupe)
  const hashToFiles = new Map<string, LocalModFile[]>();
  for (const file of queryableFiles) {
    const sha1 = file.sha1!;
    const arr = hashToFiles.get(sha1) ?? [];
    arr.push(file);
    hashToFiles.set(sha1, arr);
  }

  const uniqueHashes = Array.from(hashToFiles.keys());
  const batches: string[][] = [];
  for (let i = 0; i < uniqueHashes.length; i += HASH_BATCH_SIZE) {
    batches.push(uniqueHashes.slice(i, i + HASH_BATCH_SIZE));
  }

  const totalBatches = batches.length;
  let completedBatches = 0;

  onProgress?.({
    phase: 'querying',
    hashedCount: hashedFiles.length,
    totalCount: hashedFiles.length,
    queriedBatches: 0,
    totalBatches,
    dependencyCount: 0,
    resolvedDependencies: 0,
    message:
      totalBatches === 0
        ? 'No valid hashes to query.'
        : `Looking up ${uniqueHashes.length} unique mod hashes across ${totalBatches} Modrinth batch${totalBatches === 1 ? '' : 'es'}...`,
  });

  for (const batchHashes of batches) {
    if (signal?.aborted) {
      throw new ModrinthApiError('Migration analysis was cancelled.', 'cancelled');
    }

    let sourceVersionsByHash: Record<string, ModrinthVersion> = {};
    let updatedVersionsByHash: Record<string, ModrinthVersion> = {};
    let batchError: { kind: ModMigrationResult['errorKind']; message: string } | null = null;

    try {
      const [foundSources, foundUpdates] = await Promise.all([
        provider.lookupVersionFilesByHashes(batchHashes, 'sha1', signal),
        provider.findUpdatedVersionsByHashes(
          batchHashes,
          'sha1',
          [config.loader],
          [config.gameVersion],
          signal,
        ),
      ]);
      sourceVersionsByHash = foundSources;
      updatedVersionsByHash = foundUpdates;
    } catch (err) {
      if (err instanceof ModrinthApiError && err.kind === 'cancelled') {
        throw err;
      }
      batchError = classifyError(err);
    }

    if (batchError) {
      for (const h of batchHashes) {
        for (const localFile of hashToFiles.get(h) ?? []) {
          resultMap.set(localFile.id, {
            id: localFile.id,
            localFile,
            category: 'failed',
            provider: 'Modrinth',
            errorKind: batchError.kind,
            errorMessage: batchError.message,
            explanation: batchError.message,
          });
        }
      }
    } else {
      const projectIds = new Set<string>();
      for (const v of Object.values(sourceVersionsByHash)) {
        projectIds.add(v.project_id);
      }
      for (const v of Object.values(updatedVersionsByHash)) {
        projectIds.add(v.project_id);
      }

      const projectMap = new Map<string, ModrinthProject>();
      let projectLookupWarning: string | undefined;

      if (projectIds.size > 0) {
        try {
          const projects = await provider.getProjects(Array.from(projectIds), signal);
          for (const p of projects) {
            projectMap.set(p.id, p);
          }
        } catch (err) {
          if (err instanceof ModrinthApiError && err.kind === 'cancelled') {
            throw err;
          }
          projectLookupWarning =
            err instanceof Error ? err.message : 'Unable to load project metadata from Modrinth.';
        }
      }

      for (const h of batchHashes) {
        const sourceVersion = sourceVersionsByHash[h];
        const targetVersion = updatedVersionsByHash[h];
        const localFiles = hashToFiles.get(h) ?? [];

        for (const localFile of localFiles) {
          if (!sourceVersion) {
            resultMap.set(localFile.id, {
              id: localFile.id,
              localFile,
              category: 'not_found',
              provider: 'Modrinth',
              explanation:
                'This file hash was not found on Modrinth. It may come from CurseForge, a custom build, or an unlisted mod.',
            });
            continue;
          }

          const project = projectMap.get(sourceVersion.project_id);

          if (targetVersion) {
            let chosenTarget = targetVersion;
            if (!config.allowPrereleasesDirectly && targetVersion.version_type !== 'release') {
              try {
                const candidates = await provider.getProjectVersions(
                  sourceVersion.project_id,
                  [config.loader],
                  [config.gameVersion],
                  signal,
                );
                const preferred = selectPreferredVersion(candidates, false);
                if (preferred.version) {
                  chosenTarget = preferred.version;
                }
              } catch {
                // Keep original targetVersion if secondary check fails
              }
            }

            const matched = buildMatchedResult(
              localFile,
              sourceVersion,
              chosenTarget,
              project,
              config,
            );
            if (!project && projectLookupWarning && matched.category === 'ready') {
              matched.reviewReasons = ['unverified_metadata'];
              matched.category = 'needs_review';
              matched.explanation = `${matched.explanation} (${projectLookupWarning})`;
            }
            resultMap.set(localFile.id, matched);
          } else {
            const currentMc =
              sourceVersion.game_versions.length > 0
                ? sourceVersion.game_versions.slice(0, 3).join(', ')
                : 'unknown version';
            const modTitle = project?.title ?? sourceVersion.name;
            resultMap.set(localFile.id, {
              id: localFile.id,
              localFile,
              category: 'no_update',
              provider: 'Modrinth',
              sourceVersion,
              project,
              explanation: `${modTitle} was identified (built for ${currentMc}), but has no ${formatLoaderName(config.loader)} release tagged for Minecraft ${config.gameVersion} on Modrinth.`,
            });
          }
        }
      }
    }

    completedBatches++;
    const orderedPartial = hashedFiles
      .map((f) => resultMap.get(f.id))
      .filter((r): r is ModMigrationResult => Boolean(r));
    onPartialResults?.(orderedPartial);
    onProgress?.({
      phase: 'querying',
      hashedCount: hashedFiles.length,
      totalCount: hashedFiles.length,
      queriedBatches: completedBatches,
      totalBatches,
      dependencyCount: 0,
      resolvedDependencies: 0,
      message: `Processed batch ${completedBatches} of ${totalBatches}...`,
    });
  }

  // Fallback pass for unmatched files:
  // 1) CurseForge fingerprint proxy (if server API key configured)
  // 2) Embedded JAR metadata extraction -> Modrinth slug/title match
  const unmatchedResults = Array.from(resultMap.values()).filter(
    (r) => r.category === 'not_found' && r.localFile.file.size > 0,
  );

  if (unmatchedResults.length > 0 && (enableCurseForgeFallback || enableMetadataFallback)) {
    if (enableCurseForgeFallback && !signal?.aborted) {
      try {
        const cfStatus = await getCurseForgeStatus(signal);
        if (cfStatus.configured) {
          onProgress?.({
            phase: 'querying',
            hashedCount: hashedFiles.length,
            totalCount: hashedFiles.length,
            queriedBatches: totalBatches,
            totalBatches,
            dependencyCount: 0,
            resolvedDependencies: 0,
            message: `Checking ${unmatchedResults.length} unmatched mods against CurseForge...`,
          });

          const fpToResults = new Map<number, ModMigrationResult[]>();
          for (const res of unmatchedResults) {
            if (signal?.aborted) break;
            try {
              const buf = await res.localFile.file.arrayBuffer();
              const fp = computeCurseForgeFingerprint(buf);
              res.localFile = { ...res.localFile, curseforgeFingerprint: fp };
              const list = fpToResults.get(fp) ?? [];
              list.push(res);
              fpToResults.set(fp, list);
            } catch {
              // Skip unreadable file for CF fingerprint
            }
          }

          const fps = Array.from(fpToResults.keys());
          for (let i = 0; i < fps.length; i += 50) {
            if (signal?.aborted) break;
            const chunk = fps.slice(i, i + 50);
            const cfResp = await matchCurseForgeFingerprints(
              chunk,
              config.gameVersion,
              config.loader,
              signal,
            );
            for (const fp of chunk) {
              const cfMatch = cfResp.matches[String(fp)];
              if (!cfMatch) continue;
              for (const orig of fpToResults.get(fp) ?? []) {
                const target = cfMatch.targetFile;
                const syntheticProject: ModrinthProject = {
                  id: `cf-${cfMatch.modId}`,
                  slug: cfMatch.slug,
                  project_type: 'mod',
                  title: cfMatch.name,
                  description: `CurseForge project ${cfMatch.name}`,
                  icon_url: cfMatch.iconUrl ?? null,
                };
                if (target && target.downloadUrl) {
                  const isPre = target.releaseType !== 1 && !config.allowPrereleasesDirectly;
                  const synthVersion: ModrinthVersion = {
                    id: `cf-file-${target.id}`,
                    project_id: syntheticProject.id,
                    name: target.displayName,
                    version_number: target.displayName,
                    date_published: '',
                    downloads: 0,
                    version_type: target.releaseType === 1 ? 'release' : target.releaseType === 2 ? 'beta' : 'alpha',
                    files: [
                      {
                        hashes: {},
                        url: target.downloadUrl,
                        filename: target.fileName,
                        primary: true,
                        size: target.fileLength,
                      },
                    ],
                    dependencies: [],
                    game_versions: [config.gameVersion],
                    loaders: [config.loader],
                  };
                  resultMap.set(orig.id, {
                    ...orig,
                    category: isPre ? 'needs_review' : 'ready',
                    provider: 'CurseForge',
                    project: syntheticProject,
                    targetVersion: synthVersion,
                    targetFile: synthVersion.files[0],
                    externalUrl: cfMatch.websiteUrl,
                    reviewReasons: isPre ? ['prerelease_only'] : undefined,
                    explanation: isPre
                      ? `Matched on CurseForge (${target.displayName}, pre-release) for Minecraft ${config.gameVersion}.`
                      : `Matched via CurseForge fingerprint for Minecraft ${config.gameVersion} (${formatLoaderName(config.loader)}).`,
                  });
                } else {
                  resultMap.set(orig.id, {
                    ...orig,
                    category: target ? 'needs_review' : 'no_update',
                    provider: 'CurseForge',
                    project: syntheticProject,
                    externalUrl: cfMatch.websiteUrl,
                    reviewReasons: target ? ['unverified_metadata'] : undefined,
                    explanation: target
                      ? `${cfMatch.name} was matched on CurseForge, but third-party direct download is restricted by the mod author. Open the CurseForge page to download.`
                      : `${cfMatch.name} was identified on CurseForge, but has no ${formatLoaderName(config.loader)} file for Minecraft ${config.gameVersion}.`,
                  });
                }
              }
            }
          }
        }
      } catch {
        // CurseForge fallback is optional; continue to metadata inspection
      }
    }

    if (enableMetadataFallback && !signal?.aborted) {
      const stillNotFound = Array.from(resultMap.values()).filter(
        (r) => r.category === 'not_found' && r.localFile.file.size > 0,
      );

      if (stillNotFound.length > 0) {
        onProgress?.({
          phase: 'querying',
          hashedCount: hashedFiles.length,
          totalCount: hashedFiles.length,
          queriedBatches: totalBatches,
          totalBatches,
          dependencyCount: 0,
          resolvedDependencies: 0,
          message: `Inspecting embedded JAR metadata for ${stillNotFound.length} remaining mod${stillNotFound.length === 1 ? '' : 's'}...`,
        });

        for (const orig of stillNotFound) {
          if (signal?.aborted) break;
          try {
            const meta = await extractJarMetadata(orig.localFile.file);
            if (!meta) continue;

            const updatedLocal: LocalModFile = { ...orig.localFile, jarMetadata: meta };
            const searchTerm = meta.name || meta.modId;
            const hits = await provider.searchProjects(
              searchTerm,
              config.loader,
              config.gameVersion,
              5,
              signal,
            );
            const ranked = [...hits]
              .map((hit) => ({ hit, score: scoreModrinthCandidate(meta, hit) }))
              .sort((a, b) => b.score - a.score);

            const best = ranked[0];
            if (!best || best.score < 50) {
              resultMap.set(orig.id, {
                ...orig,
                localFile: updatedLocal,
                explanation: `Not found by hash. Embedded JAR metadata identified mod ID "${meta.modId}"${meta.loaderHint ? ` (${formatLoaderName(meta.loaderHint)})` : ''}; use Search Manually to confirm.`,
              });
              continue;
            }

            const [projects, versions] = await Promise.all([
              provider.getProjects([best.hit.project_id], signal),
              provider.getProjectVersions(
                best.hit.project_id,
                [config.loader],
                [config.gameVersion],
                signal,
              ),
            ]);
            const preferred = selectPreferredVersion(
              versions,
              config.allowPrereleasesDirectly,
            );
            if (!preferred.version) {
              resultMap.set(orig.id, {
                ...orig,
                localFile: updatedLocal,
                project: projects[0],
                category: 'no_update',
                explanation: `Matched via embedded JAR ID "${meta.modId}" to ${best.hit.title}, which has no ${formatLoaderName(config.loader)} release for Minecraft ${config.gameVersion}.`,
              });
              continue;
            }

            const filePick = pickTargetJarFile(preferred.version);
            const reviewReasons: ReviewReason[] = ['metadata_inferred'];
            if (filePick.ambiguous) reviewReasons.push('ambiguous_files');
            if (preferred.isPrereleaseOnly) reviewReasons.push('prerelease_only');

            resultMap.set(orig.id, {
              ...orig,
              localFile: updatedLocal,
              category: 'needs_review',
              provider: 'Modrinth',
              project: projects[0] ?? {
                id: best.hit.project_id,
                slug: best.hit.slug,
                project_type: best.hit.project_type,
                title: best.hit.title,
                description: best.hit.description,
                icon_url: best.hit.icon_url,
              },
              targetVersion: preferred.version,
              targetFile: filePick.file,
              reviewReasons,
              explanation: `Matched by embedded JAR metadata (ID "${meta.modId}") rather than exact SHA-1 hash. Verify "${best.hit.title}" (${preferred.version.version_number}) before downloading.`,
            });
          } catch {
            // Leave as not_found if metadata fallback fails
          }
        }
      }
    }
  }

  return hashedFiles
    .map((f) => resultMap.get(f.id))
    .filter((r): r is ModMigrationResult => Boolean(r));
}

export function isLoaderSupportedForVersion(
  loader: ModLoader,
  gameVersion: string,
): { supported: boolean; reason?: string } {
  if (!gameVersion) {
    return { supported: true };
  }

  if (loader === 'neoforge') {
    const match = /^1\.(\d+)(?:\.(\d+))?/.exec(gameVersion);
    if (match) {
      const minor = Number(match[1]);
      const patch = match[2] ? Number(match[2]) : 0;
      if (minor < 20 || (minor === 20 && patch < 1)) {
        return {
          supported: false,
          reason: `NeoForge does not support Minecraft ${gameVersion}. Choose Forge for 1.20.0 and earlier, or select Minecraft 1.20.1+.`,
        };
      }
    }
  }

  if (loader === 'quilt') {
    const match = /^1\.(\d+)/.exec(gameVersion);
    if (match && Number(match[1]) < 14) {
      return {
        supported: false,
        reason: `Quilt is not available for Minecraft ${gameVersion} (Quilt supports modern versions 1.14+).`,
      };
    }
  }

  if (loader === 'fabric') {
    const match = /^1\.(\d+)/.exec(gameVersion);
    if (match && Number(match[1]) < 14) {
      return {
        supported: false,
        reason: `Fabric officially starts at Minecraft 1.14+. Use Forge for Minecraft ${gameVersion}.`,
      };
    }
  }

  return { supported: true };
}

export function buildManualMatchResult(
  originalResult: ModMigrationResult,
  project: ModrinthProject,
  selectedVersion: ModrinthVersion,
  config: MigrationTargetConfig,
): ModMigrationResult {
  const filePick = pickTargetJarFile(selectedVersion);
  const reviewReasons: ReviewReason[] = ['manual_match'];
  const notes: string[] = [
    `Manually matched to "${project.title}" (${selectedVersion.version_number}) via Modrinth search rather than file hash verification.`,
  ];

  if (filePick.ambiguous && filePick.reason) {
    reviewReasons.push('ambiguous_files');
    notes.push(filePick.reason);
  }
  if (selectedVersion.version_type !== 'release' && !config.allowPrereleasesDirectly) {
    reviewReasons.push('prerelease_only');
    notes.push(`This is a ${selectedVersion.version_type} release.`);
  }

  return {
    ...originalResult,
    category: 'needs_review',
    project,
    targetVersion: selectedVersion,
    targetFile: filePick.file,
    reviewReasons,
    addedManually: true,
    explanation: notes.join(' '),
  };
}

export function getResultProjectLink(result: ModMigrationResult): string | undefined {
  if (result.externalUrl) {
    return result.externalUrl;
  }
  if (result.project && !result.project.id.startsWith('cf-')) {
    return getModrinthProjectUrl(result.project.slug || result.project.id, result.project.project_type);
  }
  if (result.sourceVersion) {
    return getModrinthProjectLinkFallback(result.sourceVersion.project_id);
  }
  return undefined;
}

function getModrinthProjectLinkFallback(projectId: string): string {
  return getModrinthProjectUrl(projectId, 'mod');
}
