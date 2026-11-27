import type {
  MigrationProgress,
  MigrationTargetConfig,
  ModMigrationResult,
  ModrinthProject,
  ModrinthVersion,
  ResolvedDependency,
} from '../types/migration';
import { formatLoaderName, getModrinthProjectUrl } from '../utils/format';
import { pickTargetJarFile, selectPreferredVersion } from './migrationEngine';
import type { IModProvider } from './providers/modProvider';
import { ModrinthApiError, modrinthClient } from './providers/modrinthClient';

const MAX_DEPENDENCY_DEPTH = 3;

interface RawDepAggregate {
  key: string;
  projectId: string | null;
  versionId: string | null;
  dependencyType: 'required' | 'optional' | 'incompatible' | 'embedded';
  requiredBy: Map<string, string>;
  depth: number;
}

const SEVERITY_ORDER: Record<RawDepAggregate['dependencyType'], number> = {
  required: 4,
  incompatible: 3,
  optional: 2,
  embedded: 1,
};

export interface ResolveDependenciesOptions {
  provider?: IModProvider;
  signal?: AbortSignal;
  onProgress?: (progress: MigrationProgress) => void;
}

export async function resolveMigrationDependencies(
  results: ModMigrationResult[],
  config: MigrationTargetConfig,
  options: ResolveDependenciesOptions = {},
): Promise<ResolvedDependency[]> {
  const provider = options.provider ?? modrinthClient;
  const { signal, onProgress } = options;

  // Track every Modrinth project_id present anywhere in the user's uploaded collection
  const presentProjectIds = new Set<string>();
  const addedDependencyProjectIds = new Set<string>();

  for (const res of results) {
    const pid = res.project?.id ?? res.sourceVersion?.project_id ?? res.targetVersion?.project_id;
    if (pid) {
      presentProjectIds.add(pid);
      if (res.isDependencyAddition) {
        addedDependencyProjectIds.add(pid);
      }
    }
  }

  const aggregates = new Map<string, RawDepAggregate>();

  const registerDependency = (
    dep: ModrinthVersion['dependencies'][number],
    parentResultId: string,
    parentName: string,
    depth: number,
  ) => {
    if (dep.dependency_type === 'embedded') return;
    if (!dep.project_id && !dep.version_id) return;

    const key = dep.project_id ? `proj:${dep.project_id}` : `ver:${dep.version_id}`;
    const existing = aggregates.get(key);
    if (existing) {
      existing.requiredBy.set(parentResultId, parentName);
      if (SEVERITY_ORDER[dep.dependency_type] > SEVERITY_ORDER[existing.dependencyType]) {
        existing.dependencyType = dep.dependency_type;
      }
      existing.depth = Math.min(existing.depth, depth);
      if (!existing.versionId && dep.version_id) existing.versionId = dep.version_id;
    } else {
      const reqMap = new Map<string, string>();
      reqMap.set(parentResultId, parentName);
      aggregates.set(key, {
        key,
        projectId: dep.project_id,
        versionId: dep.version_id,
        dependencyType: dep.dependency_type,
        requiredBy: reqMap,
        depth,
      });
    }
  };

  for (const res of results) {
    if (!res.targetVersion) continue;
    const modName = res.project?.title ?? res.localFile.name;
    for (const dep of res.targetVersion.dependencies) {
      registerDependency(dep, res.id, modName, 1);
    }
  }

  if (aggregates.size === 0) {
    return [];
  }

  // Resolve any dependencies that only specified version_id without project_id
  for (const agg of aggregates.values()) {
    if (signal?.aborted) throw new ModrinthApiError('Cancelled', 'cancelled');
    if (!agg.projectId && agg.versionId) {
      try {
        const ver = await provider.getVersion(agg.versionId, signal);
        agg.projectId = ver.project_id;
      } catch {
        // Keep null projectId; will be handled gracefully
      }
    }
  }

  // Recursive breadth-first expansion for missing required dependencies with cycle detection
  const visitedAncestors = new Map<string, Set<string>>();
  for (const res of results) {
    const pid = res.project?.id ?? res.targetVersion?.project_id;
    if (pid) {
      visitedAncestors.set(pid, new Set([pid]));
    }
  }

  const circularProjectIds = new Set<string>();
  const resolvedProjectCache = new Map<string, ModrinthProject>();
  const resolvedVersionCache = new Map<string, ModrinthVersion | null>();
  const lookupErrors = new Map<string, string>();

  const pendingProjectIds = new Set<string>();
  for (const agg of aggregates.values()) {
    if (agg.projectId) pendingProjectIds.add(agg.projectId);
  }

  let processedCount = 0;
  const processedProjects = new Set<string>();

  const processProjectQueue = async (projectIdsToFetch: string[]) => {
    if (projectIdsToFetch.length === 0) return;

    try {
      const projects = await provider.getProjects(projectIdsToFetch, signal);
      for (const p of projects) {
        resolvedProjectCache.set(p.id, p);
      }
    } catch (err) {
      if (err instanceof ModrinthApiError && err.kind === 'cancelled') throw err;
      const msg = err instanceof Error ? err.message : 'Unable to fetch dependency metadata.';
      for (const pid of projectIdsToFetch) {
        lookupErrors.set(pid, msg);
      }
    }

    const versionTasks = projectIdsToFetch.map(async (pid) => {
      if (processedProjects.has(pid)) return;
      processedProjects.add(pid);

      if (signal?.aborted) throw new ModrinthApiError('Cancelled', 'cancelled');

      try {
        const versions = await provider.getProjectVersions(
          pid,
          [config.loader],
          [config.gameVersion],
          signal,
        );
        const preferred = selectPreferredVersion(versions, config.allowPrereleasesDirectly);
        resolvedVersionCache.set(pid, preferred.version ?? null);
      } catch (err) {
        if (err instanceof ModrinthApiError && err.kind === 'cancelled') throw err;
        resolvedVersionCache.set(pid, null);
        lookupErrors.set(
          pid,
          err instanceof Error ? err.message : 'Failed to verify dependency versions on Modrinth.',
        );
      }

      processedCount++;
      onProgress?.({
        phase: 'resolving_dependencies',
        hashedCount: results.length,
        totalCount: results.length,
        queriedBatches: 1,
        totalBatches: 1,
        dependencyCount: aggregates.size,
        resolvedDependencies: processedCount,
        message: `Checking dependency compatibility (${processedCount}/${aggregates.size})...`,
      });
    });

    await Promise.all(versionTasks);
  };

  // Iterate depth levels 1..MAX_DEPENDENCY_DEPTH
  let currentDepth = 1;
  while (currentDepth <= MAX_DEPENDENCY_DEPTH) {
    const batchIds = Array.from(aggregates.values())
      .filter((a) => a.projectId && !processedProjects.has(a.projectId))
      .map((a) => a.projectId!);

    if (batchIds.length === 0) break;
    await processProjectQueue(batchIds);

    if (currentDepth >= MAX_DEPENDENCY_DEPTH) break;

    const nextRound: Array<{ parentPid: string; parentName: string; dep: ModrinthVersion['dependencies'][number] }> = [];
    for (const agg of aggregates.values()) {
      if (!agg.projectId || agg.depth !== currentDepth) continue;
      if (agg.dependencyType !== 'required') continue;

      const ver = resolvedVersionCache.get(agg.projectId);
      if (!ver) continue;

      const projTitle = resolvedProjectCache.get(agg.projectId)?.title ?? agg.projectId;
      for (const childDep of ver.dependencies) {
        if (childDep.dependency_type !== 'required' || !childDep.project_id) continue;

        // Detect cycle: if childDep.project_id is the dependency itself or in ancestor chain
        if (childDep.project_id === agg.projectId) {
          circularProjectIds.add(childDep.project_id);
          continue;
        }
        const parentAncestors = visitedAncestors.get(agg.projectId) ?? new Set([agg.projectId]);
        if (parentAncestors.has(childDep.project_id)) {
          circularProjectIds.add(childDep.project_id);
          continue;
        }
        const childAncestors = new Set(parentAncestors);
        childAncestors.add(childDep.project_id);
        visitedAncestors.set(childDep.project_id, childAncestors);

        nextRound.push({
          parentPid: agg.projectId,
          parentName: projTitle,
          dep: childDep,
        });
      }
    }

    for (const item of nextRound) {
      registerDependency(
        item.dep,
        `dep:${item.parentPid}`,
        item.parentName,
        currentDepth + 1,
      );
    }

    currentDepth++;
  }

  const resolvedList: ResolvedDependency[] = [];

  for (const agg of aggregates.values()) {
    const pid = agg.projectId;
    const project = pid ? resolvedProjectCache.get(pid) : undefined;
    const targetVersion = pid ? resolvedVersionCache.get(pid) ?? undefined : undefined;
    const targetFile = targetVersion ? pickTargetJarFile(targetVersion).file : undefined;
    const lookupError = pid ? lookupErrors.get(pid) : undefined;
    const projectTitle = project?.title ?? (pid || agg.versionId || 'Unknown Dependency');
    const projectUrl = project
      ? getModrinthProjectUrl(project.slug || project.id, project.project_type)
      : pid
        ? getModrinthProjectUrl(pid, 'mod')
        : undefined;

    const requiredBy = Array.from(agg.requiredBy.entries()).map(([resultId, modName]) => ({
      resultId,
      modName,
    }));

    let status: ResolvedDependency['status'];
    let explanation: string;

    if (pid && circularProjectIds.has(pid)) {
      status = 'circular';
      explanation = `Circular dependency reference detected involving ${projectTitle}. Verify compatibility manually.`;
    } else if (agg.dependencyType === 'incompatible') {
      if (pid && presentProjectIds.has(pid)) {
        status = 'incompatible_present';
        explanation = `Marked incompatible with ${requiredBy.map((r) => r.modName).join(', ')}, and is currently in your mod collection.`;
      } else {
        status = 'already_present';
        explanation = `Marked incompatible, and not found in your uploaded mod list.`;
      }
    } else if (pid && addedDependencyProjectIds.has(pid)) {
      status = 'added_to_migration';
      explanation = 'Added to your Ready migration list.';
    } else if (pid && presentProjectIds.has(pid)) {
      status = 'already_present';
      explanation = 'Already included in your uploaded mod collection.';
    } else if (lookupError) {
      status = 'lookup_failed';
      explanation = lookupError;
    } else if (targetVersion && targetFile) {
      status = 'compatible_found';
      explanation = `Compatible ${formatLoaderName(config.loader)} release (${targetVersion.version_number}) available for Minecraft ${config.gameVersion}.`;
    } else {
      status = 'unavailable';
      explanation = `No ${formatLoaderName(config.loader)} release tagged for Minecraft ${config.gameVersion} on Modrinth.`;
    }

    // Skip non-present incompatible items so we only surface actionable incompatibilities
    if (agg.dependencyType === 'incompatible' && status === 'already_present') {
      continue;
    }

    resolvedList.push({
      key: agg.key,
      projectId: pid,
      versionId: agg.versionId,
      projectTitle,
      projectSlug: project?.slug,
      iconUrl: project?.icon_url,
      dependencyType: agg.dependencyType,
      requiredBy,
      status,
      targetVersion,
      targetFile,
      projectUrl,
      explanation,
      errorMessage: lookupError,
      depth: agg.depth,
    });
  }

  // Sort: missing required -> incompatible -> lookup_failed -> unavailable -> added -> already_present -> optional
  const rank = (d: ResolvedDependency): number => {
    if (d.status === 'incompatible_present') return 0;
    if (d.dependencyType === 'required' && d.status === 'compatible_found') return 1;
    if (d.dependencyType === 'required' && d.status === 'unavailable') return 2;
    if (d.status === 'lookup_failed') return 3;
    if (d.status === 'circular') return 4;
    if (d.dependencyType === 'optional' && d.status === 'compatible_found') return 5;
    if (d.status === 'added_to_migration') return 6;
    if (d.status === 'already_present') return 7;
    return 8;
  };

  return resolvedList.sort((a, b) => rank(a) - rank(b));
}
