const { createApps } = require('./_apps.cjs');

/** PM2 expects `ecosystem.config.*` — do not use bare `ecosystem.cjs` (PM2 runs it as a script). */
module.exports = {
  apps: createApps(
    Number(process.env.CBT_API_PORT || 4010),
    Number(process.env.CBT_WEB_PORT || 3010),
  ),
};
