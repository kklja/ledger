// Bundles the renderer (CodeMirror, Chart.js, chrono) into renderer/dist/app.js.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const ctx = await esbuild.context({
  entryPoints: ['renderer/src/main.js'],
  bundle: true,
  format: 'iife',
  target: 'chrome130',
  outfile: 'renderer/dist/app.js',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  legalComments: 'none',
  logLevel: 'info',
});
if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
