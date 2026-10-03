// 遊んでいる途中の局面の保存（E10 続きから遊べる）。再読み込みやアプリの再開で、同じ局面へ戻す。
// 保存先は progress.js と同じく localStorage の形を外から渡す（テストでは Map で代用）。DOM にも描画にも依存しない。
//
// 保存するもの（1つだけ。新しい1局を始めると上書きする）:
//   { v, mode: 遊び方, stage: ステージ番号, sig: 盤面の指紋, path: 外したねじの順番, seconds: 遊んだ時間,
//     hints, rewinds: ヒントと戻るの回数, view: { q: 立体の向きの四元数, d: カメラの距離 }, physics: 物理の写し（無ければ null）, at: 保存した時刻 }
// ルールの状態は path を頭から打ち直して作る（ルールは決定的）。物理は立体を回した向き（重力）の履歴で決まるので
// 打ち直しでは同じにならない。最後の写し（Rapier のスナップショット、数十 KB）を1つだけ持つ。
// 盤面の作りが変わった版の後（指紋が合わない、打ち直しで外せない手がある）は、黙って捨てる。

import { newGame, removeScrew, status, plateState } from './rules.js';

export const RESUME_KEY = 'screw-puzzle-3d.resume';
export const RESUME_VERSION = 1;

// 盤面の指紋。板・ねじ（板と色）・箱の色の順が同じなら同じ値（FNV-1a 32bit を 16 進で）
export function levelSignature(level) {
  const text = [
    level.plates.map((p) => p.id).join(','),
    level.screws.map((s) => `${s.id}:${s.plate}:${s.color}`).join(','),
    level.queue.join(','),
  ].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// 外したねじの順番を頭から打ち直す。打ち直しでは隠れ判定をしない（その時の物理で外せたことは確かめてある）。
// 子の部品が残る親の最後のねじ（held）など、ルールで外せない手があれば null。
// 返すのは { state: 今の局面, history: 各手を外す直前の局面 }（game.js の戻るの履歴と同じ並び）
export function replayPath(level, path) {
  let state = newGame(level);
  const history = [];
  const known = new Set(level.screws.map((s) => s.id));
  for (const id of path) {
    if (!known.has(id)) return null;
    const r = removeScrew(state, id);
    if (!r.ok) return null;
    history.push(state);
    state = r.state;
  }
  return { state, history };
}

// 物理の写し（physics.snapshot()）を JSON にできる形へ。バイト列は base64 の文字列にする
export function encodeSnapshot(snap) {
  if (!snap) return null;
  return { ...snap, bytes: bytesToBase64(snap.bytes) };
}
export function decodeSnapshot(saved) {
  if (!saved || typeof saved.bytes !== 'string') return null;
  return { ...saved, bytes: base64ToBytes(saved.bytes) };
}

function bytesToBase64(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(s);
}
function base64ToBytes(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const isCount = (n) => Number.isInteger(n) && n >= 0;
const MODE_TYPES = new Set(['stage', 'daily', 'random']);

// 保存の形として受け付けるか（壊れた値や前の形は捨てる）
export function validRecord(r) {
  if (!r || typeof r !== 'object' || r.v !== RESUME_VERSION) return false;
  if (!r.mode || !MODE_TYPES.has(r.mode.type)) return false;
  if (r.mode.type === 'stage' && !(Number.isInteger(r.stage) && r.stage >= 1)) return false;
  if (r.mode.type === 'daily' && !Number.isInteger(r.mode.key)) return false;
  if (r.mode.type === 'random' && !(Number.isInteger(r.mode.no) && r.mode.no >= 1 && typeof r.mode.difficulty === 'string')) return false;
  if (typeof r.sig !== 'string' || !Array.isArray(r.path) || !r.path.every((id) => typeof id === 'string')) return false;
  if (!(Number.isFinite(r.seconds) && r.seconds >= 0) || !isCount(r.hints) || !isCount(r.rewinds)) return false;
  return true;
}

// 保存した局面を、今の盤面（level）で戻せる形にする。戻せなければ null（黙ってそのステージの最初から）。
// 返すのは { ...record, state, history, status }。クリア済みの局面は戻さない（クリアの後は次へ進んでいる）
export function restoreRecord(record, level) {
  if (!validRecord(record) || record.sig !== levelSignature(level)) return null;
  const replay = replayPath(level, record.path);
  if (!replay) return null;
  const st = status(replay.state);
  if (st === 'cleared') return null;
  return { ...record, ...replay };
}

// 戻した物理の板の状態（modeOf(板の id) → 'fixed' | 'hanging' | 'loose' | 'gone'）が、ルールの局面と食い違っていないか。
// 食い違えば写しは別の局面のもの（保存の途中で落ちたなど）なので使わない
export function physicsAgrees(st, modeOf) {
  const want = { fixed: ['fixed'], hanging: ['hanging'], fallen: ['loose', 'gone'] };
  return st.level.plates.every((p) => want[plateState(st, p.id)]?.includes(modeOf(p.id)));
}

// storage: getItem / setItem / removeItem を持つもの（localStorage と同じ形）。null なら保存しない
export function createResume(storage) {
  return {
    // 保存した記録（形を確かめたもの）。無い・壊れていれば null
    load() {
      try {
        const r = JSON.parse(storage?.getItem(RESUME_KEY) ?? 'null');
        return validRecord(r) ? r : null;
      } catch {
        return null;
      }
    },
    // 記録を保存する。保存できなかったら false（容量が足りないときは物理の写しを外してもう一度試す）
    save(record) {
      if (!storage) return false;
      const full = { v: RESUME_VERSION, at: Date.now(), ...record };
      try {
        storage.setItem(RESUME_KEY, JSON.stringify(full));
        return true;
      } catch {
        try {
          storage.setItem(RESUME_KEY, JSON.stringify({ ...full, physics: null }));
          return true;
        } catch {
          return false;
        }
      }
    },
    clear() {
      try {
        storage?.removeItem(RESUME_KEY);
      } catch {
        // 消せなければそのまま（次に開いたとき、指紋か打ち直しで捨てられることもある）
      }
    },
  };
}
