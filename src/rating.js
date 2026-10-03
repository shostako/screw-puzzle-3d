// クリアの評価（星）と、ステージごとの自己ベスト。DOM にも three.js にも依存しない。
// 2D 版の「クリアの評価」に合わせる: ★3 から、ヒント1回ごと・戻る1回ごとに1つ減らし、
// 遊んだ時間が目安（ねじの本数 × PAR_PER_SCREW 秒）を超えたらもう1つ減らす。最低 ★1。
// 3D は向きを変えて探すぶん 2D（1本 4 秒）より時間がかかるので、目安は1本 6 秒にした。

export const PAR_PER_SCREW = 6;
export const MAX_STARS = 3;

// 目安の時間（秒）
export const parSeconds = (screws) => screws * PAR_PER_SCREW;

// play: { screws: ねじの本数, seconds: 遊んだ時間, hints: ヒントの回数, rewinds: 戻るの回数 }
export function rate({ screws, seconds, hints = 0, rewinds = 0 }) {
  const par = parSeconds(screws);
  const late = seconds > par;
  const stars = Math.max(1, MAX_STARS - hints - rewinds - (late ? 1 : 0));
  return { stars, par, late };
}

// a が b より良いか（星が多い方、同じ星なら速い方）
export const better = (a, b) => !b || a.stars > b.stars || (a.stars === b.stars && a.seconds < b.seconds);

// 「1:05」の形
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// 遊んだ時間を測る時計。止めている間（終わりの画面、アプリが裏に回った間）は数えない。
// now はミリ秒を返す関数（画面では performance.now、テストでは偽の時計）
export function createPlayClock(now) {
  let total = 0;
  let since = null;   // 動いているなら、動き出した時刻
  return {
    get running() { return since !== null; },
    get seconds() { return (total + (since === null ? 0 : now() - since)) / 1000; },
    resume() { if (since === null) since = now(); },
    pause() {
      if (since === null) return;
      total += now() - since;
      since = null;
    },
    reset() {
      total = 0;
      since = null;
    },
  };
}

export const BEST_KEY = 'screw-puzzle-3d.best';

// ステージごとの自己ベスト { [ステージ番号]: { stars, seconds } }。保存先は progress.js と同じく外から渡す。
// 読み書きの失敗や壊れた値は無視する（ベストが無いものとして続ける）
export function createBests(storage) {
  function load() {
    try {
      const all = JSON.parse(storage?.getItem(BEST_KEY) ?? '{}');
      return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    } catch {
      return {};
    }
  }
  const valid = (r) => r && Number.isInteger(r.stars) && r.stars >= 1 && r.stars <= MAX_STARS && Number.isFinite(r.seconds);
  let all = load();
  return {
    get(stage) {
      const r = all[stage];
      return valid(r) ? { stars: r.stars, seconds: r.seconds } : null;
    },
    // 結果を記録する。{ best: 記録後のベスト, old: 前のベスト（無ければ null）, improved: 更新したか }
    record(stage, result) {
      const old = this.get(stage);
      const mine = { stars: result.stars, seconds: Math.round(result.seconds * 10) / 10 };
      const improved = better(mine, old);
      if (improved) {
        all = { ...load(), [stage]: mine };
        try {
          storage?.setItem(BEST_KEY, JSON.stringify(all));
        } catch {
          // 保存できなくても、この回の表示は続ける
        }
      }
      return { best: improved ? mine : old, old, improved };
    },
  };
}
