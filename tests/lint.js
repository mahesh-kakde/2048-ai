const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function listFiles(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, exts));
    else if (exts.some(ext => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

const jsFiles = [
  ...listFiles(path.join(ROOT, 'js'), ['.js']),
  ...listFiles(path.join(ROOT, 'scripts'), ['.js']),
  ...listFiles(path.join(ROOT, 'tests'), ['.js', '.mjs']),
  path.join(ROOT, 'sw.js')
];

for (const file of jsFiles) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

for (const jsonFile of ['package.json', 'vercel.json', 'manifest.webmanifest']) {
  JSON.parse(fs.readFileSync(path.join(ROOT, jsonFile), 'utf8'));
}

const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const textFiles = [
  path.join(ROOT, 'index.html'),
  path.join(ROOT, '404.html'),
  path.join(ROOT, 'style.css'),
  path.join(ROOT, 'wasm', 'engine.c'),
  path.join(ROOT, 'README.md'),
  path.join(ROOT, 'RESULTS.md'),
  path.join(ROOT, 'CHANGELOG.md'),
  ...jsFiles
];

for (const file of textFiles) {
  const content = fs.readFileSync(file, 'utf8');
  if (emojiRegex.test(content)) {
    throw new Error(`disallowed emoji character found in ${path.relative(ROOT, file)}`);
  }
}

console.log(`lint passed (${jsFiles.length} js/mjs files checked, json valid, 0 emojis)`);