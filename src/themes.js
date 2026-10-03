// 題材（D4、E7）: 車・家・動物（ぶた）・ロボット・飛行機・船・ロケット・機関車・カメラを部品の木（parts.js）で組む。寸法と飾りの有無は乱数で揺らす。
// 根の置き場所は気にしなくてよい（generator.js が全体の外接箱の中心を原点へ動かす）。
// どの部品もねじ 2 本以上が置ける大きさにする（ねじの中心は縁から 0.55、ねじどうしは 1.1 離す: generator.js の INSET・GAP）。
// ほかの部品にかぶさる部品は厚み 0.3 以上（板から出るねじ頭 0.27 が、かぶさる部品の中に隠れるように）。
// 部品どうしは触れてよいが重ならない（test/themes.test.js が多数のシードで調べる）。
//
// 隠し方の作り:
//   車   車輪が車体の横のねじを、窓が客室の横のねじを隠す。屋根・ボンネット・バンパーは飾り。
//   家   ドアと窓が壁の前後のねじを、屋根の張り出しが土台のねじを隠す。屋根板は斜めのねじ。
//   ぶた 鼻が顔のねじを、ぶちが胴の横のねじを隠す。脚のねじは裏（下）にある。
//   ロボット 胸の板と背中の電池が胴の前後のねじを、目の窓が頭のねじを隠す。腕は横、脚のねじは足の裏。
//   飛行機   主翼・操縦席の窓・水平尾翼が胴の上のねじを、エンジンが主翼の下のねじを隠す。胴の下のねじは裏から。
//   船       浮き輪が船体の横のねじを、窓が船室のねじを隠す。煙突のねじは上。
//   ロケット 丸窓（縁とガラスの2段）と点検口が胴の前後のねじを隠す。先の三角・羽根・噴射口（下）にもねじ。
//   機関車   車輪が台車の横のねじを、窓が運転室のねじを隠す。ボイラーのねじは前、煙突は上。
//   カメラ   レンズ・握り・画面が胴の前後のねじを隠す。レンズはガラスと筒の2段。

export const THEMES = ['car', 'house', 'animal', 'robot', 'plane', 'ship', 'rocket', 'train', 'camera'];

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

// ---- ロボット（E7） ----
// 前が +z。胴（丸めた箱、ねじは前後）の上に頭、横に腕、下に脚（ねじは足の裏）
function robot(rnd) {
  const W = range(rnd, 3.6, 4.2), H = range(rnd, 4.0, 4.6), D = range(rnd, 2.6, 3.0);
  const body = pick(rnd, ['sky', 'mint', 'lemon', 'coral']);
  const accent = pick(rnd, ['coral', 'lemon', 'lilac', 'sky'].filter((c) => c !== body));
  const HW = range(rnd, 2.8, 3.2), HH = 2.4, HD = D - 0.4;
  const head = {
    id: 'head', shape: 'block', size: [HW, HH], thickness: HD, faces: [1, -1],
    at: [0, H / 2 + HH / 2, 0], role: 'frame', color: 'steel',
    children: [
      { id: 'visor', size: [HW - 0.4, 1.3], thickness: T, at: [0, 0.2, HD / 2 + T / 2], role: 'outer', color: 'glass' },
      // 耳のボルト（円柱）。下の平らな辺が胴の上面から 0.05 浮く
      ...(rnd() < 0.2 ? [] : [1, -1]).map((s, k) => ({
        id: `ear${k + 1}`, shape: 'cylinder', radius: 1.15, thickness: 0.4, at: [s * (HW / 2 + 0.2), 0, 0], n: [s, 0, 0],
        role: 'decor', color: accent,
      })),
    ],
  };
  const arms = [1, -1].map((s, k) => ({
    id: `arm${k + 1}`, shape: 'block', size: [D - 0.6, H - 0.8], thickness: 0.9,
    at: [s * (W / 2 + 0.45), 0.2, 0], n: [s, 0, 0], role: 'outer', color: accent,
  }));
  // 脚の局所: x = 世界の x、y = 世界の z、法線が下
  const legs = [1, -1].map((s, k) => ({
    id: `leg${k + 1}`, shape: 'block', size: [1.5, D - 0.4], thickness: 1.6,
    at: [s * (W / 2 - 0.9), -H / 2 - 0.8, 0], n: [0, -1, 0], u: [1, 0, 0], role: 'outer', color: 'steel',
  }));
  const chest = {
    id: 'chest', size: [W - 1.2, range(rnd, 1.6, 2.0)], thickness: T, at: [0, range(rnd, 0.0, 0.6), D / 2 + T / 2],
    role: 'outer', color: accent,
  };
  const pack = {
    id: 'pack', size: [W - range(rnd, 0.8, 1.4), H - range(rnd, 1.4, 2.0)], thickness: T, at: [0, 0, -D / 2 - T / 2],
    n: [0, 0, -1], role: 'outer', color: 'lemon',
  };
  return {
    id: 'torso', shape: 'block', size: [W, H], thickness: D, faces: [1, -1],
    role: 'core', color: body, children: [head, ...arms, ...legs, chest, ...(rnd() < 0.7 ? [pack] : [])],
  };
}

// ---- 飛行機（E7） ----
// 前が +x。胴（丸めた箱）は法線が上で、ねじは上と下。上に主翼・操縦席の窓・水平尾翼が載る。
// 胴の局所: x = 世界の x、y = 世界の -z、z = 世界の y
function plane(rnd) {
  const L = range(rnd, 7.6, 8.4), W = 2.2, H = range(rnd, 1.8, 2.0);
  const body = pick(rnd, ['white', 'sky', 'lemon']);
  const accent = pick(rnd, ['coral', 'sky', 'mint'].filter((c) => c !== body));
  const front = L / 2 - 0.1, cock = range(rnd, 2.2, 2.5);
  const chord = range(rnd, 2.4, 2.8), span = range(rnd, 8.4, 9.6);
  const wx = front - cock - 0.1 - chord / 2;
  const R = 1.15, ez = W / 2 + 0.3 + R;
  // エンジン（円柱、軸が前後、ねじは前の面）。主翼の下にぶら下がる。主翼の局所は胴と同じ向き
  const engines = [1, -1].map((s, k) => ({
    id: `engine${k + 1}`, shape: 'cylinder', radius: R, thickness: 1.6,
    at: [0, s * ez, -T / 2 - R], n: [1, 0, 0], role: 'outer', color: 'steel',
  }));
  const wing = {
    id: 'wing', size: [chord, span], thickness: T, faces: [1, -1], at: [wx, 0, H / 2 + T / 2],
    role: 'frame', color: accent, children: engines,
  };
  const tl = 1.8, fh = range(rnd, 2.0, 2.4);
  const tail = {
    id: 'tailplane', size: [tl, range(rnd, 4.0, 4.8)], thickness: T, faces: [1, -1],
    at: [-L / 2 + 0.1 + tl / 2, 0, H / 2 + T / 2], role: 'decor', color: accent,
    children: [
      // 垂直尾翼: 法線が世界の z（= 尾翼の局所の -y）
      { id: 'fin', size: [tl, fh], thickness: T, faces: [1, -1], at: [0, 0, T / 2 + fh / 2], n: [0, -1, 0], u: [1, 0, 0], role: 'decor', color: body },
    ],
  };
  const children = [
    wing,
    { id: 'cockpit', size: [cock, W - 0.4], thickness: T, at: [front - cock / 2, 0, H / 2 + T / 2], role: 'outer', color: 'glass' },
    tail,
  ];
  // プロペラ（無ければジェット機）
  if (rnd() < 0.6) {
    children.push({
      id: 'prop', shape: 'cylinder', radius: R, thickness: T, at: [L / 2 + T / 2, 0, 0], n: [1, 0, 0], role: 'outer',
      color: pick(rnd, ['coral', 'lemon', 'tire']),
    });
  }
  return {
    id: 'fuselage', shape: 'block', size: [L, W], thickness: H, faces: [1, -1], n: [0, 1, 0], u: [1, 0, 0],
    role: 'core', color: body, children,
  };
}

// ---- 船（E7） ----
// 前が +x。船体（丸めた箱、ねじは左右）の上に船室、その上に煙突。浮き輪が船体の横のねじを隠す
function ship(rnd) {
  const L = range(rnd, 7.0, 7.6), H = 2.2, W = range(rnd, 3.0, 3.4);
  const Lc = range(rnd, 3.0, 3.6), Hc = 1.8, Wc = W - 0.6, cx = -range(rnd, 0.4, 1.0);
  const cabin = {
    id: 'cabin', shape: 'block', size: [Lc, Hc], thickness: Wc, faces: [1, -1],
    at: [cx, H / 2 + Hc / 2, 0], role: 'frame', color: 'white',
    children: [
      ...[1, -1].map((s, k) => ({
        id: `window${k + 1}`, size: [Lc - 0.5, 1.2], thickness: T,
        at: [0, 0.1, s * (Wc / 2 + T / 2)], n: [0, 0, s], role: 'outer', color: 'glass',
      })),
    ],
  };
  const fh = range(rnd, 1.2, 1.6);
  cabin.children.push({
    id: 'funnel', shape: 'cylinder', radius: 1.15, thickness: fh, at: [range(rnd, -0.3, 0.3), Hc / 2 + fh / 2, 0],
    n: [0, 1, 0], role: 'outer', color: 'red',
  });
  // 浮き輪は左右に 1 つずつ、前後の片側に寄せる
  const side = rnd() < 0.5 ? 1 : -1;
  const buoys = [1, -1].map((s, k) => ({
    id: `buoy${k + 1}`, shape: 'cylinder', radius: 1.15, thickness: T,
    at: [(k ? -side : side) * range(rnd, 1.6, L / 2 - 1.4), -0.1, s * (W / 2 + T / 2)], n: [0, 0, s], role: 'outer', color: 'coral',
  }));
  const children = [cabin, ...buoys];
  const deck = L / 2 - 0.1 - (cx + Lc / 2 + 0.1);
  if (deck >= 1.4 && rnd() < 0.7) {
    children.push({
      id: 'deck', size: [deck, W - 0.6], thickness: T, at: [L / 2 - 0.1 - deck / 2, H / 2 + T / 2, 0], n: [0, 1, 0],
      role: 'decor', color: 'door',
    });
  }
  return {
    id: 'hull', shape: 'block', size: [L, H], thickness: W, faces: [1, -1],
    role: 'core', color: 'navy', children,
  };
}

// ---- ロケット（E7） ----
// 縦長。胴（丸めた箱、ねじは前後）の上に先の三角（三角の柱）、横に羽根、下に噴射口（円柱、ねじは下）
function rocket(rnd) {
  const Wb = 3.2, Hb = range(rnd, 4.8, 5.4), Db = 3.2;
  const accent = pick(rnd, ['coral', 'sky', 'lilac']);
  const a = Wb / 2, h = range(rnd, 2.8, 3.2);
  const fin = (s, k) => {
    const fh = range(rnd, 2.6, 3.0), fw = 1.8;
    return {
      id: `fin${k + 1}`, outline: [[0, 0], [s * fw, -0.6], [s * fw, fh - 1.6], [0, fh]], thickness: T, faces: [1, -1],
      at: [s * a, -Hb / 2, 0], role: 'decor', color: accent,
    };
  };
  const children = [
    { id: 'nose', outline: [[-a, 0], [a, 0], [0, h]], thickness: Db, faces: [1, -1], at: [0, Hb / 2, 0], role: 'outer', color: accent },
    // 丸窓は縁（円柱）とガラス（円柱）の 2 段。縁のねじはガラスの下
    {
      id: 'porthole', shape: 'cylinder', radius: 1.45, thickness: T, at: [0, Hb / 2 - range(rnd, 1.7, 2.0), Db / 2 + T / 2], role: 'frame', color: 'steel',
      children: [{ id: 'glass', shape: 'cylinder', radius: 1.15, thickness: T, at: [0, 0, T], role: 'decor', color: 'glass' }],
    },
    ...(rnd() < 0.3 ? [] : [{ id: 'hatch', size: [Wb - 0.8, range(rnd, 1.6, 2.0)], thickness: T, at: [0, range(rnd, -0.6, 0.2), -Db / 2 - T / 2], n: [0, 0, -1], role: 'outer', color: 'steel' }]),
    fin(1, 0), fin(-1, 1),
    { id: 'nozzle', shape: 'cylinder', radius: 1.15, thickness: 0.8, at: [0, -Hb / 2 - 0.4, 0], n: [0, -1, 0], role: 'outer', color: 'tire' },
  ];
  return {
    id: 'rocket', shape: 'block', size: [Wb, Hb], thickness: Db, faces: [1, -1],
    role: 'core', color: 'white', children,
  };
}

// ---- 機関車（E7） ----
// 前が +x。台車（丸めた箱、ねじは左右）に車輪、前にボイラー（円柱、ねじは前の面）と煙突、後ろに運転室
function train(rnd) {
  const L = range(rnd, 7.6, 8.2), Hc = 1.4, W = range(rnd, 3.0, 3.2);
  const body = pick(rnd, ['navy', 'red', 'mint']);
  const R = 1.15;
  const per = rnd() < 0.5 ? 3 : 2;
  const xs = per === 3 ? [-2.5, 0, 2.5] : [-(L / 2 - R - 0.4), L / 2 - R - 0.4];
  const wheels = [];
  for (const sz of [1, -1]) {
    for (const x of xs) {
      wheels.push({
        id: `wheel${wheels.length + 1}`, shape: 'cylinder', radius: R, thickness: 0.5,
        at: [x, -Hc / 2, sz * (W / 2 + 0.25)], n: [0, 0, sz], role: 'outer', color: 'tire',
      });
    }
  }
  const Lc = range(rnd, 2.4, 2.8), Hcab = 2.4, Wc = W - 0.4;
  const cab = {
    id: 'cab', shape: 'block', size: [Lc, Hcab], thickness: Wc, faces: [1, -1],
    at: [-L / 2 + 0.1 + Lc / 2, Hc / 2 + Hcab / 2, 0], role: 'frame', color: body,
    children: [
      ...[1, -1].map((s, k) => ({
        id: `window${k + 1}`, size: [Lc - 0.5, 1.2], thickness: T,
        at: [0, 0.4, s * (Wc / 2 + T / 2)], n: [0, 0, s], role: 'outer', color: 'glass',
      })),
      { id: 'roof', size: [Lc - 0.2, Wc - 0.4], thickness: T, at: [0, Hcab / 2 + T / 2, 0], n: [0, 1, 0], role: 'decor', color: 'tire' },
    ],
  };
  // ボイラーの局所: x = 世界の -z、y = 世界の y、z = 世界の x（前）
  const Rb = 1.3, x0 = -L / 2 + 0.1 + Lc + 0.1, x1 = L / 2 - 0.2, Lb = x1 - x0;
  const ch = range(rnd, 0.9, 1.3);
  const boiler = {
    id: 'boiler', shape: 'cylinder', radius: Rb, thickness: Lb, at: [(x0 + x1) / 2, Hc / 2 + Rb, 0], n: [1, 0, 0],
    role: 'frame', color: body,
    children: [
      { id: 'chimney', shape: 'cylinder', radius: 1.15, thickness: ch, at: [0, Rb + ch / 2, Lb / 2 - 1.3], n: [0, 1, 0], role: 'decor', color: 'tire' },
    ],
  };
  const children = [...wheels, cab, boiler];
  if (rnd() < 0.7) {
    children.push({
      id: 'bumper', size: [W - 0.4, 1.2], thickness: T, at: [L / 2 + T / 2, -0.1, 0], n: [1, 0, 0],
      u: [0, 0, 1], role: 'decor', color: 'red',
    });
  }
  return {
    id: 'chassis', shape: 'block', size: [L, Hc], thickness: W, faces: [1, -1],
    role: 'core', color: 'tire', children,
  };
}

// ---- カメラ（E7） ----
// 前が +z。胴（丸めた箱、ねじは前後）の前にレンズ（筒とガラスの 2 段の円柱）と握り、後ろに画面、上にファインダーとシャッター
function camera(rnd) {
  const Wc = range(rnd, 5.4, 5.8), Hc = range(rnd, 3.2, 3.6), Dc = 2.4;
  const body = pick(rnd, ['coral', 'sky', 'mint', 'lemon', 'lilac']);
  const g = rnd() < 0.5 ? 1 : -1;   // 握りの側
  const Rl = 1.4, ld = range(rnd, 0.8, 1.2);
  const lens = {
    id: 'lens', shape: 'cylinder', radius: Rl, thickness: ld, at: [-g * 0.5, -0.1, Dc / 2 + ld / 2],
    role: 'frame', color: 'tire',
    children: [
      { id: 'glass', shape: 'cylinder', radius: 1.15, thickness: T, at: [0, 0, ld / 2 + T / 2], role: 'decor', color: 'glass' },
    ],
  };
  const children = [
    lens,
    { id: 'grip', shape: 'block', size: [1.4, Hc - 0.4], thickness: 0.8, at: [g * (Wc / 2 - 0.7), 0, Dc / 2 + 0.4], role: 'outer', color: 'tire' },
    { id: 'screen', size: [Wc - 1.6, Hc - 1.2], thickness: T, at: [0, 0, -Dc / 2 - T / 2], n: [0, 0, -1], role: 'outer', color: 'glass' },
  ];
  if (rnd() < 0.8) children.push({ id: 'finder', shape: 'block', size: [2.4, 1.3], thickness: Dc - 0.6, faces: [1, -1], at: [-g * 1.2, Hc / 2 + 0.65, 0], role: 'outer', color: body });
  if (rnd() < 0.7) children.push({ id: 'shutter', shape: 'cylinder', radius: 1.15, thickness: 0.7, at: [g * (Wc / 2 - 1.25), Hc / 2 + 0.35, 0], n: [0, 1, 0], role: 'decor', color: 'red' });
  return {
    id: 'camera', shape: 'block', size: [Wc, Hc], thickness: Dc, faces: [1, -1],
    role: 'core', color: body, children,
  };
}

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const THEME_BUILDERS = { car, house, animal, robot, plane, ship, rocket, train, camera };
