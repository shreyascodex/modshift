export type ModLoader = 'fabric' | 'forge' | 'neoforge' | 'quilt';

export type ReleaseChannel = 'release' | 'beta' | 'alpha';

export interface GameVersionTag {
  version: string;
  version_type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  date: string;
  major: boolean;
}

export interface LoaderTag {
  icon: string;
  name: string;
  supported_project_types: string[];
}

export interface JarEmbeddedMetadata {
  modId: string;
  name?: string;
  version?: string;
  loaderHint?: ModLoader;
  homepage?: string;
}

export interface LocalModFile {
  id: string;
  file: File;
  name: string;
  relativePath?: string;
  size: number;
  sha1?: string;
  curseforgeFingerprint?: number;
  jarMetadata?: JarEmbeddedMetadata;
  mrpackDownloadUrl?: string;
  status: 'queued' | 'hashing' | 'hashed' | 'error';
  error?: string;
  isLargeFile?: boolean;
}

export interface RejectedFileNotice {
  id: string;
  name: string;
  size: number;
  reason: 'invalid_extension' | 'empty_file' | 'duplicate_file' | 'read_error';
  message: string;
  duplicateOf?: string;
}

export interface ModrinthFileHashes {
  sha512?: string;
  sha1?: string;
}

export interface ModrinthVersionFile {
  hashes: ModrinthFileHashes;
  url: string;
  filename: string;
  primary: boolean;
  size: number;
  file_type?: string | null;
}

export interface ModrinthDependency {
  version_id: string | null;
  project_id: string | null;
  file_name?: string | null;
  dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded';
}

export interface ModrinthVersion {
  id: string;
  project_id: string;
  author_id?: string;
  featured?: boolean;
  name: string;
  version_number: string;
  changelog?: string | null;
  date_published: string;
  downloads: number;
  version_type: ReleaseChannel;
  status?: string;
  files: ModrinthVersionFile[];
  dependencies: ModrinthDependency[];
  game_versions: string[];
  loaders: string[];
}

export interface ModrinthProject {
  id: string;
  slug: string;
  project_type: string;
  title: string;
  description: string;
  icon_url?: string | null;
  client_side?: string;
  server_side?: string;
  loaders?: string[];
  game_versions?: string[];
}

export interface ModrinthSearchHit {
  project_id: string;
  project_type: string;
  slug: string;
  title: string;
  description: string;
  icon_url?: string | null;
  downloads: number;
  versions: string[];
  categories: string[];
  display_categories?: string[];
}

export type MigrationCategory =
  | 'ready'
  | 'no_update'
  | 'not_found'
  | 'needs_review'
  | 'failed';

export type ReviewReason =
  | 'prerelease_only'
  | 'ambiguous_files'
  | 'non_mod_project'
  | 'manual_match'
  | 'incompatible_dependency'
  | 'unverified_metadata'
  | 'metadata_inferred';

export type ErrorKind =
  | 'rate_limit'
  | 'network'
  | 'timeout'
  | 'server_error'
  | 'invalid_response'
  | 'cancelled';

export interface ModMigrationResult {
  id: string;
  localFile: LocalModFile;
  category: MigrationCategory;
  provider: 'Modrinth' | 'CurseForge';
  sourceVersion?: ModrinthVersion;
  project?: ModrinthProject;
  targetVersion?: ModrinthVersion;
  targetFile?: ModrinthVersionFile;
  externalUrl?: string;
  reviewReasons?: ReviewReason[];
  explanation: string;
  errorKind?: ErrorKind;
  errorMessage?: string;
  addedManually?: boolean;
  isDependencyAddition?: boolean;
}

export interface ConflictWarning {
  id: string;
  severity: 'warning' | 'info';
  title: string;
  description: string;
  affectedMods: string[];
}

export type DependencyStatus =
  | 'already_present'
  | 'compatible_found'
  | 'added_to_migration'
  | 'unavailable'
  | 'incompatible_present'
  | 'circular'
  | 'lookup_failed';

export interface ResolvedDependency {
  key: string;
  projectId: string | null;
  versionId: string | null;
  projectTitle: string;
  projectSlug?: string;
  iconUrl?: string | null;
  dependencyType: 'required' | 'optional' | 'incompatible' | 'embedded';
  requiredBy: Array<{ resultId: string; modName: string }>;
  status: DependencyStatus;
  targetVersion?: ModrinthVersion;
  targetFile?: ModrinthVersionFile;
  projectUrl?: string;
  explanation: string;
  errorMessage?: string;
  depth: number;
}

export type BulkDownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed';

export interface BulkDownloadItem {
  resultId: string;
  filename: string;
  projectTitle: string;
  url: string;
  size: number;
  status: BulkDownloadStatus;
  error?: string;
}

export interface MigrationTargetConfig {
  gameVersion: string;
  loader: ModLoader;
  includeSnapshots: boolean;
  allowPrereleasesDirectly: boolean;
}

export interface MigrationProgress {
  phase: 'idle' | 'hashing' | 'querying' | 'resolving_dependencies' | 'completed' | 'cancelled' | 'error';
  hashedCount: number;
  totalCount: number;
  queriedBatches: number;
  totalBatches: number;
  dependencyCount: number;
  resolvedDependencies: number;
  message: string;
}
