// 到達したステージを端末に保存する（M7）。保存先は localStorage を外から渡す形にして、テストでは Map で代用する。
// 保存できない端末（プライベートモードなど）でも遊べるよう、読み書きの失敗は無視してステージ 1 から始める。

export const STORAGE_KEY = 'screw-puzzle-3d.stage';

// storage: getItem / setItem を持つもの（localStorage と同じ形）。null なら保存しない
export function createProgress(storage) {
  function load() {
    try {
      const n = Number.parseInt(storage?.getItem(STORAGE_KEY) ?? '', 10);
      return Number.isInteger(n) && n >= 1 ? n : 1;
    } catch {
      return 1;
    }
  }
  let stage = load();
  return {
    // いま遊ぶステージ（到達した一番先）
    get stage() { return stage; },
    // ステージ n をクリアした。次のステージを保存して返す（前のステージを遊び直してクリアしても、到達は戻さない）
    cleared(n) {
      stage = Math.max(stage, n + 1);
      try {
        storage?.setItem(STORAGE_KEY, String(stage));
      } catch {
        // 保存できなくても、この回の進行は続ける
      }
      return stage;
    },
  };
}

// 端末の localStorage（使えなければ null）
export function deviceStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
