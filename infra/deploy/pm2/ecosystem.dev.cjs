const { createApps } = require('./_apps.cjs');

/** Ports: API 4010, Web 3010 — override with CBT_DEV_API_PORT / CBT_DEV_WEB_PORT */
module.exports = {
  apps: createApps(
    'dev',
    Number(process.env.CBT_DEV_API_PORT || 4010),
    Number(process.env.CBT_DEV_WEB_PORT || 3010),
  ),
};
