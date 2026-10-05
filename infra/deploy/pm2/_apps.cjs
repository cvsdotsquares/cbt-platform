/** Shared PM2 app definitions — use infra/deploy/pm2/ecosystem.cjs */
const path = require('path');

function createApps(apiPort, webPort) {
  const root = process.env.CBT_APP_ROOT || process.cwd();
  const startApi = path.join(root, 'scripts/deploy/start-api-prod.sh');

  return [
    {
      name: 'cbt-api',
      cwd: root,
      script: startApi,
      interpreter: 'bash',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        CBT_APP_ROOT: root,
        API_PORT: String(apiPort),
        CBT_API_PORT: String(apiPort),
      },
    },
    {
      name: 'cbt-web',
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
