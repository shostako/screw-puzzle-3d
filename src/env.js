// 艶の映り込み用の簡単な環境（theme.js の env）。起動時に1回だけ PMREM に焼いて、材質の映り込みに使う。
// 盤面（main.js）とマスコット（mascot.js）がそれぞれの描き手で1回ずつ焼く。
import * as THREE from 'three';
import { THEME } from './theme.js';

export function bakeEnvironment(r) {
  const { stops, windows } = THEME.env;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  for (const [o, color] of stops) grad.addColorStop(o, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(20, 16, 8), new THREE.MeshBasicMaterial({ side: THREE.BackSide, map: tex })));
  for (const [x, y, z, w, h] of windows) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(r);
  const out = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  env.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  tex.dispose();
  return out;
}
