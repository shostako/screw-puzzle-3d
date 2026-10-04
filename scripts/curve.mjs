// 難しさの曲線の表（E8）。ステージ 1〜N の盤面を作り、難しさの数値を Markdown の表で出す。
// 使い方: node scripts/curve.mjs [最後のステージ（既定 60）] [--csv]
// 列: ステージ・章・形・段（stageStep、大物は ★）・ねじの本数・色の数・札・初めに隠れているねじ・層・手順で待機スロットを使う回数・作る時間
import { stageLevel, stageStep, isFinale, chapterOf, hiddenAtStart } from '../src/stages.js';

const last = Number.parseInt(process.argv.find((a) => /^\d+$/.test(a)) ?? '60', 10);
const csv = process.argv.includes('--csv');
const rows = [];
let total = 0, worst = 0;
for (let n = 1; n <= last; n++) {
  const t = performance.now();
  const l = stageLevel(n);
  const ms = performance.now() - t;
  total += ms; worst = Math.max(worst, ms);
  const ch = chapterOf(n);
  rows.push({
    n, chapter: ch.no, kind: l.meta.kind, step: n <= 6 ? '導入' : `${stageStep(n)}${isFinale(n) ? '★' : ''}`,
    screws: l.screws.length, colors: new Set(l.queue).size, labels: l.plates.filter((p) => p.id.startsWith('label')).length,
    hidden: hiddenAtStart(l), layers: l.meta.difficulty.layers, slots: l.meta.difficulty.slots, ms: Math.round(ms),
  });
}
const head = ['ステージ', '章', '形', '段', 'ねじ', '色', '札', '隠れ', '層', '待機', 'ms'];
const keys = ['n', 'chapter', 'kind', 'step', 'screws', 'colors', 'labels', 'hidden', 'layers', 'slots', 'ms'];
if (csv) {
  console.log(keys.join(','));
  for (const r of rows) console.log(keys.map((k) => r[k]).join(','));
} else {
  console.log(`| ${head.join(' | ')} |`);
  console.log(`|${head.map(() => '---').join('|')}|`);
  for (const r of rows) console.log(`| ${keys.map((k) => r[k]).join(' | ')} |`);
  console.log(`\n作る時間: 平均 ${(total / last).toFixed(0)} ms、最悪 ${worst.toFixed(0)} ms（${last} ステージ）`);
}
