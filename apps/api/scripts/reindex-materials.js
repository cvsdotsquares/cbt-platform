/* eslint-disable @typescript-eslint/no-require-imports */
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { RagService } = require('../dist/modules/rag/rag.service');

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error('Usage: node scripts/reindex-materials.js <materialId> [...]');
  process.exit(1);
}

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const rag = app.get(RagService);
  for (const id of ids) {
    console.log(`REINDEX_START ${id}`);
    await rag.indexMaterial(id);
    console.log(`REINDEX_DONE ${id}`);
  }
  await app.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
