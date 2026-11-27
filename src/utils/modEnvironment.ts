import type {
  SavedMigrationItemSnapshot,
  SavedMigrationRecord,
} from '../services/savedMigrationsService';
import type { ModMigrationResult } from '../types/migration';

export type EnvironmentFilter = 'all' | 'server_compatible' | 'client_only';
export type ModEnvironmentTag = 'server_client' | 'server_only' | 'client_only' | 'unknown';

export function classifyModEnvironment(project?: {
  client_side?: string;
  server_side?: string;
}): ModEnvironmentTag {
  if (!project) return 'unknown';
  const client = project.client_side;
  const server = project.server_side;

  if (server === 'unsupported' && (client === 'required' || client === 'optional')) {
    return 'client_only';
  }
  if (client === 'unsupported' && (server === 'required' || server === 'optional')) {
    return 'server_only';
  }
  if (
    (client === 'required' || client === 'optional') &&
    (server === 'required' || server === 'optional')
  ) {
    return 'server_client';
  }
  return 'unknown';
}

export function getModEnvironmentLabel(tag: ModEnvironmentTag): string {
  switch (tag) {
    case 'client_only':
      return 'Client Only';
    case 'server_only':
      return 'Server Only';
    case 'server_client':
      return 'Client + Server';
    case 'unknown':
    default:
      return 'Unknown Env';
  }
}

export function isServerCompatible(project?: {
  client_side?: string;
  server_side?: string;
}): boolean {
  return project?.server_side !== 'unsupported';
}

export function matchesEnvironmentFilter(
  project: { client_side?: string; server_side?: string } | undefined,
  filter: EnvironmentFilter,
): boolean {
  if (filter === 'all') return true;
  const tag = classifyModEnvironment(project);
  if (filter === 'client_only') {
    return tag === 'client_only';
  }
  return tag !== 'client_only';
}

export function isServerCompatibleResult(result: ModMigrationResult): boolean {
  return isServerCompatible(result.project);
}

export interface SnapshotDiffEntry {
  key: string;
  title: string;
  change: 'added' | 'removed' | 'updated' | 'unchanged';
  baseVersion?: string | null;
  targetVersion?: string | null;
  baseCategory?: string;
  targetCategory?: string;
}

export interface SnapshotDiffReport {
  added: SnapshotDiffEntry[];
  removed: SnapshotDiffEntry[];
  updated: SnapshotDiffEntry[];
  unchanged: SnapshotDiffEntry[];
}

function getItemKey(item: SavedMigrationItemSnapshot): string {
  if (item.projectId) return `pid:${item.projectId}`;
  if (item.projectSlug) return `slug:${item.projectSlug.toLowerCase()}`;
  return `file:${item.originalFilename.toLowerCase().replace(/[-_\d.]+(?=\.jar$)/i, '')}`;
}

function getItemTitle(item: SavedMigrationItemSnapshot): string {
  return item.projectTitle || item.originalFilename;
}

function getItemVersionLabel(item: SavedMigrationItemSnapshot): string {
  return item.targetVersionNumber || item.targetFilename || item.originalFilename;
}

export function computeSnapshotDiff(
  base: SavedMigrationRecord,
  target: SavedMigrationRecord,
): SnapshotDiffReport {
  const baseMap = new Map<string, SavedMigrationItemSnapshot>();
  for (const item of base.items) {
    baseMap.set(getItemKey(item), item);
  }

  const targetMap = new Map<string, SavedMigrationItemSnapshot>();
  for (const item of target.items) {
    targetMap.set(getItemKey(item), item);
  }

  const added: SnapshotDiffEntry[] = [];
  const removed: SnapshotDiffEntry[] = [];
  const updated: SnapshotDiffEntry[] = [];
  const unchanged: SnapshotDiffEntry[] = [];

  for (const [key, targetItem] of targetMap.entries()) {
    const baseItem = baseMap.get(key);
    if (!baseItem) {
      added.push({
        key,
        title: getItemTitle(targetItem),
        change: 'added',
        targetVersion: getItemVersionLabel(targetItem),
        targetCategory: targetItem.category,
      });
      continue;
    }

    const baseVer = getItemVersionLabel(baseItem);
    const targetVer = getItemVersionLabel(targetItem);

    if (baseVer !== targetVer || baseItem.category !== targetItem.category) {
      updated.push({
        key,
        title: getItemTitle(targetItem),
        change: 'updated',
        baseVersion: baseVer,
        targetVersion: targetVer,
        baseCategory: baseItem.category,
        targetCategory: targetItem.category,
      });
    } else {
      unchanged.push({
        key,
        title: getItemTitle(targetItem),
        change: 'unchanged',
        baseVersion: baseVer,
        targetVersion: targetVer,
        baseCategory: baseItem.category,
        targetCategory: targetItem.category,
      });
    }
  }

  for (const [key, baseItem] of baseMap.entries()) {
    if (!targetMap.has(key)) {
      removed.push({
        key,
        title: getItemTitle(baseItem),
        change: 'removed',
        baseVersion: getItemVersionLabel(baseItem),
        baseCategory: baseItem.category,
      });
    }
  }

  const byTitle = (a: SnapshotDiffEntry, b: SnapshotDiffEntry) =>
    a.title.localeCompare(b.title);

  added.sort(byTitle);
  removed.sort(byTitle);
  updated.sort(byTitle);
  unchanged.sort(byTitle);

  return { added, removed, updated, unchanged };
}
