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

  // 板: 色を順に回す。隣り合う板が見分けられるよう、明るいクリームと色の板を交互に並べる。
  // E2: D1 の淡い色（明るさ 95% ほど）では白い板がマットに溶けたので、明るさを 85% 前後へ下げて色味を足した。
  // ねじ（鮮やかな色）より淡く保ち、ねじが板の上で埋もれないようにする
  plateColors: ['#fff3dc', '#9ccbff', '#a3e2bd', '#ffdc7a', '#ffb19c', '#c3b4ff', '#f3e9da', '#8fd8d6'],
  labelColor: '#ffc3b0',   // 札（外側に載せた小さな板）
  // 題材（D4）の部品の色。部品の木の color の名前 → 表示の色。ねじの色と紛れないよう、どれも淡いか暗い。
  // E2: 車はボディ色らしく、家は壁と屋根、ぶたはピンクがはっきり分かるよう、D4 より色を濃くした
  partColors: {
    coral: '#ff9b85',
    sky: '#85bdff',
    mint: '#86d9a9',
    lemon: '#ffd257',
    lilac: '#b7a5ff',
    white: '#fff6e6',
    tire: '#454a55',
    glass: '#bfe6ff',
    roof: '#e8775a',
    wall: '#fff0d4',
    door: '#c98b55',
    grass: '#a8dc88',
    pink: '#ffadc2',
    pinkDeep: '#ff8aa8',
    spot: '#fbe9e4',
  },
  // 丸めた箱と円柱（D4）。板より厚いので丸みを大きくする
  block: { corner: 0.5, bevel: 0.22 },
  cylinder: { bevel: 0.1, segments: 32 },
  plate: {
    roughness: 0.32,
    envMapIntensity: 0.45,
    edgeLight: 0.32,   // 面取りの帯（上の面に接する側）を白へ寄せる割合。縁に細い明るい線が出て、板の輪郭が立つ（E2）
    blockEdgeLight: 0.16,   // 丸めた箱と円柱は面取りの帯が太いので弱く
    corner: 0.18,   // 角の丸みの半径。当たりの形より削れるのは角の 0.07 ほどなので、角でかすめて隠すねじも隠れて見える
    bevel: 0.06,    // 縁の丸み（面取り）
  },

  // 板が接する所・重なる所の暗さ（E2）。近くの板（最大 contact.max 枚）を形のまま式で持ち、法線の向きに3点を調べて暗くする。
  // 影の地図や画面全体の後処理（SSAO）を使わないので、描く回数は増えない。画質「軽い」では切る
  contact: {
    max: 6,            // 1枚の板が見る近くの板の数（シェーダーの配列の大きさ）
    reach: 0.45,       // これより離れた板は見ない（盤面の単位）
    steps: [0.08, 0.2, 0.4],   // 法線の向きに調べる距離
    weights: [0.5, 0.32, 0.18],
    strength: 1.15,    // 暗さの強さ
    floor: 0.38,       // これより暗くしない
    direct: 0.55,      // 主光（直接光）にも暗さを効かせる割合（0 なら環境光だけ）
  },

  // キャップボルト: 頭はアルマイト、六角穴は暗く、ねじ部は鋼
  bolt: {
    roughness: 0.3,
    metalness: 0.45,
    envMapIntensity: 0.6,
    socket: '#17191d',
    steel: '#c4c9d0',
  },
  // 色の見分け（E2、設定「ねじ穴の形」を「色ごと」にしたとき）: 色ごとに頭の穴の形を変える。どれも実在するねじの駆動の形。
  // 頭の上面に小さな刻印を打つ案もあったが、画面のねじ頭は径 27px ほどで、穴の周りの帯は 5px ほどしかなく読めない。
  // 頭で一番大きく暗い所が穴なので、穴の形そのものを印にする。HUD の印（style.css の .dot）も同じ形にする
  drives: {
    red: 'hex',        // 六角穴（キャップボルトのまま）
    blue: 'plus',      // 十字穴
    yellow: 'slot',    // すり割り（マイナス）
    green: 'square',   // 四角穴
    purple: 'triangle',// 三角穴
    cyan: 'torx',      // ヘクサロビュラ（トルクス）
    orange: 'spanner', // 二つ穴（スパナ）
    pink: 'triwing',   // トライウィング（Y）
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
  mat: '#f6f9fc',                            // マット。白い板と溶けないよう、真っ白より少し沈めた色
  shade: 'rgba(60, 90, 130, 0.2)',           // マットに落ちる立体の影（ぼかした楕円）
  // 題材ごとの空とマット（E2）。[上, 中ほど, 下, マット]。載っていない種類（家具など）は sky と mat。
  // 章ごとに変えるとき（E8）は、ここに名前を足して skyFor に渡す
  skies: {
    car: ['#7fd0ee', '#e2f6fb', '#fff0cf', '#f5f9fb'],     // 晴れた道: 青緑の空、日なたの下
    house: ['#a9b9ff', '#eeeefe', '#ffe6cf', '#f8f6fb'],   // 夕方の住宅地: 藤色の空、橙の下
    animal: ['#93d6ff', '#e8f8ee', '#eef5cf', '#f6faf2'],  // 牧場: 空色、若草の下
  },

  // HUD
  ink: '#1d2430',
  inkSoft: '#5d6878',
  panel: 'rgba(255, 255, 255, 0.82)',
  hole: '#e3e8ee',
  accent: '#e8a400',
  hint: '#ffd23c',   // ヒントでねじに出す金色の輪
  undo: '#e2412b',   // 解ける所まで戻したとき、分かれ目のねじに出す赤い輪
  held: '#ffb020',   // 子の部品が付いていて親の最後のねじが外せないとき、その子の部品を光らせる色

  // 光: 空の色の半球光 + 右上の主光 + 左奥の青い縁の光。影は描かない（影の分だけもう1回描くことになるため）
  lights: {
    hemi: { sky: '#eaf4ff', ground: '#9a8f80', intensity: 1.5 },
    sun: { color: '#ffffff', intensity: 1.6, position: [4, 7, 9] },
    rim: { color: '#bfe0ff', intensity: 0.7, position: [-8, 5, -7] },
  },

  // 明るさの丸め（E2）: 日の当たる淡い面が白く飛んで色が抜けないよう、色味を保つトーンマップ（Khronos PBR Neutral）で高い所だけ寝かせる
  exposure: 1.1,

  // 映り込み用の簡単な環境（起動時に1回だけ PMREM に焼く）。空のグラデーションと明るい窓
  env: {
    stops: [[0, '#ffffff'], [0.45, '#cfe6ff'], [0.55, '#8a97a8'], [1, '#3a4250']],
    windows: [[8, 8, 4, 8, 4], [-9, 5, -3, 5, 6], [0, 10, -8, 10, 2]],   // [x, y, z, 幅, 高さ]
  },
};

// 盤面の種類（level.meta.kind）か章の名前に合う空とマット。載っていない名前は既定の sky と mat
export function skyFor(name, theme = THEME) {
  const s = theme.skies[name];
  return s ? { sky: s.slice(0, 3), mat: s[3] } : { sky: theme.sky, mat: theme.mat };
}

// 背景の CSS 変数（盤面が変わるたびに main.js が入れ直す）
export function skyVariables(name, theme = THEME) {
  const { sky, mat } = skyFor(name, theme);
  return { '--sky-top': sky[0], '--sky-mid': sky[1], '--sky-bottom': sky[2], '--mat': mat };
}

// HUD の CSS 変数（style.css が使う）
export function cssVariables(theme = THEME) {
  const vars = {
    ...skyVariables(null, theme),
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
