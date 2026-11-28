const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function getHashedWasmPath(rootDir = ROOT) {
  const aiCode = fs.readFileSync(path.join(rootDir, 'js', 'ai.js'), 'utf8');
  const match = aiCode.match(/const WASM_BINARY_PATH = '([^']+)';/);
  if (!match) {
    throw new Error('WASM_BINARY_PATH constant missing in js/ai.js');
  }
  return match[1];
}

function copyRelFile(srcRoot, outDir, relPath) {
  const src = path.join(srcRoot, relPath);
  if (!fs.existsSync(src)) {
    throw new Error(`missing required runtime file: ${relPath}`);
  }
  const dest = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// build clean static dist directory containing strictly runtime assets
function buildDist(outDir = path.join(ROOT, 'dist'), rootDir = ROOT) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const requiredFiles = [
    'index.html',
    '404.html',
    'style.css',
    'high-score-1.webp',
    'high-score-2.webp',
    'js/game.js',
    'js/ui.js',
    'js/ai.js',
    'js/main.js',
    getHashedWasmPath(rootDir)
  ];

  for (const rel of requiredFiles) {
    copyRelFile(rootDir, outDir, rel);
  }

  return requiredFiles;
}

if (require.main === module) {
  const copied = buildDist();
  console.log(`built dist/ with ${copied.length} runtime files`);
}

module.exports = { buildDist, getHashedWasmPath };