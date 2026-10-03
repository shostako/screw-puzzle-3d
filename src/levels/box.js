// 手で作った固定の盤面: 6枚の板で組んだ立方体の箱（外寸 6）に、中の仕切り板と、天板に載せた小さな札。
//
//   天板 T（上 y=3）・底板 B（下）・前板 F（z=3）・後板 K・左板 L（x=-3）・右板 R、厚みはどれも 0.3。
//   仕切り P: 箱の中の x=0 に立つ板。+x 向きのねじ2本は右板 R に、-x 向きのねじ1本は左板 L に隠れている。
//   札 S: 天板の上に載った 2.5 角の板。天板のねじ t2 を、角が斜めに少しだけ（0.09）かすめて隠している。
//
// ねじは 21 本、4色で箱は7つ。仕切りのねじは、左右の板を落とすまで外せない。

const T = 0.3;            // 板の厚み
const UP = [-Math.PI / 2, 0, 0];   // 法線が +y（局所 x → x、局所 y → -z）
const SIDE = [0, Math.PI / 2, 0];  // 法線が +x（局所 x → -z、局所 y → y）
const FRONT = [0, 0, 0];           // 法線が +z

const plate = (id, size, position, rotation) => ({ id, size, thickness: T, position, rotation });

export const BOX_LEVEL = {
  plates: [
    plate('T', [6, 6], [0, 2.85, 0], UP),
    plate('B', [6, 6], [0, -2.85, 0], UP),
    plate('F', [6, 5.4], [0, 0, 2.85], FRONT),
    plate('K', [6, 5.4], [0, 0, -2.85], FRONT),
    plate('L', [5.4, 5.4], [-2.85, 0, 0], SIDE),
    plate('R', [5.4, 5.4], [2.85, 0, 0], SIDE),
    plate('P', [5.4, 5.4], [0, 0, 0], SIDE),
    plate('S', [2.5, 2.5], [0.6, 3.15, -0.6], UP),
  ],
  screws: [
    // 天板（上向き）。t2 は札 S の角に隠れている
    { id: 't1', plate: 'T', color: 'red', position: [-2, 3, -2], dir: [0, 1, 0] },
    { id: 't2', plate: 'T', color: 'blue', position: [2, 3, -2], dir: [0, 1, 0] },
    { id: 't3', plate: 'T', color: 'yellow', position: [-2, 3, 2], dir: [0, 1, 0] },
    { id: 't4', plate: 'T', color: 'green', position: [2, 3, 2], dir: [0, 1, 0] },
    // 札（上向き）
    { id: 's1', plate: 'S', color: 'red', position: [0, 3.3, -1.2], dir: [0, 1, 0] },
    { id: 's2', plate: 'S', color: 'yellow', position: [1.2, 3.3, 0], dir: [0, 1, 0] },
    // 底板（下向き）
    { id: 'b1', plate: 'B', color: 'blue', position: [-2, -3, -2], dir: [0, -1, 0] },
    { id: 'b2', plate: 'B', color: 'red', position: [2, -3, 2], dir: [0, -1, 0] },
    { id: 'b3', plate: 'B', color: 'yellow', position: [2, -3, -2], dir: [0, -1, 0] },
    { id: 'b4', plate: 'B', color: 'blue', position: [-2, -3, 2], dir: [0, -1, 0] },
    // 前板・後板
    { id: 'f1', plate: 'F', color: 'green', position: [-2, 2, 3], dir: [0, 0, 1] },
    { id: 'f2', plate: 'F', color: 'red', position: [2, -2, 3], dir: [0, 0, 1] },
    { id: 'k1', plate: 'K', color: 'yellow', position: [2, 2, -3], dir: [0, 0, -1] },
    { id: 'k2', plate: 'K', color: 'blue', position: [-2, -2, -3], dir: [0, 0, -1] },
    // 左板・右板
    { id: 'l1', plate: 'L', color: 'red', position: [-3, 2, -2], dir: [-1, 0, 0] },
    { id: 'l2', plate: 'L', color: 'yellow', position: [-3, -2, 2], dir: [-1, 0, 0] },
    { id: 'r1', plate: 'R', color: 'blue', position: [3, 2, 2], dir: [1, 0, 0] },
    { id: 'r2', plate: 'R', color: 'green', position: [3, -2, -2], dir: [1, 0, 0] },
    // 仕切り（中）。p1・p2 は右板に、p3 は左板に隠れている
    { id: 'p1', plate: 'P', color: 'red', position: [0.15, 1.5, 1.5], dir: [1, 0, 0] },
    { id: 'p2', plate: 'P', color: 'blue', position: [0.15, -1.5, -1.5], dir: [1, 0, 0] },
    { id: 'p3', plate: 'P', color: 'yellow', position: [-0.15, 0, 0], dir: [-1, 0, 0] },
  ],
  queue: ['red', 'blue', 'yellow', 'green', 'red', 'blue', 'yellow'],
};
