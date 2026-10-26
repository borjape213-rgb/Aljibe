import fs from 'node:fs';
let esbuild;
try { esbuild = await import('esbuild'); } catch { esbuild = await import('/opt/npm-tools/node_modules/esbuild/lib/main.js'); }
const { build } = esbuild;
const watch = process.argv.includes('--watch');
fs.mkdirSync('dist', { recursive: true });
const opts = {
  entryPoints: ['src/main.tsx'], bundle: true, outfile: 'dist/app.js', format: 'iife', target: ['chrome100'],
  jsx: 'automatic', minify: !watch, sourcemap: true, nodePaths: fs.existsSync('node_modules') ? [] : ['/opt/npm-tools/node_modules'], loader: { '.css': 'css' },
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info', allowOverwrite: true,
};
await build(opts);
await build({ entryPoints: ['src/styles.css'], bundle: true, outfile: 'dist/app.css', minify: true, loader: { '.css': 'css' }, logLevel: 'info' });
for (const f of fs.readdirSync('public')) fs.copyFileSync(`public/${f}`, `dist/${f}`);

const sw = fs.readFileSync('dist/sw.js', 'utf8').replace('aljibe-v1', `aljibe-${Date.now()}`);
fs.writeFileSync('dist/sw.js', sw);
