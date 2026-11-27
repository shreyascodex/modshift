import type { ModLoader } from '../types/migration';

export interface LoaderOption {
  id: ModLoader;
  label: string;
  description: string;
}

export const BRAND_CONFIG = {
  name: 'ModShift',
  tagline: 'Your mods. Your next Minecraft version. One simple migration.',
  headline: 'Update your Minecraft modpack without the manual work.',
  subheadline:
    'Drop your existing .jar files, choose your target Minecraft version and mod loader, and find verified compatible updates through Modrinth — without uploading a single mod file.',
  apiBaseUrl: 'https://api.modrinth.com/v2',
  webBaseUrl: 'https://modrinth.com',
  // Kept centralized for future server-side/desktop proxy usage; browser fetch omits forbidden User-Agent headers per Fetch spec.
  userAgentIdentifier: 'ModShift/1.0.0 (browser-client; https://modrinth.com)',
  maxTargetModCount: 200,
  largeFileWarningBytes: 100 * 1024 * 1024, // 100 MB
} as const;

export const SUPPORTED_LOADERS: LoaderOption[] = [
  {
    id: 'fabric',
    label: 'Fabric',
    description: 'Lightweight modular loader',
  },
  {
    id: 'neoforge',
    label: 'NeoForge',
    description: 'Modern Forge-fork loader (1.20.1+)',
  },
  {
    id: 'forge',
    label: 'Forge',
    description: 'Classic Minecraft mod loader',
  },
  {
    id: 'quilt',
    label: 'Quilt',
    description: 'Quilt-tagged releases only',
  },
];
