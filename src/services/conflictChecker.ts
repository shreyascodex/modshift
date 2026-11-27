import type {
  ConflictWarning,
  MigrationTargetConfig,
  ModMigrationResult,
  ResolvedDependency,
} from '../types/migration';
import { formatLoaderName } from '../utils/format';

const FABRIC_API_PROJECT_ID = 'P7dR8mSH';

function hasModMatching(results: ModMigrationResult[], needles: string[]): string[] {
  const matched: string[] = [];
  for (const r of results) {
    const slug = r.project?.slug?.toLowerCase() ?? '';
    const id = r.project?.id?.toLowerCase() ?? '';
    const title = r.project?.title?.toLowerCase() ?? '';
    const filename = r.localFile.name.toLowerCase();
    const hit = needles.some(
      (n) => slug === n || id === n || title.includes(n) || filename.includes(n),
    );
    if (hit) {
      matched.push(r.project?.title ?? r.localFile.name);
    }
  }
  return matched;
}

/**
 * Runs deterministic modpack compatibility and duplicate checks on analyzed migration results.
 */
export function analyzeModConflicts(
  results: ModMigrationResult[],
  dependencies: ResolvedDependency[],
  config: MigrationTargetConfig,
): ConflictWarning[] {
  const warnings: ConflictWarning[] = [];

  // 1. Duplicate Modrinth project IDs across uploaded files
  const projectMap = new Map<string, { title: string; files: string[] }>();
  for (const r of results) {
    if (!r.project?.id || r.isDependencyAddition) continue;
    const entry = projectMap.get(r.project.id) ?? {
      title: r.project.title,
      files: [],
    };
    entry.files.push(r.localFile.name);
    projectMap.set(r.project.id, entry);
  }
  for (const [projId, info] of projectMap.entries()) {
    if (info.files.length > 1) {
      warnings.push({
        id: `dup-proj-${projId}`,
        severity: 'warning',
        title: `Duplicate mod detected: ${info.title}`,
        description: `Multiple local JARs (${info.files.join(', ')}) map to the same Modrinth project. Keep only one version in your mods folder.`,
        affectedMods: info.files,
      });
    }
  }

  // 2. OptiFine vs Sodium / Iris conflict
  const optifineHits = hasModMatching(results, ['optifine', 'optifabric']);
  const sodiumIrisHits = hasModMatching(results, ['sodium', 'iris', 'aanobbmi', 'yl57xq9u']);
  if (optifineHits.length > 0 && sodiumIrisHits.length > 0) {
    warnings.push({
      id: 'conflict-optifine-sodium',
      severity: 'warning',
      title: 'OptiFine conflicts with Sodium / Iris',
      description:
        'OptiFine and OptiFabric are incompatible with Sodium and Iris Shaders. Remove OptiFine to prevent startup crashes.',
      affectedMods: [...optifineHits, ...sodiumIrisHits],
    });
  }

  // 3. Sodium vs Embeddium / Rubidium conflict
  const sodiumOnly = hasModMatching(results, ['sodium', 'aanobbmi']);
  const embeddiumHits = hasModMatching(results, ['embeddium', 'rubidium']);
  if (sodiumOnly.length > 0 && embeddiumHits.length > 0) {
    warnings.push({
      id: 'conflict-sodium-embeddium',
      severity: 'warning',
      title: 'Multiple rendering engines detected (Sodium + Embeddium/Rubidium)',
      description:
        'Only one Sodium-family renderer should be installed at a time.',
      affectedMods: [...sodiumOnly, ...embeddiumHits],
    });
  }

  // 4. Missing Fabric API reminder on Fabric targets
  if (config.loader === 'fabric') {
    const missingFabricApi = dependencies.find(
      (d) =>
        (d.projectId === FABRIC_API_PROJECT_ID || d.projectSlug === 'fabric-api') &&
        d.status === 'compatible_found',
    );
    if (missingFabricApi) {
      warnings.push({
        id: 'missing-fabric-api',
        severity: 'warning',
        title: 'Fabric API is required by mods in your list',
        description: `${missingFabricApi.requiredBy.length} mod${missingFabricApi.requiredBy.length === 1 ? ' requires' : 's require'} Fabric API for Minecraft ${config.gameVersion}, and it is not yet in your Ready list. Add it in the Dependencies section below.`,
        affectedMods: missingFabricApi.requiredBy.map((x) => x.modName),
      });
    }
  }

  // 5. Incompatible loader JAR metadata warning
  const wrongLoaderJars = results.filter(
    (r) =>
      r.category !== 'ready' &&
      r.localFile.jarMetadata?.loaderHint &&
      r.localFile.jarMetadata.loaderHint !== config.loader &&
      !(r.localFile.jarMetadata.loaderHint === 'fabric' && config.loader === 'quilt'),
  );
  if (wrongLoaderJars.length > 0) {
    warnings.push({
      id: 'loader-mismatch-hints',
      severity: 'info',
      title: `${wrongLoaderJars.length} JAR${wrongLoaderJars.length === 1 ? ' was' : 's were'} built for a different mod loader`,
      description: `Embedded mod descriptors indicate some unmatched JARs target another loader rather than ${formatLoaderName(config.loader)}. Check whether a ${formatLoaderName(config.loader)} port or alternative exists on Modrinth.`,
      affectedMods: wrongLoaderJars.slice(0, 6).map((r) => r.localFile.name),
    });
  }

  return warnings;
}
