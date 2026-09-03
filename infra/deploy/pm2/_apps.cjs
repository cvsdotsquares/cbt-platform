/**
 * Shared PM2 helpers — prefer the per-env files:
 *   ecosystem.dev.cjs | ecosystem.staging.cjs | ecosystem.production.cjs
 */
function createApps(envName, apiPort, webPort) {
  const root = process.env.CBT_APP_ROOT || process.cwd();
  const prefix = `cbt-${envName}`;

  return [
    {
      name: `${prefix}-api`,
      cwd: root,
      script: 'pnpm',
      args: '--filter @cbt/api start:prod',
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        API_PORT: String(apiPort),
        PORT: String(apiPort),
      },
    },
    {
      name: `${prefix}-web`,
      cwd: root,
      script: 'pnpm',
      args: '--filter @cbt/web start',
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: String(webPort),
        HOSTNAME: '127.0.0.1',
      },
    },
  ];
}

module.exports = { createApps };
