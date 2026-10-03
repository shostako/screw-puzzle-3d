// 題材（D4）: 車・家・動物（ぶた）を部品の木（parts.js）で組む。寸法と飾りの有無は乱数で揺らす。
// 根の置き場所は気にしなくてよい（generator.js が全体の外接箱の中心を原点へ動かす）。
// どの部品もねじ 2 本以上が置ける大きさにする（ねじの中心は縁から 0.55、ねじどうしは 1.1 離す: generator.js の INSET・GAP）。
// ほかの部品にかぶさる部品は厚み 0.3 以上（板から出るねじ頭 0.27 が、かぶさる部品の中に隠れるように）。
// 部品どうしは触れてよいが重ならない（test/themes.test.js が多数のシードで調べる）。
//
// 隠し方の作り:
//   車   車輪が車体の横のねじを、窓が客室の横のねじを隠す。屋根・ボンネット・バンパーは飾り。
//   家   ドアと窓が壁の前後のねじを、屋根の張り出しが土台のねじを隠す。屋根板は斜めのねじ。
//   ぶた 鼻が顔のねじを、ぶちが胴の横のねじを隠す。脚のねじは裏（下）にある。

export const THEMES = ['car', 'house', 'animal'];

const pick = (rnd, xs) => xs[Math.floor(rnd() * xs.length)];
const range = (rnd, lo, hi, step = 0.1) => lo + step * Math.floor(rnd() * (Math.round((hi - lo) / step) + 1));
const T = 0.3;

const BODY_COLORS = ['coral', 'sky', 'mint', 'lemon', 'lilac'];

// ---- 車 ----
// 前が +x、上が +y、横幅が z。車体と客室は横（±z）にねじを持つ丸めた箱
function car(rnd) {
  const L = range(rnd, 6.4, 7.4), Hc = 1.4, W = range(rnd, 3.0, 3.6);
  const body = pick(rnd, BODY_COLORS);
  const R = 1.15, xw = L / 2 - R - 0.35;
  const wheels = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz], k) => ({
    id: `wheel${k + 1}`, shape: 'cylinder', radius: R, thickness: 0.5,
    at: [sx * xw, -Hc / 2, sz * (W / 2 + 0.25)], n: [0, 0, sz], role: 'outer', color: 'tire',
  }));
  const Lc = range(rnd, 3.0, 3.6), Hcab = 1.7, Wc = W - 0.4, cx = -range(rnd, 0.2, 0.6);
  const cabin = {
    id: 'cabin', shape: 'block', size: [Lc, Hcab], thickness: Wc, faces: [1, -1],
    at: [cx, Hc / 2 + Hcab / 2, 0], role: 'frame', color: body,
    children: [
      ...[1, -1].map((s, k) => ({
        id: `window${k + 1}`, size: [Lc - 0.5, 1.2], thickness: T,
        at: [0, 0.1, s * (Wc / 2 + T / 2)], n: [0, 0, s], role: 'outer', color: 'glass',
      })),
    ],
  };
  if (rnd() < 0.7) {
    cabin.children.push({
      id: 'roof', size: [Lc - 0.2, Wc - 0.4], thickness: T, at: [0, Hcab / 2 + T / 2, 0], n: [0, 1, 0],
      role: 'decor', color: 'white',
    });
  }
  const children = [...wheels, cabin];
  const front = cx + Lc / 2 + 0.1, hood = L / 2 - 0.1 - front;
  if (hood >= 1.3 && rnd() < 0.8) {
    children.push({
      id: 'hood', size: [hood, W - 0.6], thickness: T, at: [front + hood / 2, Hc / 2 + T / 2, 0], n: [0, 1, 0],
      role: 'decor', color: 'white',
    });
  }
  if (rnd() < 0.6) {
    for (const [s, k] of [[1, 1], [-1, 2]]) {
      children.push({
        id: `bumper${k}`, size: [W - 0.4, 1.2], thickness: T, at: [s * (L / 2 + T / 2), -0.1, 0], n: [s, 0, 0],
        u: [0, 0, 1], role: 'decor', color: 'white',
      });
    }
  }
  return {
    id: 'chassis', shape: 'block', size: [L, Hc], thickness: W, faces: [1, -1],
    role: 'core', color: body, children,
  };
}

// ---- 家 ----
// 前が +z。土台（庭）の上に壁の箱、その上に三角の屋根（輪郭が三角の柱）と左右の屋根板
function house(rnd) {
  const Wb = range(rnd, 4.8, 5.6), Hb = range(rnd, 3.0, 3.6), Db = range(rnd, 3.4, 4.0);
  const Wr = Wb + 0.8, Hr = range(rnd, 2.2, 2.6), Dr = Db + 0.6;
  const a = Wr / 2, l = Math.hypot(a, Hr);
  const slope = (s) => {
    // 屋根の斜面（右 s = 1、左 s = -1）に載る板。屋根の局所（三角の xy、厚みが z）で書く
    const e = [(-s * a) / l, Hr / l, 0];         // 軒から棟へ
    const nn = [(s * Hr) / l, a / l, 0];          // 外向きの法線
    const len = l - 0.1;                          // 棟の手前で止める（左右の板が重ならない）
    const mid = [s * a + e[0] * (len / 2), e[1] * (len / 2), 0];
    return {
      id: s > 0 ? 'roofR' : 'roofL', size: [len, Dr], thickness: T,
      at: add3(mid, nn.map((x) => x * (T / 2))), n: nn, u: e,
      role: 'outer', color: 'roof',
    };
  };
  const door = rnd() < 0.5 ? -1 : 1;
  // 前の面: ドア（1.4 × 2.3）を片側の端に、窓（2.2 × 1.4）を反対側に
  const openings = [
    { id: 'door', size: [1.4, 2.3], thickness: T, at: [door * (Wb / 2 - 1.0), -Hb / 2 + 1.3, Db / 2 + T / 2], role: 'outer', color: 'door' },
    { id: 'window1', size: [2.2, 1.4], thickness: T, at: [-door * (Wb / 2 - 1.4), 0.4, Db / 2 + T / 2], role: 'outer', color: 'glass' },
  ];
  if (rnd() < 0.7) {
    openings.push({
      id: 'window2', size: [range(rnd, 2.2, 3.0), 1.4], thickness: T, at: [range(rnd, -0.6, 0.6), 0.3, -Db / 2 - T / 2],
      n: [0, 0, -1], role: 'outer', color: 'glass',
    });
  }
  const roof = {
    id: 'roof', outline: [[-a, 0], [a, 0], [0, Hr]], thickness: Dr, faces: [1, -1],
    at: [0, Hb / 2, 0], role: 'frame', color: 'roof',
    children: [slope(1), slope(-1)],
  };
  // 壁の箱。土台の局所（x = 世界の x、y = 世界の -z、z = 世界の y）で、上（局所 z）に載せる。
  // n = 土台の -y（= 世界の +z）、u = 世界の x にして、壁の局所の軸を世界の軸にそろえる（子は世界の向きで書ける）
  const walls = {
    id: 'walls', shape: 'block', size: [Wb, Hb], thickness: Db, faces: [1, -1],
    at: [0, 0, 0.25 + Hb / 2], n: [0, -1, 0], u: [1, 0, 0], role: 'core', color: 'wall',
    children: [...openings, roof],
  };
  return {
    id: 'yard', shape: 'block', size: [Wb + 2.4, Db], thickness: 0.5, n: [0, 1, 0],
    u: [1, 0, 0], role: 'frame', color: 'grass', children: [walls],
  };
}

// ---- ぶた ----
// 前が +x。太った胴（丸めた箱）に、頭・鼻（円柱）・耳・しっぽ・脚（円柱、ねじは足の裏）・ぶち
function animal(rnd) {
  const L = range(rnd, 5.4, 5.8), H = range(rnd, 2.8, 3.2), W = range(rnd, 4.8, 5.0);
  const R = 1.15;
  const legs = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz], k) => ({
    id: `leg${k + 1}`, shape: 'cylinder', radius: R, thickness: 1.2,
    at: [sx * (L / 2 - 1.4), -H / 2 - 0.6, sz * (W / 2 - 1.2)], n: [0, -1, 0], role: 'outer', color: 'pinkDeep',
  }));
  const HD = 1.6, HW = 3.4, HH = 2.6;
  // 頭の局所: x = 世界の -z、y = 世界の y、z = 世界の x（顔の向き）
  const head = {
    id: 'head', shape: 'block', size: [HW, HH], thickness: HD, faces: [1],
    at: [L / 2 + HD / 2, 0.5, 0], n: [1, 0, 0], u: [0, 0, -1], role: 'frame', color: 'pink',
    children: [
      { id: 'snout', shape: 'cylinder', radius: R, thickness: 0.5, at: [0, -0.3, HD / 2 + 0.25], role: 'outer', color: 'pinkDeep' },
      ...[1, -1].map((s, k) => ({
        id: `ear${k + 1}`, size: [1.6, 2.2], thickness: T, at: [s * 0.9, HH / 2 + T / 2, 0.3], n: [0, 1, 0], u: [1, 0, 0],
        role: 'decor', color: 'pinkDeep',
      })),
    ],
  };
  const children = [...legs, head];
  if (rnd() < 0.6) {
    children.push({ id: 'tail', shape: 'cylinder', radius: 1.15, thickness: T, at: [-L / 2 - T / 2, 0.4, 0], n: [-1, 0, 0], role: 'decor', color: 'pinkDeep' });
  }
  // ぶち: 胴の左右に 0〜1 枚ずつ（部品が増えるほど解ける色の割り当てが見つかりにくく、作るのが遅くなるため）
  let spots = 0;
  for (const s of [1, -1]) {
    if (rnd() < 0.4) continue;
    const half = rnd() < 0.5 ? 1 : -1;
    const w = range(rnd, 1.9, 2.2), h = range(rnd, 1.9, Math.min(2.2, H - 0.6));
    const x = half * range(rnd, w / 2 + 0.1, L / 2 - w / 2 - 0.2), y = range(rnd, -(H - h) / 2 + 0.2, (H - h) / 2 - 0.2);
    children.push({ id: `spot${++spots}`, size: [w, h], thickness: T, at: [x, y, s * (W / 2 + T / 2)], n: [0, 0, s], role: 'decor', color: 'spot' });
  }
  return {
    id: 'body', shape: 'block', size: [L, H], thickness: W, faces: [1, -1],
    role: 'core', color: 'pink', children,
  };
}

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const THEME_BUILDERS = { car, house, animal };
