import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { analyzeModConflicts } from '../services/conflictChecker';
import { resolveMigrationDependencies } from '../services/dependencyResolver';
import { hashModCollection, intakeModFiles } from '../services/hashService';
import { extractJarMetadata } from '../services/jarMetadataService';
import {
  analyzeModCollection,
  buildManualMatchResult,
  isLoaderSupportedForVersion,
} from '../services/migrationEngine';
import { parseMrpackArchive } from '../services/mrpackService';
import { computeCurseForgeFingerprint } from '../services/providers/curseforgeClient';
import type { IModProvider } from '../services/providers/modProvider';
import { ModrinthApiError, ModrinthClient } from '../services/providers/modrinthClient';
import type {
  GameVersionTag,
  LoaderTag,
  MigrationTargetConfig,
  ModLoader,
  ModrinthProject,
  ModrinthSearchHit,
  ModrinthVersion,
} from '../types/migration';

function makeFakeJar(name: string, content: string): File {
  return new File([content], name, { type: 'application/java-archive' });
}

function makeVersion(overrides: Partial<ModrinthVersion> & { id: string; project_id: string }): ModrinthVersion {
  return {
    name: overrides.version_number ?? '1.0.0',
    version_number: '1.0.0',
    date_published: '2026-01-01T00:00:00Z',
    downloads: 1000,
    version_type: 'release',
    files: [
      {
        hashes: { sha1: '0'.repeat(40) },
        url: `https://cdn.modrinth.com/data/${overrides.project_id}/versions/${overrides.id}/mod.jar`,
        filename: `${overrides.project_id}-${overrides.version_number ?? '1.0.0'}.jar`,
        primary: true,
        size: 12345,
      },
    ],
    dependencies: [],
    game_versions: ['1.21.4'],
    loaders: ['fabric'],
    ...overrides,
  };
}

function makeProject(id: string, title: string, project_type = 'mod'): ModrinthProject {
  return {
    id,
    slug: id,
    project_type,
    title,
    description: `${title} description`,
  };
}

class MockProvider implements IModProvider {
  public readonly capabilities = {
    id: 'modrinth' as const,
    displayName: 'Modrinth (Test Fixture)',
    enabled: true,
    requiresBackendCredentials: false,
  };

  public sourceByHash: Record<string, ModrinthVersion> = {};
  public updateByHash: Record<string, ModrinthVersion> = {};
  public projectsById: Record<string, ModrinthProject> = {};
  public versionsByProject: Record<string, ModrinthVersion[]> = {};
  public failHashSet = new Set<string>();
  public failureKind: ModrinthApiError['kind'] = 'rate_limit';

  async getGameVersions(): Promise<GameVersionTag[]> {
    return [{ version: '1.21.4', version_type: 'release', date: '2025-12-01', major: true }];
  }

  async getLoaders(): Promise<LoaderTag[]> {
    return [{ icon: '', name: 'fabric', supported_project_types: ['mod'] }];
  }

  async lookupVersionFilesByHashes(hashes: string[]): Promise<Record<string, ModrinthVersion>> {
    if (hashes.some((h) => this.failHashSet.has(h))) {
      throw new ModrinthApiError('Simulated API failure', this.failureKind, 429);
    }
    const out: Record<string, ModrinthVersion> = {};
    for (const h of hashes) {
      if (this.sourceByHash[h]) out[h] = this.sourceByHash[h];
    }
    return out;
  }

  async findUpdatedVersionsByHashes(hashes: string[]): Promise<Record<string, ModrinthVersion>> {
    if (hashes.some((h) => this.failHashSet.has(h))) {
      throw new ModrinthApiError('Simulated API failure', this.failureKind, 429);
    }
    const out: Record<string, ModrinthVersion> = {};
    for (const h of hashes) {
      if (this.updateByHash[h]) out[h] = this.updateByHash[h];
    }
    return out;
  }

  async getProjects(ids: string[]): Promise<ModrinthProject[]> {
    return ids.map((id) => this.projectsById[id]).filter(Boolean);
  }

  async getProjectVersions(
    idOrSlug: string,
    loaders?: ModLoader[],
    gameVersions?: string[],
  ): Promise<ModrinthVersion[]> {
    const list = this.versionsByProject[idOrSlug] ?? [];
    return list.filter((v) => {
      const loaderOk = !loaders?.length || loaders.some((l) => v.loaders.includes(l));
      const gvOk = !gameVersions?.length || gameVersions.some((g) => v.game_versions.includes(g));
      return loaderOk && gvOk;
    });
  }

  async getVersion(versionId: string): Promise<ModrinthVersion> {
    throw new ModrinthApiError(`Missing version ${versionId}`, 'invalid_response', 404);
  }

  async searchProjects(): Promise<ModrinthSearchHit[]> {
    return [];
  }
}

async function runTests() {
  console.log('1. Testing file intake validation (invalid ext, empty file, duplicates)...');
  const intake = intakeModFiles(
    [
      makeFakeJar('sodium.jar', 'sodium-bytes'),
      makeFakeJar('sodium.jar', 'sodium-bytes'), // duplicate name+size
      makeFakeJar('empty.jar', ''), // 0-byte empty
      new File(['text'], 'readme.txt', { type: 'text/plain' }), // non-jar
    ],
    [],
  );
  assert.equal(intake.accepted.length, 1);
  assert.equal(intake.rejected.length, 3);
  assert.deepEqual(
    intake.rejected.map((r) => r.reason).sort(),
    ['duplicate_file', 'empty_file', 'invalid_extension'],
  );

  console.log('2. Testing 200+ JAR local SHA-1 hashing & exact-hash deduplication...');
  const batch205: File[] = [];
  for (let i = 0; i < 205; i++) {
    batch205.push(makeFakeJar(`mod-${i}.jar`, `unique-jar-payload-${i}`));
  }
  // Same content, different filename -> exact SHA-1 dedupe
  batch205.push(makeFakeJar('mod-0-renamed.jar', 'unique-jar-payload-0'));

  const intake205 = intakeModFiles(batch205, []);
  assert.equal(intake205.accepted.length, 206);

  const hashStart = Date.now();
  const hashOutcome = await hashModCollection(intake205.accepted);
  const hashElapsed = Date.now() - hashStart;
  assert.equal(hashOutcome.cancelled, false);
  assert.equal(hashOutcome.hashedFiles.length, 205);
  assert.equal(hashOutcome.duplicateNotices.length, 1);
  assert.ok(hashOutcome.hashedFiles.every((f) => f.status === 'hashed' && f.sha1?.length === 40));
  console.log(`   Hashed 206 files in ${hashElapsed}ms (deduped to 205 unique hashes).`);

  console.log('3. Testing loader/version compatibility validation...');
  assert.equal(isLoaderSupportedForVersion('neoforge', '1.19.4').supported, false);
  assert.equal(isLoaderSupportedForVersion('neoforge', '1.21.4').supported, true);
  assert.equal(isLoaderSupportedForVersion('fabric', '1.12.2').supported, false);
  assert.equal(isLoaderSupportedForVersion('forge', '1.12.2').supported, true);

  console.log('4. Testing matching categories (ready, no_update, not_found, needs_review, failed)...');
  const provider = new MockProvider();
  const fReady = hashOutcome.hashedFiles[0];
  const fNoUpdate = hashOutcome.hashedFiles[1];
  const fNotFound = hashOutcome.hashedFiles[2];
  const fPrerelease = hashOutcome.hashedFiles[3];
  const fAmbiguous = hashOutcome.hashedFiles[4];
  const fFailed = hashOutcome.hashedFiles[5];

  provider.projectsById['p-ready'] = makeProject('p-ready', 'Sodium');
  provider.projectsById['p-noupdate'] = makeProject('p-noupdate', 'OldMod');
  provider.projectsById['p-pre'] = makeProject('p-pre', 'BetaMod');
  provider.projectsById['p-amb'] = makeProject('p-amb', 'MultiJarMod');
  provider.projectsById['p-dep-missing'] = makeProject('p-dep-missing', 'Fabric API');
  provider.projectsById['p-dep-unavail'] = makeProject('p-dep-unavail', 'MissingLib');
  provider.projectsById['p-dep-cyc-a'] = makeProject('p-dep-cyc-a', 'CycleA');
  provider.projectsById['p-dep-cyc-b'] = makeProject('p-dep-cyc-b', 'CycleB');
  provider.projectsById['p-dep-opt'] = makeProject('p-dep-opt', 'ModMenu');

  provider.sourceByHash[fReady.sha1!] = makeVersion({
    id: 'v-old-1',
    project_id: 'p-ready',
    game_versions: ['1.20.1'],
  });
  provider.updateByHash[fReady.sha1!] = makeVersion({
    id: 'v-new-1',
    project_id: 'p-ready',
    version_number: '0.6.5',
    dependencies: [
      { project_id: 'p-dep-missing', version_id: null, dependency_type: 'required' },
      { project_id: 'p-dep-opt', version_id: null, dependency_type: 'optional' },
      { project_id: 'p-noupdate', version_id: null, dependency_type: 'incompatible' },
    ],
  });

  provider.sourceByHash[fNoUpdate.sha1!] = makeVersion({
    id: 'v-old-2',
    project_id: 'p-noupdate',
    game_versions: ['1.20.4'],
  });

  provider.sourceByHash[fPrerelease.sha1!] = makeVersion({
    id: 'v-old-3',
    project_id: 'p-pre',
    game_versions: ['1.21.1'],
  });
  provider.updateByHash[fPrerelease.sha1!] = makeVersion({
    id: 'v-new-3',
    project_id: 'p-pre',
    version_number: '2.0.0-beta.1',
    version_type: 'beta',
    dependencies: [
      { project_id: 'p-dep-cyc-a', version_id: null, dependency_type: 'required' },
      { project_id: 'p-dep-unavail', version_id: null, dependency_type: 'required' },
    ],
  });

  provider.sourceByHash[fAmbiguous.sha1!] = makeVersion({
    id: 'v-old-4',
    project_id: 'p-amb',
  });
  provider.updateByHash[fAmbiguous.sha1!] = makeVersion({
    id: 'v-new-4',
    project_id: 'p-amb',
    files: [
      {
        hashes: { sha1: 'a'.repeat(40) },
        url: 'https://cdn.modrinth.com/a.jar',
        filename: 'a.jar',
        primary: false,
        size: 100,
      },
      {
        hashes: { sha1: 'b'.repeat(40) },
        url: 'https://cdn.modrinth.com/b.jar',
        filename: 'b.jar',
        primary: false,
        size: 200,
      },
    ],
  });

  provider.failHashSet.add(fFailed.sha1!);

  const config: MigrationTargetConfig = {
    gameVersion: '1.21.4',
    loader: 'fabric',
    includeSnapshots: false,
    allowPrereleasesDirectly: false,
  };

  // Run 5 valid files first, then run fFailed separately to test batch error isolation
  const resultsMain = await analyzeModCollection(
    [fReady, fNoUpdate, fNotFound, fPrerelease, fAmbiguous],
    config,
    { provider },
  );
  const resultsFail = await analyzeModCollection([fFailed], config, { provider });
  const allResults = [...resultsMain, ...resultsFail];

  const byId = new Map(allResults.map((r) => [r.id, r]));
  assert.equal(byId.get(fReady.id)?.category, 'ready');
  assert.equal(byId.get(fNoUpdate.id)?.category, 'no_update');
  assert.equal(byId.get(fNotFound.id)?.category, 'not_found');
  assert.equal(byId.get(fPrerelease.id)?.category, 'needs_review');
  assert.equal(byId.get(fAmbiguous.id)?.category, 'needs_review');
  assert.equal(byId.get(fFailed.id)?.category, 'failed');
  assert.equal(byId.get(fFailed.id)?.errorKind, 'rate_limit');

  // Test manual match builder moves not_found -> needs_review
  const manualMatched = buildManualMatchResult(
    byId.get(fNotFound.id)!,
    provider.projectsById['p-ready'],
    provider.updateByHash[fReady.sha1!],
    config,
  );
  assert.equal(manualMatched.category, 'needs_review');
  assert.equal(manualMatched.addedManually, true);

  console.log('5. Testing dependency resolution (missing, optional, unavailable, incompatible, circular)...');
  provider.versionsByProject['p-dep-missing'] = [
    makeVersion({ id: 'v-fapi', project_id: 'p-dep-missing', version_number: '0.115.0' }),
  ];
  provider.versionsByProject['p-dep-opt'] = [
    makeVersion({ id: 'v-modmenu', project_id: 'p-dep-opt', version_number: '13.0.0' }),
  ];
  provider.versionsByProject['p-dep-unavail'] = [];
  provider.versionsByProject['p-dep-cyc-a'] = [
    makeVersion({
      id: 'v-ca',
      project_id: 'p-dep-cyc-a',
      dependencies: [{ project_id: 'p-dep-cyc-b', version_id: null, dependency_type: 'required' }],
    }),
  ];
  provider.versionsByProject['p-dep-cyc-b'] = [
    makeVersion({
      id: 'v-cb',
      project_id: 'p-dep-cyc-b',
      dependencies: [{ project_id: 'p-dep-cyc-a', version_id: null, dependency_type: 'required' }],
    }),
  ];

  const deps = await resolveMigrationDependencies(allResults, config, { provider });
  const depByProj = new Map(deps.map((d) => [d.projectId, d]));

  assert.equal(depByProj.get('p-dep-missing')?.status, 'compatible_found');
  assert.equal(depByProj.get('p-dep-opt')?.status, 'compatible_found');
  assert.equal(depByProj.get('p-dep-opt')?.dependencyType, 'optional');
  assert.equal(depByProj.get('p-dep-unavail')?.status, 'unavailable');
  assert.equal(depByProj.get('p-noupdate')?.status, 'incompatible_present');
  assert.equal(depByProj.get('p-dep-cyc-a')?.status, 'circular');

  console.log('6. Testing live Modrinth API v2 connectivity & schema validation...');
  const liveClient = new ModrinthClient();
  const liveVersions = await liveClient.getGameVersions();
  assert.ok(liveVersions.length > 50, 'Expected 50+ Minecraft versions from live Modrinth API');
  const liveSearch = await liveClient.searchProjects('sodium', 'fabric', '1.21.4', 5);
  assert.ok(liveSearch.length > 0, 'Expected live search results for Sodium on Modrinth');
  console.log(`   Live Modrinth returned ${liveVersions.length} game versions and ${liveSearch.length} search hits.`);

  console.log('7. Testing CurseForge fingerprint, conflict checker, JAR metadata & .mrpack parser...');
  // Whitespace bytes (tab, LF, CR, space) must be stripped before MurmurHash2 computation
  const cleanBytes = new TextEncoder().encode('hello-modshift').buffer;
  const spacedBytes = new TextEncoder().encode('h e\tl\nl\ro-mod\tshift ').buffer;
  const fpClean = computeCurseForgeFingerprint(cleanBytes);
  const fpSpaced = computeCurseForgeFingerprint(spacedBytes);
  assert.equal(fpClean, fpSpaced);
  assert.ok(fpClean > 0);

  // Conflict warning detection: duplicate project + OptiFine vs Sodium
  const optifineResult = {
    id: 'optifine-res',
    localFile: fNotFound,
    category: 'ready' as const,
    provider: 'Modrinth' as const,
    project: makeProject('optifine-clone', 'OptiFine'),
    explanation: 'test',
  };
  const conflicts = analyzeModConflicts([allResults[0], optifineResult], deps, config);
  assert.ok(conflicts.some((c) => c.id === 'conflict-optifine-sodium'));

  // Embedded JAR metadata extraction (Fabric JSON & NeoForge TOML)
  const fabricJarZip = new JSZip();
  fabricJarZip.file(
    'fabric.mod.json',
    JSON.stringify({ id: 'lithium', name: 'Lithium', version: '0.14.2' }),
  );
  const fabricJarBuf = await fabricJarZip.generateAsync({ type: 'arraybuffer' });
  const fabricMeta = await extractJarMetadata(
    new File([fabricJarBuf], 'lithium.jar', { type: 'application/java-archive' }),
  );
  assert.equal(fabricMeta?.modId, 'lithium');
  assert.equal(fabricMeta?.loaderHint, 'fabric');

  const neoJarZip = new JSZip();
  neoJarZip.file(
    'META-INF/neoforge.mods.toml',
    '[[mods]]\nmodId="jei"\ndisplayName="Just Enough Items"\nversion="19.21.0"\n',
  );
  const neoJarBuf = await neoJarZip.generateAsync({ type: 'arraybuffer' });
  const neoMeta = await extractJarMetadata(
    new File([neoJarBuf], 'jei.jar', { type: 'application/java-archive' }),
  );
  assert.equal(neoMeta?.modId, 'jei');
  assert.equal(neoMeta?.loaderHint, 'neoforge');

  // .mrpack parser (extracts safe mods/*.jar with sha1 and skips unsafe traversal paths)
  const mrpackZip = new JSZip();
  mrpackZip.file(
    'modrinth.index.json',
    JSON.stringify({
      formatVersion: 1,
      name: 'Test Modpack',
      versionId: '1.0.0',
      dependencies: { minecraft: '1.21.4', 'fabric-loader': '0.16.9' },
      files: [
        {
          path: 'mods/sodium.jar',
          hashes: { sha1: 'a'.repeat(40) },
          downloads: ['https://cdn.modrinth.com/sodium.jar'],
          fileSize: 512000,
        },
        {
          path: '../evil.jar',
          hashes: { sha1: 'b'.repeat(40) },
          downloads: ['https://cdn.modrinth.com/evil.jar'],
          fileSize: 100,
        },
      ],
    }),
  );
  const mrpackBuf = await mrpackZip.generateAsync({ type: 'arraybuffer' });
  const mrpackOutcome = await parseMrpackArchive(
    new File([mrpackBuf], 'test-pack.mrpack', { type: 'application/x-modrinth-modpack+zip' }),
  );
  assert.equal(mrpackOutcome.packName, 'Test Modpack');
  assert.equal(mrpackOutcome.detectedMinecraftVersion, '1.21.4');
  assert.equal(mrpackOutcome.detectedLoader, 'fabric');
  assert.equal(mrpackOutcome.files.length, 1);
  assert.equal(mrpackOutcome.skippedCount, 1);

  console.log('ALL QA TESTS PASSED.');
}

runTests().catch((err) => {
  console.error('QA TEST FAILURE:', err);
  process.exit(1);
});
