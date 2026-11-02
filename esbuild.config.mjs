import esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';

/** 默认按发布配置构建（minify、无 sourcemap），与 CI/Release 产物一致；本地开发加 --dev */
const dev = process.argv.includes('--dev');
const prod = process.argv.includes('--prod') || !dev;
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
    alias: { obsidian: './test/obsidian-stub.ts' },
    outfile: 'dist-test/unit.test.cjs',
    logLevel: 'info',
  });
}