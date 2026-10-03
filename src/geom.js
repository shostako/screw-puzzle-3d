// 3D の幾何の小道具。three.js に依存しない（ルールと同じく、ブラウザ無しのテストで回すため）。
// ベクトルは [x, y, z] の配列。座標系は three.js と同じ右手系で、y が上。

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = a => Math.sqrt(dot(a, a));
export const neg = a => [-a[0], -a[1], -a[2]];
export function normalize(a) {
  const l = length(a);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
}

// 回転行列（3×3、行ごとの配列）。three.js の Euler（順番 'XYZ'）と同じ: R = Rx · Ry · Rz
export function eulerMatrix([x, y, z]) {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  return [
    [c * e, -c * f, d],
    [af + be * d, ae - bf * d, -b * c],
    [bf - ae * d, be + af * d, a * c],
  ];
}

// 単位四元数 [x, y, z, w] から回転行列（物理ライブラリの姿勢をそのまま受けるため）
export function quaternionMatrix([x, y, z, w]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

export const applyMatrix = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
// 行列の列 = 回した後の局所の軸
export const column = (m, i) => [m[0][i], m[1][i], m[2][i]];

// 凸な形の支持関数どうしで交わりを調べる（GJK）。
// support(d) は、その形の中で d の向きに一番遠い点。2つの形の差（ミンコフスキー差）が原点を含めば交わっている。
// 触れているだけ（重なりの体積が 0）は、どちらに転んでもよい境目なので、呼ぶ側で形を少し縮めて「交わらない」に寄せる。
const MAX_ITER = 64;

export function intersects(supportA, supportB) {
  const support = d => sub(supportA(d), supportB(neg(d)));
  let d = [1, 0, 0];
  let simplex = [support(d)];
  d = neg(simplex[0]);
  for (let i = 0; i < MAX_ITER; i++) {
    if (dot(d, d) < 1e-24) return true;   // 原点が単体の上にある
    const a = support(d);
    if (dot(a, d) <= 0) return false;      // d の向きに原点を越えられない = 離れている
    simplex = [a, ...simplex];
    const next = nearest(simplex);
    if (next === true) return true;
    [simplex, d] = next;
  }
  // 収束しないのは、縮めた形どうしが触れるか触れないかの境目にいるとき。触れているだけとみなす
  return false;
}

const same = (a, b) => dot(a, b) > 0;

// 単体（新しい点が先頭）のうち原点に一番近い部分と、次に探す向きを返す。原点を含めば true
function nearest(s) {
  if (s.length === 2) return line(s[0], s[1]);
  if (s.length === 3) return triangle(s[0], s[1], s[2]);
  return tetrahedron(s[0], s[1], s[2], s[3]);
}

function line(a, b) {
  const ab = sub(b, a), ao = neg(a);
  if (same(ab, ao)) return [[a, b], cross(cross(ab, ao), ab)];
  return [[a], ao];
}

function triangle(a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ao = neg(a);
  const abc = cross(ab, ac);
  if (same(cross(abc, ac), ao)) {
    if (same(ac, ao)) return [[a, c], cross(cross(ac, ao), ac)];
    return line(a, b);
  }
  if (same(cross(ab, abc), ao)) return line(a, b);
  if (same(abc, ao)) return [[a, b, c], abc];
  return [[a, c, b], neg(abc)];
}

function tetrahedron(a, b, c, d) {
  const ab = sub(b, a), ac = sub(c, a), ad = sub(d, a), ao = neg(a);
  if (same(cross(ab, ac), ao)) return triangle(a, b, c);
  if (same(cross(ac, ad), ao)) return triangle(a, c, d);
  if (same(cross(ad, ab), ao)) return triangle(a, d, b);
  return true;
}

// 頂点の集まり（凸多面体）の支持関数
export const pointsSupport = points => d => {
  let best = points[0], bd = dot(best, d);
  for (let i = 1; i < points.length; i++) {
    const v = dot(points[i], d);
    if (v > bd) { bd = v; best = points[i]; }
  }
  return best;
};

// 円柱の支持関数: 底面の中心 from から to まで、半径 r
export function cylinderSupport(from, to, r) {
  const axis = normalize(sub(to, from));
  return d => {
    const end = dot(d, axis) >= 0 ? to : from;
    const radial = sub(d, scale(axis, dot(d, axis)));
    const l = length(radial);
    return l > 1e-12 ? add(end, scale(radial, r / l)) : end;
  };
}

// 回転行列から単位四元数 [x, y, z, w]（板の向きを物理ライブラリへ渡すため）
export function matrixQuaternion(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const tr = a + e + i;
  let x, y, z, w;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    w = 0.25 / s; x = (h - f) * s; y = (c - g) * s; z = (d - b) * s;
  } else if (a > e && a > i) {
    const s = 2 * Math.sqrt(1 + a - e - i);
    w = (h - f) / s; x = 0.25 * s; y = (b + d) / s; z = (c + g) / s;
  } else if (e > i) {
    const s = 2 * Math.sqrt(1 + e - a - i);
    w = (c - g) / s; x = (b + d) / s; y = 0.25 * s; z = (f + h) / s;
  } else {
    const s = 2 * Math.sqrt(1 + i - a - e);
    w = (d - b) / s; x = (c + g) / s; y = (f + h) / s; z = 0.25 * s;
  }
  return [x, y, z, w];
}
