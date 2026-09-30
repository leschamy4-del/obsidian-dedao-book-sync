import esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';

const prod = process.argv.includes('--prod');
const testMode = process.argv.includes('--test');

mkdirSync('dist-test', { recursive: true });

/** Plugin bundle: src/main.ts -> main.js (Obsidian CJS) */
await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron'],
  format: 'cjs',
  target: 'es2021',
  platform: 'browser',
  outfile: 'main.js',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  minify: prod,
});

/** Pure logic modules -> CJS for node --test (no obsidian dependency) */
await esbuild.build({
  entryPoints: [
    { in: 'src/api.ts', out: 'api' },
    { in: 'src/engine.ts', out: 'engine' },
    { in: 'src/render.ts', out: 'render' },
    { in: 'src/paths.ts', out: 'paths' },
    { in: 'src/store.ts', out: 'store' },
    { in: 'src/types.ts', out: 'types' },
  ],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2021',
  platform: 'neutral',
  outdir: 'dist',
  logLevel: 'info',
});

if (testMode) {
  await esbuild.build({
    entryPoints: ['test/unit.test.ts'],
    bundle: true,
    format: 'cjs',
    target: 'es2021',
    platform: 'neutral',
    external: ['node:*'],
    outfile: 'dist-test/unit.test.cjs',
    logLevel: 'info',
  });
}