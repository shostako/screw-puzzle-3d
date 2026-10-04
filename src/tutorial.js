// 初めての導入（E4）。いつ・何を見せるかの表と、一度見せたものを覚える所。描画にも DOM にも依存しない（テストする）。
// 画面に出すのは main.js（ネジまるの吹き出しと、半透明の手の手本）。main.js は合図（盤面を開いた・タップした・回した・行き止まり）を
// ここへ渡し、返ってきた導入を出すだけ。
//
// 教えること（1つずつ、新しいことが初めて出た時に）:
//   tap    ステージ 1 を開いた時。ねじをタップすると外れる（手本: 見えているねじをタップする手）
//   turn   ステージ 1 で、見えている面に外せるねじが無くなった時。なぞって回し、裏のねじを探す（手本: なぞる手）
//   label  ステージ 2 を開いた時。札の下のねじは、札を外すと見える（手本: 札のねじをタップする手）
//   inner  ステージ 4 を開いた時。箱の中の板は、外の板を外すと出てくる
//   parts  題材（車・家など。家具でないもの）を初めて開いた時。部品から外していく
//   slot   ねじが初めて待機スロットへ入った時（手本: スロットを指す手）
//   held   初めて「付いている部品が残っていて最後のねじが外せない」をタップした時
//   rescue 初めて詰みかけた時（待機スロットが残り 1 つ以下、スロットが満杯でタップした、行き止まり）。ヒントと戻る（手本: 電球を指す手）
// 一度出したものは端末に覚えて二度と出さない（localStorage）。設定の「記録を消す」で一緒に消す（settings.js の clearRecords）。

export const TUTORIAL_KEY = 'screw-puzzle-3d.tutorial';

// hand: 手本の手の動き（'tap' その場をタップ / 'swipe' 横になぞる / 'point' 指して揺れる / null 手は出さない）
// at:   手を置く所（'screw' 見えている外せるねじ / 'label' 札の見えている外せるねじ / 'board' 立体の真ん中 / 'slots' 待機スロット / 'tools' ヒントの電球）
// until: 消える時（'tap' ねじを外したら / 'turn' 立体を回したら / 'any' 何かをタップしたら。どれも最短 MIN_MS は出す）
export const TIPS = {
  tap: { text: 'ねじをタップすると外れるよ', hand: 'tap', at: 'screw', until: 'tap' },
  turn: { text: '指でなぞると回せるよ。裏のねじも探そう', hand: 'swipe', at: 'board', until: 'turn' },
  label: { text: '札の下にもねじが隠れているよ。札を外すと見える', hand: 'tap', at: 'label', until: 'tap' },
  inner: { text: '箱の中にも板があるよ。外の板を外すと、中のねじが出てくる', hand: null, at: null, until: 'any' },
  parts: { text: 'この形は部品でできているよ。付いている部品から外そう', hand: null, at: null, until: 'any' },
  slot: { text: '合う箱が無い色は、待機スロットで待つよ。いっぱいになると詰み', hand: 'point', at: 'slots', until: 'any' },
  held: { text: '部品が付いたままだと、最後のねじは外せないよ', hand: null, at: null, until: 'any' },
  rescue: { text: '困ったら、電球でヒント。↶ で1手戻せるよ', hand: 'point', at: 'tools', until: 'any' },
};
export const TIP_IDS = Object.keys(TIPS);
export const MIN_MS = 1500;    // 出してからこの間は、合図があっても消さない（読む間）
export const MAX_MS = 9000;    // until が 'any' の導入は、これで自然に消す
export const TURN_RAD = 0.9;   // until が 'turn' の導入は、これだけ回したら消す（約 50°）

// 家具（導入の箱・本棚・机）。これ以外の題材は部品の木でできている
const FURNITURE = new Set(['box', 'shelf', 'table']);

// 盤面を開いた時に出す導入（出す順）。mode は main.js の遊び方、level は盤面
export function startTips({ mode, stage, level }) {
  const out = [];
  if (mode?.type === 'stage') {
    if (stage === 1) out.push('tap');
    if (stage === 2 && level.plates.some(isLabel)) out.push('label');
    if (stage === 4 && level.plates.some((p) => p.id.startsWith('shelf') || p.id.startsWith('wall'))) out.push('inner');
  }
  const kind = level.meta?.kind;
  if (kind && !FURNITURE.has(kind)) out.push('parts');
  return out;
}

// ねじをタップした後に出す導入。reason は game.tap の理由、events は外した時の出来事、
// slotsFree は待機スロットの空き（外した後）、visibleLegal は今の向きで見えている外せるねじの数（外した後）、
// stage はステージの番号（ステージでなければ null）、status は局面（'playing' など）
export function tapTips({ reason, events = [], slotsFree, visibleLegal, stage, status }) {
  const out = [];
  if (reason === 'held') out.push('held');
  if (reason === 'full') out.push('rescue');
  if (reason !== 'ok' || status !== 'playing') return out;
  if (events.some((e) => e.type === 'toSlot')) {
    out.push('slot');
    if (slotsFree <= 1) out.push('rescue');
  }
  if (stage === 1 && visibleLegal === 0) out.push('turn');
  return out;
}

const isLabel = (p) => p.id.startsWith('label');

// 札の上の、外せるねじ（label の手本を置く所）
export function labelScrews(level, legal) {
  const labels = new Set(level.plates.filter(isLabel).map((p) => p.id));
  return legal.filter((id) => labels.has(level.screws.find((s) => s.id === id)?.plate));
}

// 一度見せたものを覚える。storage は localStorage の形（テストでは Map で代用）。null なら覚えない（この回だけ）
export function createTutorialStore(storage) {
  const seen = new Set();
  try {
    const saved = JSON.parse(storage?.getItem(TUTORIAL_KEY) ?? '[]');
    if (Array.isArray(saved)) for (const id of saved) if (TIPS[id]) seen.add(id);
  } catch {
    // 壊れていれば初めから
  }
  const save = () => {
    try {
      storage?.setItem(TUTORIAL_KEY, JSON.stringify([...seen]));
    } catch {
      // 保存できなくても、この回は二度出さない
    }
  };
  return {
    has: (id) => seen.has(id),
    get seen() { return [...seen]; },
    // 候補から、まだ見せていないものだけを残す（並びはそのまま）
    fresh: (ids) => ids.filter((id, i) => TIPS[id] && !seen.has(id) && ids.indexOf(id) === i),
    // 見せた（または、教える前に自分でできた）
    mark(id) {
      if (!TIPS[id] || seen.has(id)) return;
      seen.add(id);
      save();
    },
  };
}

// 導入を出すか: 自由な盤面（?seed・?level）では出さない。自動の操作（スクリーンショット・テスト）では、
// ?tutorial=on の時だけ出す（ほかの組の撮り方を変えないため）。?tutorial=off なら出さない
export function tutorialEnabled({ query, webdriver, freePlay }) {
  if (freePlay || query.get('tutorial') === 'off') return false;
  return query.get('tutorial') === 'on' || !webdriver;
}
