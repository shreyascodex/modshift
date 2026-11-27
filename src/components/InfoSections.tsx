import { BRAND_CONFIG } from '../config/brand';
import { CURSEFORGE_PROVIDER_BOUNDARY } from '../services/providers/modProvider';

export function InfoSections() {
  return (
    <div className="mt-16 space-y-12 border-t border-zinc-200 pt-12 dark:border-zinc-800">
      {/* How It Works */}
      <section id="how-it-works" aria-labelledby="how-it-works-heading">
        <h2
          id="how-it-works-heading"
          className="font-display text-lg font-semibold text-zinc-950 dark:text-zinc-50"
        >
          How It Works
        </h2>
        <div className="mt-4 grid gap-6 sm:grid-cols-3">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              01. Local Fingerprinting
            </p>
            <h3 className="mt-1.5 font-display text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              Hash JARs in your browser
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              Your selected .jar files are read locally in background Web Workers using the browser&apos;s Web Crypto API to compute exact SHA-1 hashes. Nothing is uploaded.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              02. Exact Modrinth Matching
            </p>
            <h3 className="mt-1.5 font-display text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              Query verified versions
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              Hashes are sent in controlled batches to Modrinth&apos;s official API to identify each project accurately without guessing from filenames, then checked against your chosen Minecraft version and loader.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              03. Dependency &amp; Bulk Export
            </p>
            <h3 className="mt-1.5 font-display text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              Review, add dependencies, download
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              Missing required libraries are resolved for your target loader, unmatched files can be searched manually, and ready files download straight from Modrinth&apos;s official CDN.
            </p>
          </div>
        </div>
      </section>

      {/* Privacy & Security */}
      <section id="privacy" aria-labelledby="privacy-heading">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2
            id="privacy-heading"
            className="font-display text-lg font-semibold text-zinc-950 dark:text-zinc-50"
          >
            Privacy &amp; Data Handling
          </h2>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                What stays on your device
              </h3>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                <li>• Your mod .jar files never leave your computer and are never uploaded to a server.</li>
                <li>• File validation, deduplication, and SHA-1 hashing run entirely inside your browser.</li>
                <li>• Signing in with Google is optional; if you save a migration, only your profile and mod metadata snapshots (never .jar files) are stored privately under your account in Firebase Firestore, alongside cookie-free page-view counts via Vercel Web Analytics.</li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                What is sent to Modrinth
              </h3>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                <li>• Only calculated SHA-1 file hashes, target Minecraft version, and target loader are sent to api.modrinth.com.</li>
                <li>• If you use &ldquo;Search Manually&rdquo;, your search query text is sent to Modrinth&apos;s search endpoint.</li>
                <li>• Downloads come directly from Modrinth&apos;s official CDN (cdn.modrinth.com) without rehosting.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* About & Provider Scope */}
      <section id="about" aria-labelledby="about-heading">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2
            id="about-heading"
            className="font-display text-lg font-semibold text-zinc-950 dark:text-zinc-50"
          >
            About {BRAND_CONFIG.name}
          </h2>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            {BRAND_CONFIG.tagline} Built for Minecraft players and modpack maintainers who want accurate, transparent migration results without manual tab-switching.
          </p>
          <p className="mt-3 max-w-3xl text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            <strong className="font-medium text-zinc-800 dark:text-zinc-200">Provider support:</strong>{' '}
            Modrinth is supported in this release via its official public v2 API.{' '}
            CurseForge is not enabled yet ({CURSEFORGE_PROVIDER_BOUNDARY.statusNote})
          </p>
        </div>
      </section>
    </div>
  );
}
