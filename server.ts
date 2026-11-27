import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const CURSEFORGE_API_BASE = 'https://api.curseforge.com/v1';
const MINECRAFT_GAME_ID = 432;

const LOADER_TO_CF_TYPE: Record<string, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};

function getCurseForgeKey(): string | null {
  const key = process.env.CURSEFORGE_API_KEY?.trim();
  if (!key || key === 'MY_CURSEFORGE_API_KEY') {
    return null;
  }
  return key;
}

interface CurseForgeFile {
  id: number;
  modId: number;
  fileFingerprint?: number;
  displayName: string;
  fileName: string;
  fileDate: string;
  fileLength: number;
  releaseType: number;
  downloadUrl: string | null;
  gameVersions: string[];
}

interface CurseForgeMod {
  id: number;
  name: string;
  slug: string;
  summary: string;
  links?: {
    websiteUrl?: string;
  };
  logo?: {
    thumbnailUrl?: string;
    url?: string;
  };
}

async function fetchCurseForge<T>(
  endpoint: string,
  apiKey: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${CURSEFORGE_API_BASE}${endpoint}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    throw new Error(`CurseForge API responded with HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

async function createApp(): Promise<express.Express> {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.get('/api/curseforge/status', (_req: Request, res: Response) => {
    res.json({ configured: Boolean(getCurseForgeKey()) });
  });

  app.post('/api/curseforge/match', async (req: Request, res: Response) => {
    const apiKey = getCurseForgeKey();
    if (!apiKey) {
      res.status(503).json({
        configured: false,
        error: 'CURSEFORGE_API_KEY is not configured on the server.',
      });
      return;
    }

    const body = req.body as {
      fingerprints?: unknown;
      gameVersion?: unknown;
      loader?: unknown;
    };

    if (!Array.isArray(body?.fingerprints) || body.fingerprints.length === 0) {
      res.status(400).json({ error: 'fingerprints array is required.' });
      return;
    }

    const fingerprints = body.fingerprints
      .slice(0, 50)
      .filter((fp): fp is number => typeof fp === 'number' && Number.isInteger(fp) && fp > 0);

    if (fingerprints.length === 0) {
      res.status(400).json({ error: 'No valid CurseForge fingerprints provided.' });
      return;
    }

    const gameVersion =
      typeof body.gameVersion === 'string' ? body.gameVersion.trim().slice(0, 40) : '';
    const loader =
      typeof body.loader === 'string' ? body.loader.trim().toLowerCase() : '';
    const modLoaderType = LOADER_TO_CF_TYPE[loader];

    try {
      const fpData = await fetchCurseForge<{
        exactMatches: Array<{
          id: number;
          file: CurseForgeFile;
        }>;
      }>(`/fingerprints/${MINECRAFT_GAME_ID}`, apiKey, {
        method: 'POST',
        body: JSON.stringify({ fingerprints }),
      });

      const exactMatches = fpData?.exactMatches ?? [];
      if (exactMatches.length === 0) {
        res.json({ configured: true, matches: {} });
        return;
      }

      const modIds = Array.from(new Set(exactMatches.map((m) => m.file.modId)));
      const mods = await fetchCurseForge<CurseForgeMod[]>('/mods', apiKey, {
        method: 'POST',
        body: JSON.stringify({ modIds }),
      });
      const modMap = new Map<number, CurseForgeMod>();
      for (const m of mods ?? []) {
        modMap.set(m.id, m);
      }

      const results: Record<
        string,
        {
          modId: number;
          name: string;
          slug: string;
          websiteUrl: string;
          iconUrl?: string;
          sourceFileName: string;
          targetFile?: {
            id: number;
            displayName: string;
            fileName: string;
            fileLength: number;
            releaseType: number;
            downloadUrl: string | null;
          };
        }
      > = {};

      for (const match of exactMatches) {
        const mod = modMap.get(match.file.modId);
        if (!mod) continue;

        let targetFile: CurseForgeFile | undefined;
        if (gameVersion) {
          try {
            const params = new URLSearchParams({
              gameVersion,
              pageSize: '10',
            });
            if (modLoaderType) {
              params.set('modLoaderType', String(modLoaderType));
            }
            const files = await fetchCurseForge<CurseForgeFile[]>(
              `/mods/${mod.id}/files?${params.toString()}`,
              apiKey,
            );
            targetFile =
              files.find((f) => f.releaseType === 1) ?? files[0];
          } catch {
            // Keep mod identity even if file listing fails
          }
        }

        const fpKey = match.file?.fileFingerprint;

        if (typeof fpKey === 'number' && fpKey > 0) {
          results[String(fpKey)] = {
            modId: mod.id,
            name: mod.name,
            slug: mod.slug,
            websiteUrl:
              mod.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/mc-mods/${mod.slug}`,
            iconUrl: mod.logo?.thumbnailUrl ?? mod.logo?.url,
            sourceFileName: match.file.fileName,
            targetFile: targetFile
              ? {
                  id: targetFile.id,
                  displayName: targetFile.displayName,
                  fileName: targetFile.fileName,
                  fileLength: targetFile.fileLength,
                  releaseType: targetFile.releaseType,
                  downloadUrl: targetFile.downloadUrl,
                }
              : undefined,
          };
        }
      }

      res.json({ configured: true, matches: results });
    } catch (err) {
      res.status(502).json({
        configured: true,
        error: err instanceof Error ? err.message : 'Failed to query CurseForge API.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    app.use(async (req: Request, res: Response, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      try {
        const indexPath = path.resolve(__dirname, 'index.html');
        const template = fs.readFileSync(indexPath, 'utf-8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (req: Request, res: Response, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  return app;
}

createApp()
  .then((app) => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`ModShift server listening on http://0.0.0.0:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start ModShift server:', err);
    process.exit(1);
  });
