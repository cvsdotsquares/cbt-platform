const { createApps } = require('./_apps.cjs');

/** Ports: API 4020, Web 3020 — override with CBT_STAGING_API_PORT / CBT_STAGING_WEB_PORT */
module.exports = {
  apps: createApps(
    'staging',
    Number(process.env.CBT_STAGING_API_PORT || 4020),
    Number(process.env.CBT_STAGING_WEB_PORT || 3020),
  ),
};
