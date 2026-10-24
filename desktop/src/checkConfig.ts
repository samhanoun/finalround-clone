import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAppUrl } from './policy';

/**
 * Run before electron-builder (`npm run dist`): a packaged build loads only
 * app.config.json's appUrl, which must be https on a real host. Failing here
 * beats shipping an installer that refuses to start.
 */
try {
  const config = JSON.parse(readFileSync(path.join(__dirname, '..', 'app.config.json'), 'utf8')) as { appUrl?: string };
  const url = resolveAppUrl(undefined, config.appUrl, { packaged: true });
  console.log(`Packaging for ${url.origin}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
