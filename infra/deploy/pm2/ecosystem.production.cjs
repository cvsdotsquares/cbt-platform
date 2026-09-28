const { createApps } = require('./_apps.cjs');

/** Ports: API 4030, Web 3030 — override with CBT_PROD_API_PORT / CBT_PROD_WEB_PORT */
module.exports = {
  apps: createApps(
    'production',
    Number(process.env.CBT_PROD_API_PORT || 4030),
    Number(process.env.CBT_PROD_WEB_PORT || 3030),
  ),
};
