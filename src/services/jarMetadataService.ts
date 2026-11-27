import JSZip from 'jszip';
import type { JarEmbeddedMetadata, ModLoader } from '../types/migration';

const MAX_JAR_BYTES = 100 * 1024 * 1024;
const MAX_METADATA_ENTRY_CHARS = 256 * 1024;

function cleanMetaString(value: unknown, maxLen = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!trimmed || trimmed.includes('${')) return undefined;
  return trimmed.slice(0, maxLen);
}

async function readZipTextSafe(zip: JSZip, entryPath: string): Promise<string | null> {
  const entry = zip.file(entryPath);
  if (!entry || entry.dir) return null;
  const text = await entry.async('string');
  if (text.length > MAX_METADATA_ENTRY_CHARS) {
    return text.slice(0, MAX_METADATA_ENTRY_CHARS);
  }
  return text;
}

function parseTomlModsSection(tomlText: string, loaderHint: ModLoader): JarEmbeddedMetadata | null {
  const modsMarkerIdx = tomlText.indexOf('[[mods]]');
  const section = modsMarkerIdx >= 0 ? tomlText.slice(modsMarkerIdx, modsMarkerIdx + 8192) : tomlText;

  const extractField = (field: string): string | undefined => {
    const regex = new RegExp(`^\\s*${field}\\s*=\\s*["']([^"']+)["']`, 'm');
    const match = regex.exec(section);
    return cleanMetaString(match?.[1]);
  };

  const modId = extractField('modId');
  if (!modId) return null;

  return {
    modId,
    name: extractField('displayName') ?? modId,
    version: extractField('version'),
    loaderHint,
    homepage: extractField('displayURL'),
  };
}

/**
 * Inspects a local Minecraft .jar archive entirely in the browser to extract embedded
 * mod descriptors (fabric.mod.json, quilt.mod.json, META-INF/neoforge.mods.toml, META-INF/mods.toml).
 */
export async function extractJarMetadata(file: File): Promise<JarEmbeddedMetadata | null> {
  if (!file || file.size === 0 || file.size > MAX_JAR_BYTES) {
    return null;
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    return null;
  }

  try {
    const fabricText = await readZipTextSafe(zip, 'fabric.mod.json');
    if (fabricText) {
      const parsed = JSON.parse(fabricText) as Record<string, unknown>;
      const modId = cleanMetaString(parsed.id);
      if (modId) {
        const contact =
          parsed.contact && typeof parsed.contact === 'object'
            ? (parsed.contact as Record<string, unknown>)
            : undefined;
        return {
          modId,
          name: cleanMetaString(parsed.name) ?? modId,
          version: cleanMetaString(parsed.version),
          loaderHint: 'fabric',
          homepage: cleanMetaString(contact?.homepage, 240),
        };
      }
    }
  } catch {
    // Fall through to other descriptor formats
  }

  try {
    const quiltText = await readZipTextSafe(zip, 'quilt.mod.json');
    if (quiltText) {
      const parsed = JSON.parse(quiltText) as Record<string, unknown>;
      const ql =
        parsed.quilt_loader && typeof parsed.quilt_loader === 'object'
          ? (parsed.quilt_loader as Record<string, unknown>)
          : undefined;
      const meta =
        ql?.metadata && typeof ql.metadata === 'object'
          ? (ql.metadata as Record<string, unknown>)
          : undefined;
      const contact =
        meta?.contact && typeof meta.contact === 'object'
          ? (meta.contact as Record<string, unknown>)
          : undefined;
      const modId = cleanMetaString(ql?.id);
      if (modId) {
        return {
          modId,
          name: cleanMetaString(meta?.name) ?? modId,
          version: cleanMetaString(ql?.version),
          loaderHint: 'quilt',
          homepage: cleanMetaString(contact?.homepage, 240),
        };
      }
    }
  } catch {
    // Fall through to TOML descriptors
  }

  try {
    const neoforgeToml = await readZipTextSafe(zip, 'META-INF/neoforge.mods.toml');
    if (neoforgeToml) {
      const parsed = parseTomlModsSection(neoforgeToml, 'neoforge');
      if (parsed) return parsed;
    }
  } catch {
    // Fall through
  }

  try {
    const forgeToml = await readZipTextSafe(zip, 'META-INF/mods.toml');
    if (forgeToml) {
      const parsed = parseTomlModsSection(forgeToml, 'forge');
      if (parsed) return parsed;
    }
  } catch {
    // Ignore parse errors
  }

  return null;
}
