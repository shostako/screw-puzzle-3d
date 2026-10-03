// dist/ が外部 URL から何も読み込まないことを確かめる（Android アプリでネット無しでも動くように）。
// HTML の src/href と CSS の url()/@import に http(s):// や // で始まる参照があれば失敗にする。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const external = /^(https?:)?\/\//i;
const problems = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else check(path);
  }
}

function check(path) {
  const ext = extname(path);
  const text = readFileSync(path, 'utf8');
  const refs = [];
  if (ext === '.html') {
    for (const m of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) refs.push(m[1]);
  } else if (ext === '.css') {
    for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) refs.push(m[1]);
    for (const m of text.matchAll(/@import\s+["']([^"']+)["']/gi)) refs.push(m[1]);
  } else if (ext === '.js') {
    // 動的な import や fetch の先が外部になっていないか
    for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) refs.push(m[1]);
    for (const m of text.matchAll(/\bfetch\(\s*["']([^"']+)["']/g)) refs.push(m[1]);
  }
  for (const r of refs) if (external.test(r)) problems.push(`${path.slice(root.length)}: ${r}`);
}

walk(root);
if (problems.length) {
  console.error('check-dist: 外部からの読み込みがある');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('check-dist: 外部からの読み込みなし');
