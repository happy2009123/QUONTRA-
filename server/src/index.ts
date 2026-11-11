/**
 * QUANTORA backend entry point.
 *
 *   node server/src/index.ts            # uses .env-less process env
 *   PORT=8080 npm run backend
 *
 * Startup order: config → migrations → seed → provider probes → listen.
 * Shutdown drains in-flight requests and closes the database.
 */

import { loadConfig, ConfigError } from './config/env.ts';
import { createApp } from './app.ts';
import { log, setLogLevel } from './lib/logger.ts';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(
        JSON.stringify({ level: 'error', time: new Date().toISOString(), msg: 'invalid configuration', error: err.message }) + '\n',
      );
      process.exit(2);
    }
    throw err;
  }
  setLogLevel(config.logLevel);

  const app = await createApp({ config });
  const port = await app.listen();

  log.info('quantora backend ready', {
    port,
    env: config.env,
    db: config.dbPath,
    providers: config.providers.enabled,
    adminEnabled: Boolean(config.adminToken),
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });
    void app
      .close()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        log.error('shutdown error', { error: err instanceof Error ? err.message : String(err) });
        process.exit(1);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  log.error('fatal startup error', { error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  process.exit(1);
});
