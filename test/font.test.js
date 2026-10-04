// 同梱の丸ゴシック（E3）が、画面に出す文字を全部持っているか。
// 落ちたら（画面の文に新しい字を足したら）npm run font で作り直す
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { usedChars, stringLiterals } from '../scripts/font-chars.mjs';

const dir = new URL('../src/assets/fonts/', import.meta.url);

describe('丸ゴシックの同梱', () => {
  it('画面に出す文字が全部フォントに入っている（足りなければ npm run font）', () => {
    const have = new Set(readFileSync(new URL('chars.txt', dir), 'utf8').trim());
    // 絵文字や記号の一部（⚙ ↻ など）は元のフォントに無いので、端末のフォントで描く
    const missing = [...usedChars()].filter((c) => !have.has(c) && !/\p{Extended_Pictographic}|[\u2190-\u21ff\u2300-\u23ff\u25a0-\u27bf]/u.test(c));
    expect(missing.join('')).toBe('');
  });

  it('3 つの太さで合わせて 300KB 以内', () => {
    const total = [400, 700, 800].reduce((s, w) => s + statSync(new URL(`rounded-${w}.woff2`, dir)).size, 0);
    expect(total).toBeLessThan(300 * 1024);
  });

  it('文字列リテラルだけを拾う（コメントと正規表現は飛ばす）', () => {
    const src = "// 注釈\nconst a = '外す'; /* 説明 */ const r = /['\"]/g; const b = `第${n}章`; const c = \"ね\\\"じ\";";
    expect(stringLiterals(src)).toEqual(['外す', '第${n}章', 'ね"じ']);
  });
});
