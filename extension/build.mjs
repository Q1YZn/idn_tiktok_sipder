import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const distDir = 'dist';
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 1. Build TS files
await esbuild.build({
  entryPoints: [
    'src/background.ts',
    'src/popup.ts',
    'src/content-shop.ts',
  ],
  bundle: true,
  outdir: distDir,
  format: 'esm',
  target: 'chrome110',
  sourcemap: false,
});

// 2. Copy static files
fs.copyFileSync('manifest.json', path.join(distDir, 'manifest.json'));
fs.copyFileSync('src/popup.html', path.join(distDir, 'popup.html'));

const iconsDir = path.join(distDir, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

if (fs.existsSync('icons')) {
  for (const file of fs.readdirSync('icons')) {
    fs.copyFileSync(path.join('icons', file), path.join(iconsDir, file));
  }
}

console.log('Extension build completed successfully into dist/');
