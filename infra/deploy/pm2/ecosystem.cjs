const { createApps } = require('./_apps.cjs');

/** Default ports: API 4010, Web 3010 — override with CBT_API_PORT / CBT_WEB_PORT */
module.exports = {
  apps: createApps(
    Number(process.env.CBT_API_PORT || 4010),
    Number(process.env.CBT_WEB_PORT || 3010),
  ),
};
