// 丸ゴシック（M PLUS Rounded 1c、SIL OFL 1.1）を、画面に出す文字だけにしぼって src/assets/fonts/ に作る（E3）。
// 使い方: npm run font
//   元の TTF は google/fonts から node_modules/.cache/fonts/ へ1回だけ取ってくる（ネットが要るのはそこだけ）。
//   文字の一覧は scripts/font-chars.mjs。画面の文を足して test/font.test.js が「足りない字」で落ちたら、これを走らせ直す。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import subsetFont from 'subset-font';
import { fontChars } from './font-chars.mjs';

const root = new URL('..', import.meta.url).pathname;
const cache = join(root, 'node_modules/.cache/fonts');
const out = join(root, 'src/assets/fonts');
const SOURCE = 'https://raw.githubusercontent.com/google/fonts/main/ofl/mplusrounded1c/';
// CSS の太さ → 元のファイル。800 と 900 は ExtraBold で兼ねる（900 は ExtraBold が使われる）
export const WEIGHTS = { 400: 'Regular', 700: 'Bold', 800: 'ExtraBold' };

await mkdir(cache, { recursive: true });
await mkdir(out, { recursive: true });
const chars = fontChars();
let total = 0;
for (const [weight, name] of Object.entries(WEIGHTS)) {
  const file = join(cache, `MPLUSRounded1c-${name}.ttf`);
  if (!existsSync(file)) {
    const res = await fetch(`${SOURCE}MPLUSRounded1c-${name}.ttf`);
    if (!res.ok) throw new Error(`${name} を取れない: ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  const woff2 = await subsetFont(await readFile(file), chars, { targetFormat: 'woff2' });
  await writeFile(join(out, `rounded-${weight}.woff2`), woff2);
  total += woff2.length;
  console.log(`rounded-${weight}.woff2 ${(woff2.length / 1024).toFixed(1)}KB`);
}
await writeFile(join(out, 'chars.txt'), chars + '\n');
console.log(`文字 ${[...chars].length} 字、合計 ${(total / 1024).toFixed(1)}KB`);
