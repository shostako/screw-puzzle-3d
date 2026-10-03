import * as THREE from 'three';

// M1 の仮の立体。6枚の板で組んだ箱に、各面1本ずつねじ頭の目印を付ける。
// 面ごとに色を変えて、回したときにどの面が見えているか分かるようにする。
// 本物の盤面データと描画は M3・M4 で作る。

const SIZE = 2.4; // 箱の外寸
const T = 0.16; // 板の厚み
const PLATE_COLORS = [0xe9c99a, 0xdcb684, 0xf0d6ae, 0xd4a974, 0xe3bf8c, 0xcf9f6a];
const SCREW_COLORS = [0xe0533d, 0x3a86d8, 0x45b363, 0xf2b632, 0x9b5bd1, 0x2fb5b0];

export function createPlaceholderBox() {
  const group = new THREE.Group();
  const h = SIZE / 2;
  // 各面: 法線、板の寸法（法線方向が厚み）
  const faces = [
    { n: [0, 0, 1], dims: [SIZE, SIZE, T] },
    { n: [0, 0, -1], dims: [SIZE, SIZE, T] },
    { n: [1, 0, 0], dims: [T, SIZE - 2 * T, SIZE - 2 * T] },
    { n: [-1, 0, 0], dims: [T, SIZE - 2 * T, SIZE - 2 * T] },
    { n: [0, 1, 0], dims: [SIZE - 2 * T, T, SIZE - 2 * T] },
    { n: [0, -1, 0], dims: [SIZE - 2 * T, T, SIZE - 2 * T] },
  ];

  const headGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 24);
  const slotGeo = new THREE.BoxGeometry(0.3, 0.035, 0.05);

  faces.forEach(({ n, dims }, i) => {
    const normal = new THREE.Vector3(...n);
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(...dims),
      new THREE.MeshStandardMaterial({ color: PLATE_COLORS[i], roughness: 0.8 }),
    );
    plate.position.copy(normal).multiplyScalar(h - T / 2);
    group.add(plate);

    // ねじ頭: 円柱の軸（+Y）を面の法線へ向ける
    const screw = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: SCREW_COLORS[i], roughness: 0.4, metalness: 0.1 });
    screw.add(new THREE.Mesh(headGeo, mat));
    const slot = new THREE.Mesh(slotGeo, new THREE.MeshStandardMaterial({ color: 0x2b2118 }));
    slot.position.y = 0.04;
    screw.add(slot);
    screw.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    // 面の中央から少しずらして、回したときに向きが分かるようにする（法線方向の成分は 0）
    const offset = new THREE.Vector3(0.45, 0.45, 0.45).multiply(new THREE.Vector3(1 - Math.abs(n[0]), 1 - Math.abs(n[1]), 1 - Math.abs(n[2])));
    screw.position.copy(normal).multiplyScalar(h + 0.05).add(offset);
    group.add(screw);
  });

  return group;
}
