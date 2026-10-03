// 見た目の表（テーマ）。色・材質・光・背景はここだけで決める。
// 3D（scene.js・main.js）はこの表から材質と光を作り、HUD の CSS の色（--red など）は main.js が起動時にここから入れる。
// 雰囲気は「おもちゃブロック調」（docs/DECISIONS.md）: 淡い色の艶のある丸い板、カラーのキャップボルト、空色のグラデーションと白い丸いマット。

export const THEME = {
  // ねじの色（ルールの色の名前 → 表示の色）。アルマイトのような鮮やかな色
  screwColors: {
    red: '#e0473a',
    blue: '#2f7fe0',
    yellow: '#f3b81f',
    green: '#3aae5a',
    purple: '#9354d6',
    cyan: '#22b3ad',
    orange: '#f07a22',
    pink: '#eb5c9c',
  },

  // 板: 淡い色を順に回す。隣り合う板が見分けられるよう、白と淡い色を交互に並べる
  plateColors: ['#fbf8f1', '#cfe5ff', '#d3f2df', '#fff0c4', '#ffdcd0', '#e2dbff', '#f4f6f8', '#c8eef0'],
  labelColor: '#ffd0c2',   // 札（外側に載せた小さな板）
  plate: {
    roughness: 0.32,
    envMapIntensity: 0.45,
    corner: 0.18,   // 角の丸みの半径。当たりの形より削れるのは角の 0.07 ほどなので、角でかすめて隠すねじも隠れて見える
    bevel: 0.06,    // 縁の丸み（面取り）
  },

  // キャップボルト: 頭はアルマイト、六角穴は暗く、ねじ部は鋼
  bolt: {
    roughness: 0.3,
    metalness: 0.45,
    envMapIntensity: 0.6,
    socket: '#17191d',
    steel: '#c4c9d0',
  },

  // マスコット「ネジまる」（mascot.js）: 金色アルマイトの頭、銀のねじ部と脚、白いソフビの腕と手袋、青い靴、黒い六角レンチ
  mascot: {
    gold: '#ffbf00',
    steel: '#cfd2d6',
    vinyl: '#f6f5f1',
    shoe: '#1d5fd8',
    key: '#26282c',
    socket: '#2b2d31',
    ink: '#1a1210',
    eyeWhite: '#ffffff',
    iris: '#3a1d0c',
    irisLow: '#7d4a1e',
    cheek: '#ff8fa3',
    mouth: '#5c1414',
    tongue: '#ff7f9a',
    sweat: '#52b8ff',
    shadow: '#3c5a82',   // 足もとの影（半透明の楕円）
    shadowOpacity: 0.2,
  },

  // 背景（CSS で描く。3D の外なので描く負荷が無い）
  sky: ['#9fd3ff', '#e6f4ff', '#fff4d6'],   // 上・中ほど・下
  mat: '#ffffff',
  shade: 'rgba(60, 90, 130, 0.16)',          // マットに落ちる立体の影（ぼかした楕円）

  // HUD
  ink: '#1d2430',
  inkSoft: '#5d6878',
  panel: 'rgba(255, 255, 255, 0.82)',
  hole: '#e3e8ee',
  accent: '#e8a400',
  hint: '#ffd23c',   // ヒントでねじに出す金色の輪
  undo: '#e2412b',   // 解ける所まで戻したとき、分かれ目のねじに出す赤い輪

  // 光: 空の色の半球光 + 右上の主光 + 左奥の青い縁の光。影は描かない（影の分だけもう1回描くことになるため）
  lights: {
    hemi: { sky: '#eaf4ff', ground: '#9a8f80', intensity: 1.5 },
    sun: { color: '#ffffff', intensity: 1.6, position: [4, 7, 9] },
    rim: { color: '#bfe0ff', intensity: 0.7, position: [-8, 5, -7] },
  },

  // 映り込み用の簡単な環境（起動時に1回だけ PMREM に焼く）。空のグラデーションと明るい窓
  env: {
    stops: [[0, '#ffffff'], [0.45, '#cfe6ff'], [0.55, '#8a97a8'], [1, '#3a4250']],
    windows: [[8, 8, 4, 8, 4], [-9, 5, -3, 5, 6], [0, 10, -8, 10, 2]],   // [x, y, z, 幅, 高さ]
  },
};

// HUD の CSS 変数（style.css が使う）
export function cssVariables(theme = THEME) {
  const vars = {
    '--sky-top': theme.sky[0],
    '--sky-mid': theme.sky[1],
    '--sky-bottom': theme.sky[2],
    '--mat': theme.mat,
    '--shade': theme.shade,
    '--ink': theme.ink,
    '--ink-soft': theme.inkSoft,
    '--panel': theme.panel,
    '--hole': theme.hole,
    '--accent': theme.accent,
  };
  for (const [name, c] of Object.entries(theme.screwColors)) vars[`--${name}`] = c;
  return vars;
}
