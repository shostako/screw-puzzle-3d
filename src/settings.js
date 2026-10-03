// 設定（後回しの項目「設定」）。音・振動・回す速さ・画質・ネジまるの表示を端末に保存する。
// 保存先は progress.js と同じく localStorage の形を外から渡す（テストでは Map で代用）。DOM にも描画にも依存しない。
// 記録を消す（clearRecords）は、到達したステージと自己ベストだけを消し、設定は残す。

import { STORAGE_KEY as STAGE_KEY } from './progress.js';
import { BEST_KEY } from './rating.js';

export const SETTINGS_KEY = 'screw-puzzle-3d.settings';
// M8 からの音と振動の入り切り（'on' / 'off'）。新しい保存が無いときだけ読む
export const LEGACY_SOUND_KEY = 'screw-puzzle-3d.sound';

// 回す速さ: 指でなぞった量に掛ける倍率
export const SPEEDS = {
  slow: { label: 'ゆっくり', k: 0.7 },
  normal: { label: 'ふつう', k: 1 },
  fast: { label: 'はやい', k: 1.4 },
};
// 画質: 盤面を描く解像度の候補（自動は重ければ順に下げる）、ねじの頭のローレットを刻むか、ネジまるの解像度と待機中の描く間隔
export const QUALITIES = {
  auto: { label: '自動', pixelRatios: [2, 1.5, 1.25, 1], knurl: true, mascotRatio: 2, idleEvery: 2 },
  light: { label: '軽い', pixelRatios: [1], knurl: false, mascotRatio: 1, idleEvery: 4 },
};

export const DEFAULTS = Object.freeze({ sound: true, vibrate: true, speed: 'normal', quality: 'auto', mascot: true });

// 値として受け付けるもの（壊れた値・知らない値は既定に戻す）
const VALID = {
  sound: (v) => typeof v === 'boolean',
  vibrate: (v) => typeof v === 'boolean',
  speed: (v) => Object.hasOwn(SPEEDS, v),
  quality: (v) => Object.hasOwn(QUALITIES, v),
  mascot: (v) => typeof v === 'boolean',
};

export function createSettings(storage) {
  function load() {
    const out = { ...DEFAULTS };
    let saved = null;
    try {
      saved = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null');
    } catch {
      saved = null;
    }
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const k of Object.keys(DEFAULTS)) if (VALID[k](saved[k])) out[k] = saved[k];
    } else {
      // 前の版で音と振動を切っていた端末は、両方とも切ったまま
      try {
        if (storage?.getItem(LEGACY_SOUND_KEY) === 'off') out.sound = out.vibrate = false;
      } catch {
        // 読めなければ既定
      }
    }
    return out;
  }
  let values = load();
  const listeners = new Set();
  return {
    get: (name) => values[name],
    all: () => ({ ...values }),
    // 値を変えて保存する。受け付けない値なら何もせず false
    set(name, value) {
      if (!VALID[name]?.(value)) return false;
      if (values[name] === value) return true;
      values = { ...values, [name]: value };
      try {
        storage?.setItem(SETTINGS_KEY, JSON.stringify(values));
      } catch {
        // 保存できなくても、この回は切り替える
      }
      for (const f of listeners) f(name, value);
      return true;
    },
    // 値が変わったら f(name, value)
    onChange(f) {
      listeners.add(f);
      return () => listeners.delete(f);
    },
  };
}

// 記録（到達したステージと自己ベスト）を消す。設定は残す
export function clearRecords(storage) {
  for (const key of [STAGE_KEY, BEST_KEY]) {
    try {
      storage?.removeItem(key);
    } catch {
      // 消せなければそのまま
    }
  }
}
