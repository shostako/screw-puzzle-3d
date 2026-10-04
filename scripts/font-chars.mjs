// 画面に出す文字の一覧（丸ゴシックを同梱するとき、使う文字だけにしぼるため。E3）。
// index.html の文字と、src/ の JS の文字列リテラル（コメントは除く）から非 ASCII の文字を集め、
// ASCII の印字できる文字・ひらがな・カタカナ全部・よく使う記号を足す（後から文が変わっても字形がそろいやすいように）。
// scripts/font.mjs（作る）と test/font.test.js（足りない字が無いか）が使う。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

// JS のソースから文字列リテラル（'…' "…" `…`）の中身だけを取り出す。コメントと正規表現リテラルは飛ばす
export function stringLiterals(src) {
  const out = [];
  let i = 0;
  let prev = '';   // 直前の空白でない文字（/ が割り算か正規表現かを決める）
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; if (i < 2) break; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') { s += src[j + 1] ?? ''; j += 2; continue; }
        s += src[j++];
      }
      out.push(s);
      i = j + 1;
      prev = c;
      continue;
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      let j = i + 1, inClass = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      i = j + 1;
      prev = '/';
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => String.fromCodePoint(a + k)).join('');
// いつも入れる文字: ASCII・ひらがな・カタカナ・全角の記号と数字・よく使う約物
export const BASE_CHARS = range(0x20, 0x7e) + range(0x3041, 0x3096) + range(0x30a1, 0x30fc)
  + range(0xff01, 0xff5e) + '、。・「」『』（）【】〜…―ー！？：；“”‘’々★☆♪×÷±→←↑↓○●◎△▲□■◇◆♥　';

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? jsFiles(join(dir, d.name)) : d.name.endsWith('.js') ? [join(dir, d.name)] : []));
}

// 画面に出しうる文字（非 ASCII）
export function usedChars() {
  const html = readFileSync(join(root, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const texts = [html, ...jsFiles(join(root, 'src')).flatMap((f) => stringLiterals(readFileSync(f, 'utf8')))];
  const set = new Set();
  for (const t of texts) for (const ch of t) if (ch.codePointAt(0) > 0x7e) set.add(ch);
  return set;
}

// フォントに入れる文字（並べた文字列）
export function fontChars() {
  const set = new Set([...BASE_CHARS, ...usedChars()]);
  return [...set].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join('');
}
