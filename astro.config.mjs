import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync, writeFileSync } from 'fs';

// Post-build integration: compiles GameRoom.ts and adds it as a DO export
// in the generated _worker.js/index.js so Cloudflare can bind it.
const injectDurableObject = {
  name: 'inject-durable-object',
  hooks: {
    'astro:build:done': async ({ dir, logger }) => {
      const { build } = await import('esbuild');
      const outDir = fileURLToPath(dir);
      const workerDir = path.join(outDir, '_worker.js');

      // Compile GameRoom.ts (and its ludo.ts dep) into a single ESM bundle
      await build({
        entryPoints: [path.join(process.cwd(), 'src/do/GameRoom.ts')],
        outfile: path.join(workerDir, 'GameRoom.mjs'),
        bundle: true,
        format: 'esm',
        platform: 'neutral',
        target: 'es2022',
        logLevel: 'silent',
      });

      // Append the DO export to the worker entry so Cloudflare can bind it
      const indexPath = path.join(workerDir, 'index.js');
      let entry = readFileSync(indexPath, 'utf8');
      entry += `\nexport { GameRoom } from './GameRoom.mjs';\n`;
      writeFileSync(indexPath, entry);

      logger.info('GameRoom Durable Object injected into _worker.js/index.js');
    },
  },
};

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  integrations: [injectDurableObject],
});
