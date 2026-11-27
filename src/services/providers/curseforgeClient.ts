import type { ModLoader } from '../../types/migration';

export interface CurseForgeMatchedMod {
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

function isWhitespaceByte(b: number): boolean {
  return b === 0x09 || b === 0x0a || b === 0x0d || b === 0x20;
}

/**
 * Computes CurseForge's unsigned 32-bit MurmurHash2 fingerprint (seed = 1),
 * stripping whitespace bytes (0x09, 0x0A, 0x0D, 0x20) prior to hashing.
 */
export function computeCurseForgeFingerprint(buffer: ArrayBuffer): number {
  const bytes = new Uint8Array(buffer);
  let normalizedLength = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (!isWhitespaceByte(bytes[i])) {
      normalizedLength++;
    }
  }

  const m = 0x5bd1e995;
  const r = 24;
  let h = (1 ^ normalizedLength) >>> 0;

  let k = 0;
  let shift = 0;

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (isWhitespaceByte(b)) continue;

    k = (k | (b << shift)) >>> 0;
    shift += 8;
    if (shift === 32) {
      k = Math.imul(k, m) >>> 0;
      k ^= k >>> r;
      k = Math.imul(k, m) >>> 0;
      h = Math.imul(h, m) >>> 0;
      h = (h ^ k) >>> 0;
      k = 0;
      shift = 0;
    }
  }

  if (shift > 0) {
    h = (h ^ k) >>> 0;
    h = Math.imul(h, m) >>> 0;
  }

  h ^= h >>> 13;
  h = Math.imul(h, m) >>> 0;
  h ^= h >>> 15;

  return h >>> 0;
}

export async function getCurseForgeStatus(
  signal?: AbortSignal,
): Promise<{ configured: boolean }> {
  try {
    const res = await fetch('/api/curseforge/status', { signal });
    if (!res.ok) return { configured: false };
    const data = (await res.json()) as { configured?: unknown };
    return { configured: data.configured === true };
  } catch {
    return { configured: false };
  }
}

export async function matchCurseForgeFingerprints(
  fingerprints: number[],
  gameVersion: string,
  loader: ModLoader,
  signal?: AbortSignal,
): Promise<{ configured: boolean; matches: Record<string, CurseForgeMatchedMod> }> {
  if (fingerprints.length === 0) {
    return { configured: false, matches: {} };
  }

  try {
    const res = await fetch('/api/curseforge/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprints, gameVersion, loader }),
      signal,
    });
    if (res.status === 503) {
      return { configured: false, matches: {} };
    }
    if (!res.ok) {
      return { configured: true, matches: {} };
    }
    const data = (await res.json()) as {
      configured?: unknown;
      matches?: Record<string, CurseForgeMatchedMod>;
    };
    return {
      configured: data.configured === true,
      matches: data.matches ?? {},
    };
  } catch {
    return { configured: false, matches: {} };
  }
}
