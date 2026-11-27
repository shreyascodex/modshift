import type {
  GameVersionTag,
  LoaderTag,
  ModLoader,
  ModrinthProject,
  ModrinthSearchHit,
  ModrinthVersion,
} from '../../types/migration';

export interface ModProviderCapabilities {
  id: 'modrinth' | 'curseforge';
  displayName: string;
  enabled: boolean;
  requiresBackendCredentials: boolean;
  statusNote?: string;
}

export interface IModProvider {
  readonly capabilities: ModProviderCapabilities;
  getGameVersions(signal?: AbortSignal): Promise<GameVersionTag[]>;
  getLoaders(signal?: AbortSignal): Promise<LoaderTag[]>;
  lookupVersionFilesByHashes(
    hashes: string[],
    algorithm: 'sha1' | 'sha512',
    signal?: AbortSignal,
  ): Promise<Record<string, ModrinthVersion>>;
  findUpdatedVersionsByHashes(
    hashes: string[],
    algorithm: 'sha1' | 'sha512',
    loaders: ModLoader[],
    gameVersions: string[],
    signal?: AbortSignal,
  ): Promise<Record<string, ModrinthVersion>>;
  getProjects(ids: string[], signal?: AbortSignal): Promise<ModrinthProject[]>;
  getProjectVersions(
    idOrSlug: string,
    loaders?: ModLoader[],
    gameVersions?: string[],
    signal?: AbortSignal,
  ): Promise<ModrinthVersion[]>;
  getVersion(versionId: string, signal?: AbortSignal): Promise<ModrinthVersion>;
  searchProjects(
    query: string,
    loader?: ModLoader,
    gameVersion?: string,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<ModrinthSearchHit[]>;
}

/**
 * Architectural boundary reserved for future CurseForge integration.
 * Intentionally unimplemented in this browser-only release because CurseForge
 * requires an approved API key (which cannot be exposed in client JS) and
 * third-party distribution permissions.
 */
export const CURSEFORGE_PROVIDER_BOUNDARY: ModProviderCapabilities = {
  id: 'curseforge',
  displayName: 'CurseForge',
  enabled: false,
  requiresBackendCredentials: true,
  statusNote:
    'Unavailable in browser-only beta: requires an approved CurseForge API key via a backend proxy and mod-author distribution clearance.',
};
