/* =====================================================================================
 *  Isha Yoga Center —— Three.js 程序化场景
 *  建模与代码：Claude（Anthropic），2026-11
 *  所有几何体与贴图均由代码生成；Three.js 由 Vite 打包。
 *
 *  代码结构（想改哪里就搜对应的标题）：
 *    [1] 引擎加载        import('three')
 *    [2] 配置            MOODS（时段色调）/ geo()（实测坐标换算）/ ROADS（道路）/ FIELDS（农田）
 *    [3] 通用工具        噪声、贴图生成、tbox/tcyl/mesh、合并与实例化
 *    [4] 环境组件        createSky / createTerrain / createPaths / createVegetation / createLamps / createDust / createPeople（行人与牛车）
 *    [5] 建筑组件        createAdiyogi / createDhyanalinga / createNandi / createLingaBhairavi / createSadhanaHalls /
 *                        createSuryakund / createNagaShrine / createChandrakund / createLotusPonds / createAdiyogiAlayam /
 *                        createSpandaHall / createBhikshaHall / createIshaLife / createDepositCounter / createWelcomePoint /
 *                        createNalanda / createSarpaVasal / createMoondramPirai / createUnavagam / createMetalBridge / createCampus /
 *                        createMalaiVasal / createKalabhairava
 *    [6] 组件注册表      COMPONENTS —— 位置（实测坐标）、朝向、镜头、说明都在这里，改一行即可挪动建筑
 *    [7] 渲染器、阴影跟随 fitShadow、轨道相机 createControls、漫步模式 createWalker、时段切换、界面、加载流程与主循环
 *
 *  位置数据来自 OpenStreetMap，按 1:1 比例摆放，并对照 Isha 官方 2026 园区地图；建筑内外参照 Isha 官网、Wikimedia Commons 与访客照片建模。
 *
 *  每个建筑组件都是一个返回 THREE.Group 的函数，局部坐标里“正面”朝 +Z，
 *  需要动画时给 group.userData.update = (t, dt) => {} 即可。
 * ===================================================================================== */

import { clamp, lerp } from './math';

// ───────────────────────────── [1] 引擎加载 ─────────────────────────────
const $ = (s) => document.querySelector(s);
const setProgress = (p, label) => {
  $('#bar i').style.width = Math.round(p * 100) + '%';
  if (label) $('#step').textContent = label;
};
const nextFrame = () =>
  new Promise((r) => {
    requestAnimationFrame(() => r());
    setTimeout(r, 60);
  }); // 后台标签页里 rAF 会暂停，用定时器兜底

let THREE, createControls, createWalker;
try {
  [THREE, { createControls, createWalker }] = await Promise.all([
    import('three'),
    import('./camera-controls'),
  ]);
} catch (error) {
  $('#step').textContent = '无法加载 three.js，请刷新页面重试';
  throw error;
}
setProgress(0.06, '引擎就绪');

const V3 = THREE.Vector3,
  Color = THREE.Color;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ───────────────────────────── [2] 配置 ─────────────────────────────
// 时段色调：改这里的数值就能调整整体氛围
const deg = Math.PI / 180;
const MOODS = {
  dawn: {
    name: '晨曦',
    el: 24 * deg,
    az: 28 * deg,
    sunCol: new Color(0xffc48a),
    sunInt: 3.0,
    hemiSky: new Color(0xbccde6),
    hemiGnd: new Color(0x6e5a46),
    hemiInt: 1.15,
    fog: new Color(0xe4c9a8),
    fogD: 0.00046,
    top: new Color(0x587fc0),
    horizon: new Color(0xf2cda4),
    exposure: 1.0,
    lamp: 0.22,
    stars: 0,
  },
  dusk: {
    name: '黄昏',
    el: 9 * deg,
    az: 168 * deg,
    sunCol: new Color(0xff8348),
    sunInt: 2.1,
    hemiSky: new Color(0x9c88ba),
    hemiGnd: new Color(0x4c3a34),
    hemiInt: 0.62,
    fog: new Color(0xcf8a6c),
    fogD: 0.00058,
    top: new Color(0x38448a),
    horizon: new Color(0xf29258),
    exposure: 0.98,
    lamp: 0.8,
    stars: 0.25,
  },
  night: {
    name: '夜晚',
    el: 42 * deg,
    az: 205 * deg,
    sunCol: new Color(0x8ea6ff),
    sunInt: 0.55,
    hemiSky: new Color(0x2c3c6a),
    hemiGnd: new Color(0x0f1119),
    hemiInt: 0.4,
    fog: new Color(0x0e1629),
    fogD: 0.00052,
    top: new Color(0x050a1c),
    horizon: new Color(0x18264a),
    exposure: 1.12,
    lamp: 1.0,
    stars: 1,
  },
};

/* 坐标系：所有位置都用“实测地理坐标”书写 —— (e, n) = 以 Dhyanalinga 穹顶为原点，向东 / 向北的米数，
 * 数据取自 OpenStreetMap（1:1 比例）。geo() 把它换算成场景坐标：+X 朝东，+Z 朝南，场景中心在园区与 Adiyogi 之间。
 * face(fe, fn) 把“朝向哪个方位”换算成组件的 rotY（组件局部 +Z 为正面）。 */
const geo = (e, n) => [e - 250, 0, -n - 150];
const face = (fe, fn) => Math.atan2(fe, -fn);
const AX = face(0.992, -0.126); // Dhyanalinga → Nandi → 莲池桥 → Suryakund 这条主轴的实际走向：正东偏南约 7°

// 道路折线：[[e, n], ...] + 宽度。PATHS 由它展开成线段 [x1, z1, x2, z2, w]
const ROADS = [
  {
    w: 8,
    pts: [
      [769, -1705],
      [749, -1675],
      [744, -1637],
      [739, -1593],
      [724, -1562],
      [716, -1544],
      [695, -1503],
      [632, -1310],
      [581, -1154],
      [577, -1142],
    ],
  }, // Adi Yogi Isha Rd（Malai Vasal → Adiyogi，OSM）
  {
    w: 12,
    pts: [
      [577, -1142],
      [562, -1091],
      [557, -1068],
      [559, -890],
      [562, -730],
    ],
  }, // Malai Vasal → Adiyogi 中轴步道（OSM）
  {
    w: 9,
    pts: [
      [26, -1022],
      [2, -726],
      [2, -523],
      [130, -286],
      [178, -198],
      [265, -118],
      [336, -38],
      [379, 20],
      [445, 56],
    ],
  }, // Narasipuram Road
  {
    w: 8,
    pts: [
      [562, -730],
      [535, -680],
      [526, -655],
      [526, -608],
      [529, -503],
      [510, -482],
      [444, -394],
      [371, -318],
      [285, -256],
      [229, -228],
      [196, -196],
    ],
  }, // Adiyogi → Sarpa Vasal 步行道
  {
    w: 6,
    pts: [
      [190, -175],
      [168, -128],
      [142, -63],
      [131, -49],
      [112, -46],
      [94, -43],
      [78, -38],
      [52, -38],
    ],
  }, // Sarpa Vasal → Nandi 广场
  {
    w: 4,
    pts: [
      [52, -38],
      [55, -22],
      [58, -3],
      [62, 17],
      [78, 19],
      [101, 19],
      [121, 18],
      [137, 13],
      [143, -6],
      [141, -20],
      [138, -38],
      [131, -49],
    ],
  }, // 环莲池步道
  {
    w: 4,
    pts: [
      [58, -9],
      [70, -10],
      [88, -11],
      [93, -12.5],
    ],
  }, // Nandi → 拱桥
  {
    w: 4,
    pts: [
      [115, -16.3],
      [141, -20],
      [147, -20.5],
    ],
  }, // 拱桥 → Suryakund
  {
    w: 5,
    pts: [
      [62, 17],
      [66, 33],
      [72, 70],
      [78, 105],
      [84, 142],
      [97, 180],
      [107, 232],
      [117, 250],
      [142, 265],
      [199, 272],
      [231, 275],
      [249, 316.5],
    ],
  }, // 南北主路 → Bhiksha Hall（第十轮：路口从 (246,318) 东移，避开 Bhiksha Hall 台基的东南角）
  {
    w: 5,
    pts: [
      [84, 142],
      [146, 183],
    ],
  }, // → Spanda Hall
  {
    w: 4,
    pts: [
      [84, 142],
      [63, 123],
      [44, 115],
      [15, 105],
      [-24, 102],
      [-59, 97],
      [-58, 55],
      [-68, 10],
      [-73, -53],
    ],
  }, // 西侧环路（Sadhana Halls、Chandra Vasal）
  {
    w: 4,
    pts: [
      [-73, -53],
      [16, -47],
      [45, -54],
      [52, -38],
    ],
  }, // 南侧小路
  {
    w: 3,
    pts: [
      [31, -42],
      [-14, -38],
      [-24, -22],
    ],
  }, // → Linga Bhairavi
  {
    w: 4,
    pts: [
      [97, 180],
      [-80, 174],
      [-84, 250],
      [-85, 350],
      [40, 352],
      [88, 344],
      [100, 300],
      [112, 238],
    ],
  }, // 环 Nalanda Grounds 步道
  {
    w: 4,
    pts: [
      [142, -63],
      [221, -74],
      [232, 0],
    ],
  }, // Suryakund 南侧、东侧
  {
    w: 3,
    pts: [
      [62, 17],
      [44, 40],
      [38, 52],
    ],
  }, // → Chandrakund、寄存处
  {
    w: 5,
    pts: [
      [254, 320.5],
      [262, 338],
      [300, 346],
      [356, 354],
    ],
  }, // Bhiksha Hall → Metal Bridge
  {
    w: 5,
    pts: [
      [388, 358.5],
      [420, 364],
    ],
  }, // 桥东（通往 Velliangiri Prashala，未建模）
  {
    w: 4,
    pts: [
      [178, -198],
      [188, -212],
    ],
  }, // → Moondram Pirai
];
const PATHS = [];
for (const r of ROADS)
  for (let i = 0; i < r.pts.length - 1; i++) {
    const a = geo(...r.pts[i]),
      b = geo(...r.pts[i + 1]);
    PATHS.push([a[0], a[2], b[0], b[2], r.w]);
  }
// 农田 / 草场色块：[e, n, 东西宽, 南北长, 颜色]
const FIELDS = [
  [627, -1200, 80, 110, 0x8e8a82],
  [633, -1098, 70, 85, 0x8e8a82],
  [305, -222, 170, 60, 0x8e8a82], // 停车场（OSM）
  [514, -914, 75, 300, 0x93ad5a],
  [630, -914, 110, 300, 0x93ad5a], // 中轴两侧的大草场（OSM leisure=pitch）
  [353, -467, 220, 220, 0x86a84e],
  [648, -790, 130, 420, 0x7fa54a],
  [840, -344, 380, 640, 0xa3945e],
  [176, -774, 105, 240, 0x96a257],
  [165, -1036, 180, 250, 0xa8935f],
  [424, -15, 130, 115, 0x99a653],
  [780, -1060, 300, 640, 0x9da05a],
];
const inField = (e, n) =>
  FIELDS.some(
    ([fe, fn, w, h]) => Math.abs(e - fe) < w / 2 && Math.abs(n - fn) < h / 2,
  );
let EXCLUDE = []; // 植被避让圈 [x, z, r]，由组件注册表里的 clear 自动生成
let PITS = []; // 下沉水池在地形上开的洞，由注册表里的 pit 自动生成

// ───────────────────────────── [3] 通用工具 ─────────────────────────────
function mulberry(seed) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry(20260);
const rr = (a, b) => a + (b - a) * rnd();

function hash(i, j) {
  let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    xf = x - xi,
    yf = y - yi;
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  return lerp(
    lerp(hash(xi, yi), hash(xi + 1, yi), u),
    lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u),
    v,
  );
}
function fbm(x, y, o = 4) {
  let a = 0.5,
    s = 0,
    n = 0;
  for (let i = 0; i < o; i++) {
    s += a * vnoise(x, y);
    n += a;
    x *= 2.03;
    y *= 2.03;
    a *= 0.5;
  }
  return s / n;
}

// 地面高度：园区与 Adiyogi 一带为平地；韦灵吉里群山在西侧隆起，并向西北延伸（圆润的林地山体）
function groundH(x, z) {
  const r = Math.hypot(x, z);
  const west = smooth(-620, -1700, x);
  const north = smooth(-950, -2100, z) * 0.75 * smooth(700, -500, x);
  const ring = smooth(1500, 2600, r) * 0.2;
  const m = Math.max(west, north, ring);
  const ridge = fbm(x * 0.0013 + 7.3, z * 0.0013 + 3.1, 3);
  let h = m * (120 + 760 * ridge);
  // 远处地面的小起伏；从 Adiyogi 往南到 Malai Vasal 的这条走廊保持平坦（街景里是平地）
  const ax = 312,
    az = 479,
    bx = 520,
    bz = 1560,
    dx = bx - ax,
    dz = bz - az,
    t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
  const dCor = Math.hypot(x - ax - dx * t, z - az - dz * t);
  h +=
    smooth(900, 1300, r) *
    smooth(160, 320, dCor) *
    (fbm(x * 0.012, z * 0.012, 3) - 0.5) *
    10;
  return h;
}

// —— 程序化贴图 ——
function canvasTex(size, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const TR = mulberry(20261118); // 贴图用的随机数：固定种子，每次打开都一样，方便前后截图对比
function speckle(g, s, n, amp = 0.12, max = 3) {
  for (let i = 0; i < n; i++) {
    const a = TR() * amp;
    g.fillStyle = TR() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    const w = 1 + TR() * max;
    g.fillRect(TR() * s, TR() * s, w, w);
  }
}
const TEX = {},
  MAT = {};
const FX = { emissive: [], glows: [], lights: [], tint: [] }; // 随时段变化的发光体
const emi = (mat, base) => {
  FX.emissive.push({ mat, base });
  return mat;
};

function buildTextures() {
  TEX.brick = canvasTex(256, (g, s) => {
    g.fillStyle = '#b9a48c';
    g.fillRect(0, 0, s, s);
    for (let r = 0; r < 8; r++)
      for (let c = -1; c < 4; c++) {
        g.fillStyle = `hsl(${20 + TR() * 12},${38 + TR() * 14}%,${52 + TR() * 16}%)`;
        g.fillRect(c * 64 + (r % 2) * 32 + 2, r * 32 + 2, 60, 28);
      }
    speckle(g, s, 2500, 0.1);
  });
  TEX.stone = canvasTex(256, (g, s) => {
    g.fillStyle = '#c9c6c0';
    g.fillRect(0, 0, s, s);
    for (let r = 0; r < 4; r++)
      for (let c = -1; c < 2; c++) {
        g.fillStyle = `hsl(35,${4 + TR() * 6}%,${70 + TR() * 14}%)`;
        g.fillRect(c * 128 + (r % 2) * 64 + 2, r * 64 + 2, 124, 60);
      }
    speckle(g, s, 5000, 0.14);
  });
  TEX.paving = canvasTex(256, (g, s) => {
    g.fillStyle = '#9d9488';
    g.fillRect(0, 0, s, s);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        g.fillStyle = `hsl(34,${10 + TR() * 8}%,${72 + TR() * 12}%)`;
        g.fillRect(c * 64 + 2, r * 64 + 2, 60, 60);
      }
    speckle(g, s, 4000, 0.12);
  });
  TEX.tile = canvasTex(256, (g, s) => {
    for (let r = 0; r < 8; r++) {
      const gr = g.createLinearGradient(0, r * 32, 0, r * 32 + 32);
      gr.addColorStop(0, '#7c3f28');
      gr.addColorStop(0.25, '#c9714a');
      gr.addColorStop(1, '#e08a5c');
      g.fillStyle = gr;
      g.fillRect(0, r * 32, s, 32);
      g.fillStyle = 'rgba(60,25,12,.55)';
      for (let c = 0; c < 9; c++)
        g.fillRect(c * 32 + (r % 2) * 16 - 1, r * 32, 3, 32);
    }
    speckle(g, s, 2500, 0.12);
  });
  TEX.plaster = canvasTex(256, (g, s) => {
    g.fillStyle = '#efeae2';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 5000, 0.07, 4);
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(90,70,50,${TR() * 0.05})`;
      g.fillRect(TR() * s, 0, 6 + TR() * 20, s);
    }
  });
  TEX.ground = canvasTex(256, (g, s) => {
    g.fillStyle = '#e4e4e4';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 9000, 0.16, 2);
  });
  TEX.water = canvasTex(256, (g, s) => {
    g.fillStyle = '#9fb8b4';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(255,255,255,.5)';
    g.lineWidth = 1.6;
    for (let i = 0; i < 46; i++) {
      const x = TR() * s,
        y = TR() * s,
        w = 14 + TR() * 34;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + w / 2, y + (TR() - 0.5) * 12, x + w, y);
      g.stroke();
    }
  });
  TEX.fall = canvasTex(128, (g, s) => {
    g.fillStyle = '#b9d2d4';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + TR() * 0.5})`;
      g.fillRect(TR() * s, TR() * s, 1.5, 10 + TR() * 40);
    }
  });
  TEX.glow = canvasTex(
    128,
    (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.25, 'rgba(255,255,255,.45)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
    },
    false,
  );
}
function signTex(text, bg = '#3a2415', fg = '#f0d9a8') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = fg;
  g.lineWidth = 3;
  g.strokeRect(8, 8, 496, 112);
  g.fillStyle = fg;
  let fs = 58;
  do {
    g.font = `600 ${fs}px Georgia, serif`;
    fs -= 3;
  } while (g.measureText(text).width > 460 && fs > 16);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function buildMaterials() {
  const std = (o, s) => {
    const m = new THREE.MeshStandardMaterial(o);
    m.userData.s = s;
    return m;
  };
  MAT.brick = std({ map: TEX.brick, color: 0xc08a5e, roughness: 0.95 }, 2.4);
  MAT.granite = std({ map: TEX.stone, color: 0x9a968e, roughness: 0.9 }, 4);
  MAT.sandstone = std({ map: TEX.stone, color: 0xd2ad7c, roughness: 0.92 }, 4);
  MAT.darkStone = std({ map: TEX.stone, color: 0x55545a, roughness: 0.8 }, 4);
  MAT.paving = std({ map: TEX.paving, color: 0xc4b196, roughness: 0.95 }, 4);
  MAT.tile = std({ map: TEX.tile, color: 0xe0a184, roughness: 0.85 }, 3);
  MAT.plaster = std({ map: TEX.plaster, color: 0xead9bd, roughness: 0.95 }, 6);
  MAT.redPlaster = std(
    { map: TEX.plaster, color: 0xa2412b, roughness: 0.9 },
    6,
  );
  MAT.wood = std({ color: 0x5a3a22, roughness: 0.8 }, 4);
  MAT.black = std({ color: 0x15151a, roughness: 0.35, metalness: 0.3 }, 4);
  MAT.gold = std(
    {
      color: 0xd9a441,
      roughness: 0.35,
      metalness: 0.85,
      emissive: 0x6a3d08,
      emissiveIntensity: 0.6,
    },
    4,
  );
  MAT.copper = emi(
    std(
      {
        color: 0xc8703a,
        roughness: 0.4,
        metalness: 0.8,
        emissive: 0xc05a1c,
        emissiveIntensity: 0.5,
      },
      4,
    ),
    0.55,
  );
  MAT.silver = emi(
    std(
      {
        color: 0xdfe6f0,
        roughness: 0.3,
        metalness: 0.8,
        emissive: 0x8fa6d8,
        emissiveIntensity: 0.5,
      },
      4,
    ),
    0.6,
  );
  MAT.steel = new THREE.MeshStandardMaterial({
    color: 0x6b7890,
    roughness: 0.55,
    metalness: 0.3,
  }); // Adiyogi 的蓝黑色钢板
  MAT.mud = std(
    { map: TEX.plaster, color: 0xa86a48, roughness: 1, side: THREE.DoubleSide },
    6,
  ); // Dhyanalinga 穹顶的泥灰抹面
  MAT.salmon = std(
    {
      map: TEX.plaster,
      color: 0xd9917c,
      roughness: 0.7,
      metalness: 0.1,
      side: THREE.DoubleSide,
    },
    6,
  ); // 浅粉色金属屋面
  MAT.darkPlaster = std(
    { map: TEX.plaster, color: 0x7a6756, roughness: 0.95 },
    6,
  );
  MAT.redPaver = std({ map: TEX.paving, color: 0xb5796a, roughness: 0.95 }, 4);
  MAT.moon = emi(
    std(
      {
        color: 0xf2e6c0,
        roughness: 0.4,
        metalness: 0.5,
        emissive: 0xd8c48a,
        emissiveIntensity: 0.5,
      },
      4,
    ),
    0.7,
  );
  MAT.lotus = std({ color: 0xe88aa8, roughness: 0.7 }, 4);
  MAT.metalRoof = std(
    {
      color: 0x8794a0,
      roughness: 0.45,
      metalness: 0.5,
      side: THREE.DoubleSide,
    },
    4,
  );
  MAT.red = std({ color: 0xb3261c, roughness: 0.8, side: THREE.DoubleSide }, 4);
  MAT.straw = std({ color: 0xc9a85e, roughness: 1 }, 4);
  MAT.lawn = std({ map: TEX.ground, color: 0x5f8a3c, roughness: 1 }, 5);
  MAT.leaf = new THREE.MeshLambertMaterial({
    color: 0x4f7a34,
    flatShading: true,
  });
  MAT.white = std({ color: 0xf2efe8, roughness: 0.8 }, 4);
  MAT.window = emi(
    std(
      {
        color: 0x2a1a10,
        roughness: 0.3,
        emissive: 0xffb055,
        emissiveIntensity: 1,
      },
      4,
    ),
    1.7,
  );
  MAT.doorGlow = emi(
    std(
      {
        color: 0x2a1408,
        roughness: 0.5,
        emissive: 0xff9a3c,
        emissiveIntensity: 1,
      },
      4,
    ),
    2.2,
  );
  MAT.redGlow = emi(
    std(
      {
        color: 0x2a0806,
        roughness: 0.5,
        emissive: 0xff4a1c,
        emissiveIntensity: 1,
      },
      4,
    ),
    2.0,
  );
  MAT.flame = new THREE.MeshBasicMaterial({ color: 0xffc070 });
  MAT.water = std(
    {
      map: TEX.water,
      color: 0x2f9a8c,
      roughness: 0.12,
      metalness: 0.15,
      transparent: true,
      opacity: 0.9,
      emissive: 0x0e5a52,
      emissiveIntensity: 0.35,
    },
    4,
  );
  MAT.waterBlue = std(
    {
      map: TEX.water,
      color: 0x4a86b8,
      roughness: 0.12,
      metalness: 0.15,
      transparent: true,
      opacity: 0.9,
      emissive: 0x1a3f6a,
      emissiveIntensity: 0.4,
    },
    4,
  );
  MAT.fall = new THREE.MeshStandardMaterial({
    map: TEX.fall,
    color: 0xdff0f0,
    roughness: 0.3,
    transparent: true,
    opacity: 0.85,
    emissive: 0x88aaaa,
    emissiveIntensity: 0.3,
    side: THREE.DoubleSide,
  });
}

// —— 几何辅助 ——
function mesh(geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}
// 贴图按世界尺寸平铺的盒子（y 为中心高度）
function tbox(w, h, d, mat, x = 0, y = 0, z = 0) {
  const s = mat.userData.s || 4,
    g = new THREE.BoxGeometry(w, h, d),
    uv = g.attributes.uv;
  for (let i = 0; i < 24; i++) {
    const f = i >> 3;
    uv.setXY(
      i,
      (uv.getX(i) * (f === 0 ? d : w)) / s,
      (uv.getY(i) * (f === 1 ? d : h)) / s,
    );
  }
  return mesh(g, mat, x, y, z);
}
function tcyl(rt, rb, h, seg, mat, x = 0, y = 0, z = 0) {
  const s = mat.userData.s || 4;
  return mesh(
    scaleUV(
      new THREE.CylinderGeometry(rt, rb, h, seg),
      (Math.PI * 2 * Math.max(rt, rb)) / s,
      Math.max(h, 1) / s,
    ),
    mat,
    x,
    y,
    z,
  );
}
function mergeGeos(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  parts.forEach((g) => (n += g.attributes.position.count));
  const hasCol = parts.every((g) => g.attributes.color); // 顶点色（人和牛车用）：所有部件都有才合并
  const pos = new Float32Array(n * 3),
    nor = new Float32Array(n * 3),
    uv = new Float32Array(n * 2),
    col = hasCol ? new Float32Array(n * 3) : null;
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    if (col) col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
const _q = new THREE.Quaternion(),
  _e = new THREE.Euler();
function M(x, y, z, sx = 1, sy = sx, sz = sx, ry = 0, rx = 0, rz = 0) {
  return new THREE.Matrix4().compose(
    new V3(x, y, z),
    _q.setFromEuler(_e.set(rx, ry, rz)).clone(),
    new V3(sx, sy, sz),
  );
}
function instanced(geo, mat, matrices, shadow = true) {
  const m = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((mx, i) => m.setMatrixAt(i, mx));
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
// 一组等高圆柱 / 方柱：pts = [[x,z],...]，y0 为柱底
function columns(pts, y0, h, r, mat, square = false) {
  const geo = square
    ? new THREE.BoxGeometry(2, 1, 2)
    : new THREE.CylinderGeometry(1, 1.12, 1, 10);
  return instanced(
    geo,
    mat,
    pts.map(([x, z]) => M(x, y0 + h / 2, z, r, h, r)),
  );
}
// 双坡屋顶：屋脊沿 X，span 为 Z 向跨度
function gableRoof(span, length, rise, y, mat = MAT.tile, wall = MAT.plaster) {
  const g = new THREE.Group(),
    s = Math.hypot(span / 2, rise),
    a = Math.atan2(rise, span / 2);
  const a1 = tbox(length, 0.35, s + 0.3, mat, 0, rise / 2, span / 4);
  a1.rotation.x = a;
  const a2 = tbox(length, 0.35, s + 0.3, mat, 0, rise / 2, -span / 4);
  a2.rotation.x = -a;
  const sh = new THREE.Shape();
  sh.moveTo(-span / 2 + 0.6, 0);
  sh.lineTo(span / 2 - 0.6, 0);
  sh.lineTo(0, rise - 0.5);
  sh.closePath();
  const wm = wall.clone();
  wm.side = THREE.DoubleSide;
  wm.map = null;
  for (const sx of [-1, 1]) {
    const t = mesh(
      new THREE.ShapeGeometry(sh),
      wm,
      sx * (length / 2 - 0.8),
      0,
      0,
    );
    t.rotation.y = Math.PI / 2;
    g.add(t);
  }
  g.add(a1, a2, tbox(length + 0.4, 0.4, 0.7, mat, 0, rise + 0.05, 0));
  g.position.y = y;
  return g;
}
function archShape(w, h) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-w / 2, h - w / 2);
  s.absarc(0, h - w / 2, w / 2, Math.PI, 0, true);
  s.lineTo(w / 2, 0);
  s.closePath();
  return s;
}
// 加色发光点（油灯光晕等），一次 draw call
function glowPoints(pts, size = 5, color = 0xffad5c, base = 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
  const mat = new THREE.PointsMaterial({
    map: TEX.glow,
    color,
    size,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  FX.glows.push({ mat, base });
  return new THREE.Points(geo, mat);
}
function pointLight(color, base, dist, x, y, z) {
  const l = new THREE.PointLight(color, 0, dist, 1.6);
  l.position.set(x, y, z);
  FX.lights.push({ light: l, base });
  return l;
}
// 林伽：圆柱 + 半球顶
function linga(r, h, mat = MAT.black) {
  return mesh(
    new THREE.CapsuleGeometry(r, h, 6, 16),
    mat,
    0,
    h / 2 + r * 0.2,
    0,
  );
}
// 灯塔（deepa stambha）
function lampTower(h, tiers = 5) {
  const g = new THREE.Group(),
    pts = [];
  g.add(
    tcyl(0.5, 0.7, 0.5, 10, MAT.darkStone, 0, 0.25, 0),
    tcyl(0.14, 0.2, h, 8, MAT.gold, 0, h / 2 + 0.5, 0),
  );
  for (let i = 0; i < tiers; i++) {
    const y = 1.2 + (i * (h - 1)) / tiers,
      r = 0.9 - i * 0.13;
    g.add(tcyl(r, r * 0.6, 0.12, 12, MAT.gold, 0, y, 0));
    for (let k = 0; k < 6; k++)
      pts.push([Math.cos(k * 1.047) * r, y + 0.2, Math.sin(k * 1.047) * r]);
  }
  g.add(glowPoints(pts, 1.5, 0xffa040));
  return g;
}
function trishul(h) {
  const g = new THREE.Group();
  g.add(
    tcyl(0.09, 0.11, h, 8, MAT.gold, 0, h / 2, 0),
    tcyl(0.5, 0.7, 0.5, 8, MAT.darkStone, 0, 0.25, 0),
  );
  const u = mesh(
    new THREE.TorusGeometry(0.75, 0.09, 6, 16, Math.PI),
    MAT.gold,
    0,
    h + 0.4,
    0,
  );
  u.rotation.z = Math.PI;
  g.add(u);
  for (const [x, y, s] of [
    [0, h + 0.75, 1.5],
    [-0.75, h + 0.75, 0.9],
    [0.75, h + 0.75, 0.9],
  ])
    g.add(mesh(new THREE.ConeGeometry(0.14, s, 6), MAT.gold, x, y, 0));
  return g;
}

// ───────────────────────────── [4] 环境组件 ─────────────────────────────
function createSky() {
  const g = new THREE.Group();
  g.name = 'Sky';
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      top: { value: new Color() },
      horizon: { value: new Color() },
      sunDir: { value: new V3(1, 0.2, 0) },
      sunCol: { value: new Color() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 top, horizon, sunCol, sunDir; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir); float h = max(d.y, 0.0);
        vec3 c = mix(horizon, top, pow(h, 0.42));
        float s = max(dot(d, sunDir), 0.0);
        c += sunCol * (pow(s, 5.0) * 0.28 + pow(s, 48.0) * 0.5 + smoothstep(0.99925, 0.9997, s) * 5.0);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), mat);
  dome.renderOrder = -10;
  g.add(dome);
  const sp = [];
  for (let i = 0; i < 900; i++) {
    const a = rnd() * Math.PI * 2,
      y = rnd() * 0.95 + 0.04,
      r = Math.sqrt(1 - y * y);
    sp.push(Math.cos(a) * r * 4700, y * 4700, Math.sin(a) * r * 4700);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(
    sg,
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.7,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false,
      depthTest: false,
    }),
  );
  stars.renderOrder = -9;
  g.add(stars);
  const veil = (x, y, z, w, h, op, kind) => {
    const m = new THREE.SpriteMaterial({
      map: TEX.glow,
      transparent: true,
      opacity: op,
      depthWrite: false,
      fog: false,
      depthTest: kind === 'mist',
    });
    const s = new THREE.Sprite(m);
    s.position.set(x, y, z);
    s.scale.set(w, h, 1);
    if (kind === 'cloud') s.renderOrder = -8;
    FX.tint.push({ mat: m, kind });
    return s;
  };
  const mist = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2;
    g.add(
      veil(
        Math.cos(a) * 4200,
        rr(600, 1600),
        Math.sin(a) * 4200,
        rr(1600, 3000),
        rr(160, 320),
        rr(0.25, 0.5),
        'cloud',
      ),
    );
  }
  for (let i = 0; i < 16; i++)
    mist.add(
      veil(
        rr(-1500, -700),
        rr(30, 150),
        rr(-1900, 1300),
        rr(700, 1200),
        rr(70, 130),
        rr(0.2, 0.36),
        'mist',
      ),
    );
  g.userData = {
    mat,
    stars,
    mist,
    update: (t) => {
      mist.position.z = Math.sin(t * 0.02) * 90;
    },
  };
  return g;
}

function createTerrain() {
  const geo = new THREE.PlaneGeometry(5600, 5600, 250, 250);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position,
    col = new Float32Array(p.count * 3);
  const earth = new Color(0xb39a6c),
    grass = new Color(0x7fa650),
    forest = new Color(0x3c6238),
    high = new Color(0x4d6a58),
    c = new Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i),
      h = groundH(x, z);
    p.setY(i, h);
    c.copy(earth).lerp(
      grass,
      smooth(0.2, 0.46, fbm(x * 0.008 + 40, z * 0.008, 3)),
    );
    c.lerp(forest, smooth(1, 40, h)).lerp(high, smooth(350, 700, h) * 0.7);
    c.multiplyScalar(0.85 + 0.3 * vnoise(x * 0.03, z * 0.03));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  scaleUV(geo, 800, 800);
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: TEX.ground,
  });
  // 在地形上为下沉水池“挖洞”：落在 PITS 矩形内的片元直接丢弃
  const N = Math.max(1, PITS.length);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.pits = {
      value: PITS.length
        ? PITS.map((q) => new THREE.Vector4(q.x, q.z, q.hw, q.hd))
        : [new THREE.Vector4(0, 0, -1, -1)],
    };
    sh.uniforms.pitRot = { value: PITS.length ? PITS.map((q) => q.rot) : [0] };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vWp; uniform vec4 pits[${N}]; uniform float pitRot[${N}];`,
      )
      .replace(
        'void main() {',
        `void main() {
        for (int i = 0; i < ${N}; i++) { vec2 d = vWp.xz - pits[i].xy; float c = cos(pitRot[i]), s = sin(pitRot[i]);
          vec2 l = vec2(c * d.x - s * d.y, s * d.x + c * d.y); if (abs(l.x) < pits[i].z && abs(l.y) < pits[i].w) discard; }`,
      );
  };
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.name = 'Terrain';
  const g = new THREE.Group();
  g.name = 'Terrain';
  g.add(m);
  for (const [e, n, w, h, color] of FIELDS) {
    // 农田 / 草场
    const f = new THREE.Mesh(
      scaleUV(new THREE.PlaneGeometry(w, h), w / 6, h / 6),
      new THREE.MeshLambertMaterial({ color, map: TEX.ground }),
    );
    const q = geo2(e, n);
    f.rotation.x = -Math.PI / 2;
    f.position.set(q[0], 0.035, q[2]);
    f.receiveShadow = true;
    g.add(f);
  }
  return g;
}
const geo2 = geo; // createTerrain 内部有同名局部变量 geo，这里留一个别名

function createPaths() {
  const g = new THREE.Group();
  g.name = 'Paths';
  PATHS.forEach(([x1, z1, x2, z2, w], i) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const b = tbox(
      len + w * 0.5,
      0.12,
      w,
      MAT.paving,
      (x1 + x2) / 2,
      0.07 + (i % 7) * 0.004,
      (z1 + z2) / 2,
    );
    b.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    b.castShadow = false;
    g.add(b);
  });
  return g;
}

function blocked(x, z, pad = 0) {
  for (const [ex, ez, r] of EXCLUDE)
    if (Math.hypot(x - ex, z - ez) < r + pad) return true;
  for (const [x1, z1, x2, z2, w] of PATHS) {
    const dx = x2 - x1,
      dz = z2 - z1,
      t = clamp(((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz), 0, 1);
    if (Math.hypot(x - x1 - dx * t, z - z1 - dz * t) < w / 2 + 2.5 + pad)
      return true;
  }
  return false;
}

function palmCrownGeo() {
  const parts = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.PlaneGeometry(1.5, 1, 2, 4),
      p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const t = p.getY(k) + 0.5,
        x0 = p.getX(k);
      p.setXYZ(
        k,
        x0 * (1 - 0.8 * t),
        0.9 * Math.sin(t * 2.2) - t * t * 2.4 - Math.abs(x0) * 0.45,
        t * 4.8,
      );
    }
    g.rotateX(rr(-0.25, 0.35));
    g.rotateY((i * Math.PI * 2) / 8 + rr(-0.15, 0.15));
    parts.push(g);
  }
  const out = mergeGeos(parts);
  out.computeVertexNormals();
  return out;
}
function leafCrownGeo() {
  const parts = [];
  for (const [x, y, z, r] of [
    [0, 0, 0, 2.6],
    [1.8, -0.5, 0.6, 1.9],
    [-1.5, -0.3, -1.0, 2.0],
    [0.2, 1.4, -0.4, 1.8],
    [-0.6, -0.4, 1.7, 1.7],
  ]) {
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.scale(1, 0.8, 1);
    g.translate(x, y, z);
    parts.push(g);
  }
  return mergeGeos(parts);
}

function createVegetation() {
  const g = new THREE.Group();
  g.name = 'Vegetation';
  const col = new Color();
  const adi = geo(562, -690);
  // 密度：园区内（e -330..430, n -140..780）是成片的椰林与槟榔林，Adiyogi 周围是开阔草地，其余为稀疏田野
  const density = (e, n) => {
    const [x, , z] = geo(e, n);
    if (Math.hypot(x - adi[0], z - adi[2]) < 190 || inField(e, n)) return 0;
    return e > -330 && e < 430 && n > -140 && n < 780 ? 1 : 0.12;
  };
  const scatter = (count, pad, noiseK, thresh) => {
    const out = [];
    for (let tries = 0; out.length < count && tries < count * 40; tries++) {
      const e = rr(-480, 1000),
        n = rr(-1750, 880),
        [x, , z] = geo(e, n);
      if (rnd() > density(e, n) || blocked(x, z, pad) || groundH(x, z) > 0.5)
        continue;
      if (fbm(x * noiseK + 9, z * noiseK, 2) > thresh) out.push([x, z]);
    }
    return out;
  };
  // 椰子树：随机散布 + 两片果园的行列种植（位置取自 OSM 的 orchard 地块）
  const palms = scatter(1800, 1, 0.012, 0.36);
  for (const [e0, e1, n0, n1] of [
    [348, 492, 84, 330],
    [250, 492, -1040, -600],
  ])
    for (let e = e0; e <= e1; e += 13)
      for (let n = n0; n <= n1; n += 13) {
        const [x, , z] = geo(e + rr(-2, 2), n + rr(-2, 2));
        if (!blocked(x, z, 1)) palms.push([x, z]);
      }
  for (let n = -1000; n <= -770; n += 16)
    for (const de of [-13, 13]) {
      const [x, , z] = geo(562 + de, n);
      palms.push([x, z]);
    }
  const trunkM = [],
    crownM = [],
    up = new V3();
  for (const [x, z] of palms) {
    const h = rr(8, 14),
      rx = rr(-0.1, 0.1),
      rz = rr(-0.1, 0.1),
      ry = rnd() * 6.28,
      s = rr(0.85, 1.2);
    trunkM.push(M(x, 0, z, s, h, s, ry, rx, rz));
    up.set(0, h, 0).applyEuler(_e.set(rx, ry, rz));
    crownM.push(M(x + up.x, up.y, z + up.z, s, s, s, ry));
  }
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.34, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  g.add(
    instanced(
      trunkGeo,
      new THREE.MeshLambertMaterial({ color: 0x7a6650 }),
      trunkM,
    ),
  );
  g.add(
    instanced(
      palmCrownGeo(),
      new THREE.MeshLambertMaterial({
        color: 0x5c8a3a,
        side: THREE.DoubleSide,
      }),
      crownM,
    ),
  );

  // 阔叶树
  const trees = scatter(1300, 3, 0.011, 0.36).map(([x, z]) => [
    x,
    z,
    rr(0.8, 1.8),
  ]);
  const tTrunk = new THREE.CylinderGeometry(0.28, 0.42, 1, 6);
  tTrunk.translate(0, 0.5, 0);
  g.add(
    instanced(
      tTrunk,
      new THREE.MeshLambertMaterial({ color: 0x5c4634 }),
      trees.map(([x, z, s]) => M(x, 0, z, s, 3.6 * s, s)),
    ),
  );
  const crowns = instanced(
    leafCrownGeo(),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    trees.map(([x, z, s]) => M(x, 4.6 * s, z, s, s, s, rnd() * 6.28)),
  );
  trees.forEach((_, i) =>
    crowns.setColorAt(
      i,
      col.setHSL(
        rr(0.22, 0.31),
        rr(0.32, 0.5),
        rr(0.24, 0.36),
        THREE.SRGBColorSpace,
      ),
    ),
  );
  g.add(crowns);

  // 灌木
  const bush = scatter(320, 0.5, 0.03, 0.3).map(([x, z]) =>
    M(x, 0.4, z, rr(0.6, 1.4), rr(0.5, 0.9), rr(0.6, 1.4), rnd() * 6),
  );
  const bushes = instanced(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    bush,
    false,
  );
  bush.forEach((_, i) =>
    bushes.setColorAt(
      i,
      col.setHSL(rr(0.2, 0.3), 0.4, rr(0.22, 0.34), THREE.SRGBColorSpace),
    ),
  );
  g.add(bushes);

  // 山麓密林（远景，只是低面数的色块）
  const far = [];
  for (let tries = 0; far.length < 4200 && tries < 80000; tries++) {
    const x = rr(-2300, 900),
      z = rr(-2400, 1500),
      h = groundH(x, z);
    if (h > 1.5 && h < 420) {
      const s = rr(6, 13);
      far.push(
        M(x, h + s * 0.2, z, s * 1.3, s * rr(0.8, 1.2), s * 1.3, rnd() * 6),
      );
    }
  }
  const forest = instanced(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    far,
    false,
  );
  forest.receiveShadow = false;
  far.forEach((_, i) =>
    forest.setColorAt(
      i,
      col.setHSL(
        rr(0.25, 0.36),
        rr(0.25, 0.42),
        rr(0.16, 0.27),
        THREE.SRGBColorSpace,
      ),
    ),
  );
  g.add(forest);
  return g;
}

function createLamps() {
  const g = new THREE.Group();
  g.name = 'Lamps';
  const post = mergeGeos([
    new THREE.CylinderGeometry(0.28, 0.36, 0.5, 6).translate(0, 0.25, 0),
    new THREE.CylinderGeometry(0.11, 0.14, 2.4, 6).translate(0, 1.7, 0),
    new THREE.BoxGeometry(0.5, 0.1, 0.5).translate(0, 2.95, 0),
    new THREE.ConeGeometry(0.42, 0.4, 4)
      .rotateY(Math.PI / 4)
      .translate(0, 3.75, 0),
  ]);
  const posts = [],
    flames = [],
    glows = [];
  for (const [x1, z1, x2, z2, w] of PATHS) {
    const len = Math.hypot(x2 - x1, z2 - z1),
      dx = (x2 - x1) / len,
      dz = (z2 - z1) / len,
      n = Math.floor(len / 22);
    for (let i = 1; i <= n; i++) {
      const side = i % 2 ? 1 : -1,
        d = (i * len) / (n + 1),
        x = x1 + dx * d - dz * side * (w / 2 + 0.9),
        z = z1 + dz * d + dx * side * (w / 2 + 0.9);
      if (blocked(x, z, -3.2)) continue;
      posts.push(M(x, 0, z));
      flames.push(M(x, 3.3, z, 0.2, 0.3, 0.2));
      glows.push([x, 3.3, z]);
    }
  }
  g.add(
    instanced(post, MAT.darkStone, posts),
    instanced(new THREE.SphereGeometry(1, 6, 5), MAT.flame, flames, false),
    glowPoints(glows, 7),
  );
  return g;
}

function createDust() {
  const pts = [];
  for (let i = 0; i < 1400; i++)
    pts.push(rr(-650, 650), rr(1, 60), rr(-700, 700));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const p = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      map: TEX.glow,
      color: 0xffe0b0,
      size: 0.8,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  p.name = 'Dust';
  p.userData.update = (t) => {
    p.rotation.y = t * 0.004;
    p.position.y = Math.sin(t * 0.25) * 1.5;
  };
  return p;
}

// —— 行人与牛车（会走动的 NPC，第十轮）——
// 行人沿道路来回走（走到头就掉头），一对一对或单独走；牛车在 Welcome Point 与 Metal Bridge 之间往返，靠左行驶，到站停 15 秒再掉头。
// 阴影图是静态的（只在光照变化时重算），所以走动的人和牛车不投射实时阴影，脚下垫一块淡淡的圆形暗影。
function createPeople() {
  const g = new THREE.Group();
  g.name = 'People';
  g.userData.npc = true;
  const route = (pts, yFn) => {
    const P = pts.map((p) => geo(...p)),
      cum = [0];
    for (let i = 1; i < P.length; i++)
      cum.push(
        cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][2] - P[i - 1][2]),
      );
    return { P, cum, L: cum[cum.length - 1], yFn };
  };
  const at = (r, s, o) => {
    s = clamp(s, 0, r.L);
    let i = 1;
    while (i < r.cum.length - 1 && r.cum[i] < s) i++;
    const a = r.P[i - 1],
      b = r.P[i],
      seg = r.cum[i] - r.cum[i - 1] || 1,
      t = (s - r.cum[i - 1]) / seg;
    o.x = a[0] + (b[0] - a[0]) * t;
    o.z = a[2] + (b[2] - a[2]) * t;
    o.tx = (b[0] - a[0]) / seg;
    o.tz = (b[2] - a[2]) / seg;
    return o;
  };
  // 莲池拱桥的桥面高度（与 createLotusPonds 里的拱桥一致）：桥两头是 0.3 m 高的平台，中间拱起 1.15 m
  const A = geo(93.5, -12.6),
    B = geo(114.5, -16.2),
    BL = Math.hypot(B[0] - A[0], B[2] - A[2]);
  const bridgeY = (x, z) => {
    const dx = (B[0] - A[0]) / BL,
      dz = (B[2] - A[2]) / BL,
      u = (x - A[0]) * dx + (z - A[2]) * dz,
      t = u / BL;
    if (
      Math.abs(-(x - A[0]) * dz + (z - A[2]) * dx) > 2.2 ||
      t < -2.4 / BL ||
      t > 1 + 2.4 / BL
    )
      return 0.13;
    return t <= 0 || t >= 1 ? 0.3 : 0.3 + 4.6 * t * (1 - t);
  };
  // 每条路的行人密度（人 / 米），顺序与 ROADS 一致；莲池拱桥那两段由下面的“神庙主轴”代替
  const DENS = [
    0.015, 0.1, 0.01, 0.06, 0.08, 0.05, 0, 0, 0.05, 0.05, 0.03, 0.04, 0.08,
    0.02, 0.04, 0.07, 0.03, 0, 0.06,
  ];
  const R = [];
  // 行人避开 Adiyogi 台基的西缘（路在 e=526 擦着台基走）、Metal Bridge 桥头的坡道
  const PTS = {
    3: ROADS[3].pts.map(([e, n]) => [e === 526 ? 517 : e, n]),
    16: [...ROADS[16].pts.slice(0, -1), [346, 352.6]],
  };
  ROADS.forEach((r, i) => {
    if (DENS[i]) R.push({ ...route(PTS[i] || r.pts), w: r.w, d: DENS[i] });
  });
  // 神庙主轴：Dhyanalinga 门前 → 从南北两侧绕过 Nandi → 莲池拱桥 → Suryakund
  for (const sd of [-1, 1])
    R.push({
      ...route(
        [
          [52, -6.9],
          [65, -9.6 + sd * 0.4],
          [70, -10 + sd * 7],
          [82, -10.2 + sd * 7],
          [88, -11.2],
          [93.5, -12.6],
          [114.5, -16.2],
          [141, -20],
          [147, -20.5],
        ],
        bridgeY,
      ),
      w: 3,
      d: 0.07,
    });

  // —— 行人 ——
  const W = [];
  for (const r of R)
    for (let k = Math.round(r.L * r.d); k > 0; k--) {
      const pair = PR() < 0.3 ? 2 : 1,
        s = PR() * r.L,
        dir = PR() < 0.5 ? 1 : -1,
        half = clamp(r.w / 2 - 0.7, 0.3, 2.4),
        v = pr(0.9, 1.35); // 离路边留 0.7 m：门柱、墙角不会擦到人
      let lane = pr(-half, half - (pair - 1) * 0.62);
      for (let j = 0; j < pair; j++, lane += 0.62) {
        const female = PR() < 0.45,
          col = dress(female);
        W.push({
          r,
          s,
          dir,
          lane,
          v,
          ph: PR() * 6.28,
          female,
          col,
          low: female
            ? col
            : PR() < 0.65
              ? pick(WHITES)
              : pick([0x3b3b44, 0x5a4a3a, 0x2e3a52]),
        });
      }
    }
  const PG = personGeos(),
    mat = vcolMat(),
    c = new Color();
  const nF = W.filter((w) => w.female).length,
    nM = W.length - nF;
  const mk = (geo, n, m = mat) => {
    const im = new THREE.InstancedMesh(geo, m, Math.max(1, n));
    im.count = n;
    im.frustumCulled = false;
    im.receiveShadow = true;
    im.userData.npc = true;
    g.add(im);
    return im;
  };
  const upM = mk(PG.wm, nM),
    upF = mk(PG.wf, nF),
    legs = mk(PG.leg, W.length * 2);
  const blobMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const blobs = mk(
    new THREE.CircleGeometry(0.34, 10).rotateX(-Math.PI / 2),
    W.length,
    blobMat,
  );
  W.forEach((w, i) => {
    w.up = w.female ? upF : upM;
    w.up.setColorAt(0, c);
    legs.setColorAt(i * 2, c);
    legs.setColorAt(i * 2 + 1, c);
    w.c1 = new Color(w.col);
    w.c2 = new Color(w.low);
  });

  // —— 牛车：Welcome Point → 南北主路 → Bhiksha Hall → Metal Bridge ——
  const cartRoute = route([
    [81.2, 125],
    [84, 142],
    [97, 180],
    [107, 232],
    [117, 250],
    [142, 265],
    [199, 272],
    [231, 275],
    [249, 316.5],
    [254, 320.5],
    [262, 338],
    [300, 346],
    [344, 352.3],
  ]);
  const cartBlob = new THREE.CircleGeometry(1, 16)
    .rotateX(-Math.PI / 2)
    .scale(1.15, 1, 3.3)
    .translate(0, 0.02, 1.5);
  const carts = [
    [0xb3261c, 0.08, 1],
    [0x2a5fa8, 0.5, -1],
    [0xe0781e, 0.86, 1],
  ].map(([horn, f, dir]) => {
    const rig = oxCart({ horn });
    rig.add(mesh(cartBlob, blobMat, 0, 0, 0, false));
    g.add(rig);
    return {
      rig,
      s: f * cartRoute.L,
      dir,
      mode: 'go',
      t: 0,
      dist: 0,
      h: 0,
      side: 1,
    };
  });

  g.userData.routes = [...R, cartRoute]; // 调试用：ISHA.scene.getObjectByName("People").userData.routes
  const o = {},
    o2 = {},
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    mx = new THREE.Matrix4(),
    pv = new V3(),
    sv = new V3(1, 1, 1);
  const put = (im, i, x, y, z, ry, rx = 0) => {
    e.set(rx, ry, 0, 'YXZ');
    im.setMatrixAt(i, mx.compose(pv.set(x, y, z), q.setFromEuler(e), sv));
  };
  g.userData.update = (t, dt) => {
    if (!g.visible) return;
    const cp = camera.position;
    // 远处的人只有几个像素：镜头 NPC_FAR 米以外的人不画（静止人群按组、走动的人按个）
    if ((frameNo = (frameNo + 1) % 10) === 0)
      for (const cg of CROWDS) {
        cg.getWorldPosition(pv);
        cg.visible = pv.distanceTo(cp) - cg.userData.radius < NPC_FAR;
      }
    let nm = 0,
      nf = 0,
      nl = 0;
    W.forEach((w) => {
      const r = w.r;
      w.s += w.v * w.dir * dt;
      if (w.s > r.L || w.s < 0) {
        w.s = clamp(w.s, 0, r.L);
        w.dir = -w.dir;
      } // 走到头就掉头
      w.ph += ((dt * w.v) / 1.4) * Math.PI * 2;
      at(r, w.s, o);
      const x = o.x + o.tz * w.lane,
        z = o.z - o.tx * w.lane;
      if (
        Math.abs(x - cp.x) > NPC_FAR ||
        Math.abs(z - cp.z) > NPC_FAR ||
        Math.hypot(x - cp.x, z - cp.z) > NPC_FAR
      )
        return;
      const y = r.yFn ? r.yFn(x, z) : 0.13,
        ry = Math.atan2(o.tx * w.dir, o.tz * w.dir);
      const sw = Math.sin(w.ph) * 0.42,
        bob = Math.abs(Math.cos(w.ph)) * 0.03,
        cx = Math.cos(ry) * 0.085,
        cz = -Math.sin(ry) * 0.085;
      const iu = w.female ? nf++ : nm++;
      put(w.up, iu, x, y + bob, z, ry);
      w.up.setColorAt(iu, w.c1);
      put(legs, nl, x - cx, y + 0.84 + bob, z - cz, ry, sw);
      legs.setColorAt(nl++, w.c2);
      put(legs, nl, x + cx, y + 0.84 + bob, z + cz, ry, -sw);
      legs.setColorAt(nl++, w.c2);
      put(blobs, nl / 2 - 1, x, y + 0.015, z, 0);
    });
    upM.count = nm;
    upF.count = nf;
    legs.count = nl;
    blobs.count = nl / 2;
    for (const im of [upM, upF, legs, blobs]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }

    for (const k of carts) {
      const L = cartRoute.L;
      if (k.mode === 'go') {
        k.s += 1.1 * k.dir * dt;
        k.dist += 1.1 * dt;
        if (k.s > L || k.s < 0) {
          k.s = clamp(k.s, 0, L);
          k.mode = 'wait';
          k.t = 15;
        }
      } else if (k.mode === 'wait' && (k.t -= dt) <= 0) {
        k.mode = 'turn';
        k.t = 5;
      } else if (k.mode === 'turn') {
        k.dist += 0.5 * dt;
        if ((k.t -= dt) <= 0) {
          k.mode = 'go';
          k.dir = -k.dir;
        }
      }
      // 朝向：车轴指向前方 3.5 m 处（牛的位置），转弯时牛也在路上；靠左行驶
      at(cartRoute, k.s, o);
      at(cartRoute, k.s + 3.5 * k.dir, o2);
      let h =
          Math.hypot(o2.x - o.x, o2.z - o.z) > 0.5
            ? Math.atan2(o2.x - o.x, o2.z - o.z)
            : Math.atan2(o.tx * k.dir, o.tz * k.dir),
        side = 1; // 在路的两头没有“前方”，用路的切线
      if (k.mode === 'turn') {
        const u = smooth(0, 1, 1 - k.t / 5);
        h += Math.PI * u;
        side = 1 - 2 * u;
      }
      const dx = Math.sin(h),
        dz = Math.cos(h),
        off = 1.15 * (k.mode === 'turn' ? side : 1);
      const lx =
          k.mode === 'turn'
            ? Math.sin(h - Math.PI * smooth(0, 1, 1 - k.t / 5))
            : dx,
        lz =
          k.mode === 'turn'
            ? Math.cos(h - Math.PI * smooth(0, 1, 1 - k.t / 5))
            : dz;
      k.rig.position.set(o.x + lz * off, 0.02, o.z - lx * off);
      k.rig.rotation.y = h;
      k.rig.userData.step(k.dist, k.mode !== 'wait');
    }
  };
  return g;
}

// ───────────────────────────── [5] 建筑组件 ─────────────────────────────
// 标记为“屋顶”的物体可以用界面上的「剖视」按钮隐藏，方便看室内
const asRoof = (o) => {
  o.userData.roof = true;
  return o;
};
// 带矩形洞口的地坪（洞口处是下沉水池）
function floorWithHole(g, W, D, hx, hz, hw, hd, mat, y = 0.08, t = 0.16) {
  const zb = hz - hd,
    zf = hz + hd,
    xl = hx - hw,
    xr = hx + hw;
  const add = (w, d, x, z) => {
    if (w > 0.01 && d > 0.01) {
      const b = tbox(w, t, d, mat, x, y, z);
      b.castShadow = false;
      g.add(b);
    }
  };
  add(W, zb + D / 2, 0, (zb - D / 2) / 2);
  add(W, D / 2 - zf, 0, (zf + D / 2) / 2);
  add(xl + W / 2, 2 * hd, (xl - W / 2) / 2, hz);
  add(W / 2 - xr, 2 * hd, (xr + W / 2) / 2, hz);
}
// 下沉池坑：四壁 + 池底（墙体藏在地面以下，只露出朝内的一面）
function pit(g, cx, cz, w, d, depth, mat) {
  const t = 1.2,
    h = depth - 0.05,
    y = -depth + h / 2;
  g.add(
    tbox(w + 2 * t, h, t, mat, cx, y, cz - d / 2 - t / 2),
    tbox(w + 2 * t, h, t, mat, cx, y, cz + d / 2 + t / 2),
    tbox(t, h, d, mat, cx - w / 2 - t / 2, y, cz),
    tbox(t, h, d, mat, cx + w / 2 + t / 2, y, cz),
    tbox(w, 0.4, d, mat, cx, -depth - 0.2, cz),
  );
}
// 浅拱屋顶：拱轴沿 Z
function vaultRoof(span, len, rise, mat, endMat) {
  const g = new THREE.Group(),
    R = span / 2;
  const geo = new THREE.CylinderGeometry(
    R,
    R,
    len,
    24,
    1,
    true,
    Math.PI / 2,
    Math.PI,
  );
  geo.rotateX(Math.PI / 2);
  geo.scale(1, rise / R, 1);
  g.add(mesh(geo, mat));
  const sh = new THREE.Shape();
  sh.absellipse(0, 0, R - 0.2, rise - 0.1, 0, Math.PI);
  sh.closePath();
  for (const sz of [-1, 1])
    g.add(
      mesh(new THREE.ShapeGeometry(sh, 16), endMat, 0, 0, sz * (len / 2 - 0.3)),
    );
  return g;
}

// —— 第三轮新增的通用工具 ——
// 一段台阶（一次 draw call）：从 (yTop, zTop) 起沿 dz 方向逐级下降；base 给定时每级踏步向下实心填到 base
function stairs(w, n, rise, run, mat, x, yTop, zTop, dz = 1, base = null) {
  const ms = [];
  for (let i = 0; i < n; i++) {
    const top = yTop - i * rise,
      h = base === null ? rise : top - base;
    if (h > 0.02)
      ms.push(M(x, top - h / 2, zTop + dz * (i + 0.5) * run, w, h, run));
  }
  return instanced(new THREE.BoxGeometry(1, 1, 1), mat, ms);
}
// 空心圆筒（墙厚可见），用于穹顶的石鼓墙
function tube(rOut, rIn, h, seg, mat, y = 0) {
  const pts = [
    new THREE.Vector2(rIn, 0),
    new THREE.Vector2(rOut, 0),
    new THREE.Vector2(rOut, h),
    new THREE.Vector2(rIn, h),
    new THREE.Vector2(rIn, 0),
  ];
  return mesh(scaleUV(new THREE.LatheGeometry(pts, seg), 18, 2), mat, 0, y, 0);
}
// 三角形棱柱 / 三角形楼板：底边在 z=0（宽 2·hw），顶点在 z=-len；hole>0 时在中间开一个同形的小三角洞
function triSlab(hw, len, h, mat, y, hole = 0) {
  const s = new THREE.Shape();
  s.moveTo(-hw, 0);
  s.lineTo(hw, 0);
  s.lineTo(0, len);
  s.closePath();
  if (hole > 0) {
    const p = new THREE.Path(),
      c = len * 0.36;
    p.moveTo(-hw * hole, c - len * hole * 0.3);
    p.lineTo(0, c + len * hole * 0.7);
    p.lineTo(hw * hole, c - len * hole * 0.3);
    p.closePath();
    s.holes.push(p);
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  return mesh(scaleUV(geo, 0.25, 0.25), mat, 0, y, 0);
}
// 三角形楼板，带一个矩形洞（hole = [x0, x1, z0, z1]，局部坐标，z 为负方向即三角尖端方向）
function triSlabHole(hw, len, h, mat, y, hole) {
  const s = new THREE.Shape();
  s.moveTo(-hw, 0);
  s.lineTo(hw, 0);
  s.lineTo(0, len);
  s.closePath();
  const [x0, x1, z0, z1] = hole,
    p = new THREE.Path();
  p.moveTo(x0, -z0);
  p.lineTo(x0, -z1);
  p.lineTo(x1, -z1);
  p.lineTo(x1, -z0);
  p.closePath();
  s.holes.push(p);
  const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  return mesh(scaleUV(geo, 0.25, 0.25), mat, 0, y, 0);
}
// 由 (x, z) 折线围成的水平面（莲池水面、草坪等）
function polyPlane(pts, mat, y) {
  const s = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
  s.closePath();
  const geo = new THREE.ShapeGeometry(s);
  geo.rotateX(-Math.PI / 2);
  return mesh(scaleUV(geo, 0.12, 0.12), mat, 0, y, 0, false);
}
function inPoly(x, z, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i],
      [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      c = !c;
  }
  return c;
}
// 招牌（双面）
function signBoard(text, w = 5, h = 1.1, bg, fg) {
  const t = signTex(text, bg, fg);
  const m = new THREE.MeshStandardMaterial({
    map: t,
    roughness: 0.7,
    emissive: 0xffffff,
    emissiveMap: t,
    emissiveIntensity: 0.22,
  });
  const g = new THREE.Group(),
    a = mesh(new THREE.PlaneGeometry(w, h), m, 0, 0, 0.04, false),
    b = mesh(new THREE.PlaneGeometry(w, h), m, 0, 0, -0.04, false);
  b.rotation.y = Math.PI;
  g.add(a, b, tbox(w + 0.16, h + 0.16, 0.06, MAT.wood));
  return g;
}
// 方石柱（柱础 + 柱身 + 柱头），三次 draw call 画一整片柱阵
function stoneColumns(pts, y0, h, r, mat, capMat = mat) {
  const g = new THREE.Group(),
    box = new THREE.BoxGeometry(2, 1, 2);
  g.add(
    instanced(
      box,
      mat,
      pts.map(([x, z]) => M(x, y0 + h / 2, z, r, h, r)),
    ),
    instanced(
      box,
      capMat,
      pts.map(([x, z]) => M(x, y0 + 0.25, z, r * 1.5, 0.5, r * 1.5)),
    ),
    instanced(
      box,
      capMat,
      pts.map(([x, z]) => M(x, y0 + h - 0.2, z, r * 1.45, 0.4, r * 1.45)),
    ),
  );
  return g;
}
// 简单房屋：台基 + 墙 + 屋顶 + 正面的窗；正面朝 +Z。o = { wall, roof:'gable'|'flat'|'hip', rise, roofMat, plinth, win, veranda }
function house(w, d, h, o = {}) {
  const g = new THREE.Group(),
    Y = o.plinth ?? 0.4,
    wall = o.wall || MAT.plaster,
    rm = o.roofMat || MAT.tile;
  g.add(
    tbox(
      w + 1,
      Y,
      d + 1 + (o.veranda || 0),
      MAT.granite,
      0,
      Y / 2,
      (o.veranda || 0) / 2,
    ),
    tbox(w, h, d, wall, 0, Y + h / 2, 0),
  );
  if (o.roof === 'flat')
    g.add(
      asRoof(
        tbox(
          w + 1.6,
          0.35,
          d + 1.6 + (o.veranda || 0),
          o.roofMat || MAT.darkStone,
          0,
          Y + h + 0.17,
          (o.veranda || 0) / 2,
        ),
      ),
    );
  else if (o.roof === 'hip') {
    const c = mesh(
      new THREE.ConeGeometry(Math.max(w, d) * 0.78, o.rise || 2.2, 4),
      rm,
      0,
      Y + h + (o.rise || 2.2) / 2,
      0,
    );
    c.rotation.y = Math.PI / 4;
    c.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
    g.add(asRoof(c));
  } else
    g.add(asRoof(gableRoof(d + 1.6, w + 1.6, o.rise || 2.4, Y + h, rm, wall)));
  const n = o.win ?? Math.max(1, Math.floor(w / 4)),
    win = [];
  for (let i = 0; i < n; i++)
    win.push(
      M(
        -w / 2 + ((i + 0.5) * w) / n,
        Y + h * 0.55,
        d / 2 + 0.03,
        Math.min(1.8, (w / n) * 0.5),
        h * 0.42,
        0.08,
      ),
    );
  if (n)
    g.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.window, win, false));
  if (o.veranda) {
    const cols = [];
    for (
      let x = -w / 2 + 0.4;
      x <= w / 2 - 0.3;
      x += Math.max(3, w / Math.round(w / 3.6))
    )
      cols.push([x, d / 2 + o.veranda - 0.4]);
    g.add(columns(cols, Y, h - 0.6, 0.16, o.colMat || MAT.wood, true));
    if (o.roof !== 'flat') {
      const v = tbox(
        w + 1.6,
        0.2,
        o.veranda + 0.6,
        rm,
        0,
        Y + h - 0.45,
        d / 2 + o.veranda / 2,
      );
      v.rotation.x = 0.2;
      g.add(asRoof(v));
    }
  }
  return g;
}
// 开敞棚屋：石柱 + 平顶（钢格栅 / 木顶）；正面朝 +Z
function pavilion(w, d, h, o = {}) {
  const g = new THREE.Group(),
    Y = o.plinth ?? 0.3,
    nx = o.nx || Math.max(2, Math.round(w / 5) + 1),
    nz = o.nz || Math.max(2, Math.round(d / 5) + 1),
    pts = [];
  for (let i = 0; i < nx; i++)
    for (let k = 0; k < nz; k++)
      if (o.all || i === 0 || k === 0 || i === nx - 1 || k === nz - 1)
        pts.push([
          -w / 2 + 0.5 + (i * (w - 1)) / (nx - 1),
          -d / 2 + 0.5 + (k * (d - 1)) / (nz - 1),
        ]);
  g.add(
    tbox(w + 1.2, Y, d + 1.2, o.floor || MAT.granite, 0, Y / 2, 0),
    stoneColumns(pts, Y, h, o.r || 0.24, o.colMat || MAT.granite),
  );
  const roof = new THREE.Group();
  asRoof(roof);
  roof.add(
    tbox(w + 2.4, 0.18, d + 2.4, o.roofMat || MAT.wood, 0, Y + h + 0.5, 0),
  );
  const beams = [];
  for (let i = 0; i < nx; i++)
    beams.push(
      M(
        -w / 2 + 0.5 + (i * (w - 1)) / (nx - 1),
        Y + h + 0.2,
        0,
        0.16,
        0.36,
        d + 2,
      ),
    );
  for (let k = 0; k < nz; k++)
    beams.push(
      M(
        0,
        Y + h + 0.2,
        -d / 2 + 0.5 + (k * (d - 1)) / (nz - 1),
        w + 2,
        0.36,
        0.16,
      ),
    );
  roof.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), o.beamMat || MAT.black, beams),
  );
  g.add(roof);
  return g;
}
// 大三叉戟（铁黑色）：杆 + 三股叶刃
function bigTrishul(h, mat = MAT.black) {
  const g = new THREE.Group(),
    s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.2, 0.5, 0.1, 1.15);
  s.lineTo(0, 1.5);
  s.lineTo(-0.1, 1.15);
  s.quadraticCurveTo(-0.2, 0.5, 0, 0); // 中刃
  const side = (sx) => {
    const p = new THREE.Shape();
    p.moveTo(0, -0.1);
    p.quadraticCurveTo(sx * 0.75, -0.15, sx * 0.72, 0.55);
    p.quadraticCurveTo(sx * 0.9, 0.85, sx * 0.66, 1.2);
    p.quadraticCurveTo(sx * 0.6, 0.8, sx * 0.5, 0.6);
    p.quadraticCurveTo(sx * 0.48, 0.15, 0, 0.12);
    p.closePath();
    return p;
  };
  const ex = (sh) => {
    const m = mesh(
      new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: false }),
      mat,
      0,
      h,
      -0.035,
    );
    return m;
  };
  g.add(
    tcyl(0.06, 0.07, h, 8, mat, 0, h / 2, 0),
    ex(s),
    ex(side(1)),
    ex(side(-1)),
    mesh(new THREE.SphereGeometry(0.14, 8, 6), mat, 0, h - 0.05, 0),
  );
  return g;
}
// —— 第四轮新增的小工具 ——
// 由粗到细的弯管（牛角、尾巴）
function taperTube(pts, r0, r1, mat, N = 24, R = 10) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new V3(...p))),
    geo = new THREE.TubeGeometry(curve, N, 1, R),
    p = geo.attributes.position,
    c = new V3();
  for (let i = 0; i <= N; i++) {
    curve.getPointAt(i / N, c);
    const r = lerp(r0, r1, i / N);
    for (let k = 0; k <= R; k++) {
      const j = i * (R + 1) + k;
      p.setXYZ(
        j,
        c.x + (p.getX(j) - c.x) * r,
        c.y + (p.getY(j) - c.y) * r,
        c.z + (p.getZ(j) - c.z) * r,
      );
    }
  }
  geo.computeVertexNormals();
  return mesh(geo, mat);
}
// 一批可以各自上色的小方块 / 小物件：items = [[matrix, 0xcolor], ...]
function tinted(geo, items, rough = 0.7) {
  const m = instanced(
      geo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough }),
      items.map((i) => i[0]),
      false,
    ),
    c = new Color();
  items.forEach((it, i) => m.setColorAt(i, c.set(it[1])));
  return m;
}
// —— 人与牛车（第十轮）——
// 人和牛车共用一种顶点色材质：衣服部分的顶点色写成 -1，渲染时换成每个实例自己的颜色（instanceColor）；
// 皮肤、头发、木头、牛身等是固定的顶点色。于是一群人（站 / 盘腿坐 / 坐椅子）每种姿势只要一次 draw call。
// 所有人群和牛车都标记 userData.npc：右上角「行人」整体开关，漫步模式不拿它们做碰撞。
const PR = mulberry(20261119); // 人群专用随机数：不动 rnd()，植被等其它随机布置保持不变
const pr = (a, b) => a + (b - a) * PR();
const SKIN = 0x7a4a30,
  HAIR = 0x17120e;
const WHITES = [0xf2eee4, 0xebe5d6, 0xf6f4ee],
  MENC = [0xd8c7a2, 0x8c6b4a, 0x3f5c86, 0xc9692e, 0x6c7a88, 0xa33a2a],
  SARI = [
    0xb3261c, 0xe0781e, 0x2f7d4a, 0x2a4f9a, 0xd2477f, 0xe2be3e, 0x7a2f6b,
    0x1f8a8a,
  ];
const pick = (a) => a[(PR() * a.length) | 0];
// 衣服颜色：园区里白色居多；女众多穿纱丽
const dress = (female) =>
  female
    ? PR() < 0.3
      ? pick(WHITES)
      : pick(SARI)
    : PR() < 0.6
      ? pick(WHITES)
      : pick(MENC);
function paint(geo, hex) {
  // 给几何体整体上一种顶点色；hex 为 null 表示“衣服”（由实例颜色决定）
  const g = geo.index ? geo.toNonIndexed() : geo,
    n = g.attributes.position.count,
    a = new Float32Array(n * 3),
    c = hex == null ? null : new Color(hex);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c ? c.r : -1;
    a[i * 3 + 1] = c ? c.g : -1;
    a[i * 3 + 2] = c ? c.b : -1;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function recolor(geo, hex) {
  // 把“衣服”顶点换成固定颜色（合并进牛车这类整体网格时用）
  const g = geo.clone(),
    a = g.attributes.color,
    c = new Color(hex);
  for (let i = 0; i < a.count; i++)
    if (a.getX(i) < 0) a.setXYZ(i, c.r, c.g, c.b);
  return g;
}
function vcolMat() {
  if (MAT.vcol) return MAT.vcol;
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace(
      '#include <color_vertex>',
      `#include <color_vertex>
    #ifdef USE_INSTANCING_COLOR
      vColor.xyz = color.r < 0.0 ? instanceColor.xyz : color.xyz;
    #else
      vColor.xyz = color.r < 0.0 ? vec3(0.85) : color.xyz;
    #endif`,
    );
  };
  return (MAT.vcol = m);
}
const pcap = (r, len, x, y, z, rx = 0, rz = 0, sx = 1, sz = 1) =>
  new THREE.CapsuleGeometry(r, len, 1, 5)
    .scale(sx, 1, sz)
    .rotateX(rx)
    .rotateZ(rz)
    .translate(x, y, z);
const pball = (r, x, y, z, sx = 1, sy = 1, sz = 1, w = 6, h = 4) =>
  new THREE.SphereGeometry(r, w, h).scale(sx, sy, sz).translate(x, y, z);
// 人的几种姿势（正面朝 +Z，原点在脚下 / 坐面下）：sm/sf 站，cm/cf 盘腿坐，hm/hf 坐椅子，wm/wf 走路的上半身，leg 走路的腿（原点在髋）
let _PG;
function personGeos() {
  if (_PG) return _PG;
  const C = null;
  // 上半身：y0 为腰高；arms = 'down' 下垂 / 'knee' 搭在膝上 / 'fwd' 向前伸（吃饭）
  const upper = (y0, female, arms) => {
    const ys = y0 + 0.52,
      p = [
        paint(
          new THREE.CapsuleGeometry(0.15, 0.3, 2, 7)
            .scale(1.18, 1, 0.72)
            .translate(0, y0 + 0.3, 0),
          C,
        ),
        paint(
          new THREE.CylinderGeometry(0.045, 0.05, 0.1, 5, 1, true).translate(
            0,
            y0 + 0.64,
            0,
          ),
          SKIN,
        ),
        paint(pball(0.105, 0, y0 + 0.77, 0.01, 0.9, 1.1, 1, 7, 5), SKIN),
        paint(
          new THREE.SphereGeometry(
            0.112,
            7,
            3,
            0,
            Math.PI * 2,
            0,
            female ? 2.0 : 1.7,
          )
            .scale(0.92, 1.1, 1.02)
            .translate(0, y0 + 0.785, -0.012),
          HAIR,
        ),
      ];
    if (female) p.push(paint(pball(0.065, 0, y0 + 0.74, -0.12), HAIR));
    const A = {
      down: [0, -0.27, 0, -0.56, 0.01],
      knee: [-0.5, -0.215, 0.118, -0.43, 0.235],
      fwd: [-1.1, -0.11, 0.22, -0.22, 0.44],
    }[arms];
    for (const sx of [-1, 1])
      p.push(
        paint(
          pcap(
            0.045,
            0.4,
            sx * 0.21,
            ys + A[1],
            A[2],
            A[0],
            arms === 'down' ? sx * 0.07 : 0,
          ),
          C,
        ),
        paint(pball(0.045, sx * 0.23, ys + A[3], A[4]), SKIN),
      );
    return p;
  };
  const feet = (y, z) =>
    [-1, 1].map((sx) =>
      paint(pball(0.05, sx * 0.085, y, z, 0.9, 0.5, 1.8), SKIN),
    );
  const legsStand = () => [
    paint(pcap(0.07, 0.62, -0.085, 0.42, 0), C),
    paint(pcap(0.07, 0.62, 0.085, 0.42, 0), C),
    ...feet(0.03, 0.05),
  ];
  const skirt = () => [
    paint(
      new THREE.CylinderGeometry(0.17, 0.27, 0.84, 8, 1, true).translate(
        0,
        0.44,
        0,
      ),
      C,
    ),
    ...feet(0.03, 0.08),
  ];
  const crossed = () => [paint(pball(1, 0, 0.09, 0.1, 0.3, 0.09, 0.2), C)];
  const chairLegs = () =>
    [-1, 1]
      .flatMap((sx) => [
        paint(pcap(0.07, 0.3, sx * 0.09, 0.52, 0.2, Math.PI / 2), C),
        paint(pcap(0.06, 0.4, sx * 0.09, 0.21, 0.42), C),
      ])
      .concat(feet(-0.03, 0.47));
  _PG = {
    sm: mergeGeos([...upper(0.84, false, 'down'), ...legsStand()]),
    sf: mergeGeos([...upper(0.8, true, 'down'), ...skirt()]),
    cm: mergeGeos([...upper(0.17, false, 'knee'), ...crossed()]),
    cf: mergeGeos([...upper(0.17, true, 'knee'), ...crossed()]),
    hm: mergeGeos([...upper(0.5, false, 'fwd'), ...chairLegs()]),
    hf: mergeGeos([...upper(0.5, true, 'fwd'), ...chairLegs()]),
    wm: mergeGeos(upper(0.84, false, 'down')),
    wf: mergeGeos([...upper(0.84, true, 'down'), ...skirt()]),
    leg: mergeGeos([
      paint(pcap(0.07, 0.62, 0, -0.42, 0), C),
      paint(pball(0.05, 0, -0.81, 0.05, 0.9, 0.5, 1.8), SKIN),
    ]),
  };
  for (const k in _PG) _PG[k].computeBoundingSphere();
  return _PG;
}
// 一群静止的人：list = [[x, y, z, 朝向, 0xcolor, 姿势], ...]，姿势见 personGeos()；每种姿势一次 draw call
const NPC_FAR = 380; // 镜头这么远以外的人不画（约 3 像素高）
const CROWDS = []; // 所有静止人群（按组做远近隐藏）
let frameNo = 0;
function crowd(list, shadow = true) {
  const PG = personGeos(),
    by = {},
    c = new Color(),
    g = new THREE.Group();
  for (const p of list) (by[p[5]] ||= []).push(p);
  for (const k in by) {
    const m = instanced(
      PG[k],
      vcolMat(),
      by[k].map(([x, y, z, ry]) => M(x, y, z, 1, 1, 1, ry)),
      shadow,
    );
    by[k].forEach((p, i) => m.setColorAt(i, c.set(p[4])));
    m.userData.npc = true;
    g.add(m);
  }
  // 以人群中心为组的原点，方便按距离隐藏
  const cx = list.reduce((s, p) => s + p[0], 0) / list.length,
    cz = list.reduce((s, p) => s + p[2], 0) / list.length;
  g.children.forEach((m) => m.position.set(-cx, 0, -cz));
  g.position.set(cx, 0, cz);
  g.userData.radius = Math.max(
    ...list.map((p) => Math.hypot(p[0] - cx, p[2] - cz)),
  );
  CROWDS.push(g);
  return g;
}
// 随机生成一个人：pose = 's' 站 / 'c' 盘腿 / 'h' 坐椅子；fem 为女众比例
const folk = (x, y, z, ry, pose, fem = 0.45, white = 0) => {
  const f = PR() < fem;
  return [
    x,
    y,
    z,
    ry,
    PR() < white ? pick(WHITES) : dress(f),
    pose + (f ? 'f' : 'm'),
  ];
};
// 盘腿坐着的人（兼容旧接口）：pts = [[x, y, z, 朝向, 0xcolor], ...]
function seated(pts) {
  return crowd(pts.map(([x, y, z, ry, col]) => [x, y, z, ry, col, 'cm']));
}

// 牛车（Kangayam 白牛一对 + 木轮车 + 拱形布篷），正面朝 +Z，原点在车轴正下方的地面。
// 返回 Group，userData.step(行进距离, 是否在走) 转动车轮、摆动牛腿。车身、两头牛、乘客合并成一个网格。
let _wheelGeo;
function oxCart(o = {}) {
  const horn = o.horn ?? 0xb3261c,
    WOOD = 0x6b4a2e,
    DW = 0x3e2a1a,
    BULL = 0xdcd7cc,
    BULL2 = 0xb3ada2,
    DARK = 0x2a2420,
    GOLD = 0xd6a23c;
  const P = [],
    box = (w, h, d, x, y, z, col) =>
      P.push(paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), col));
  // 车身：木板车床、两侧与后面的挡板、车轴与轴托
  box(1.5, 0.1, 2.5, 0, 1.0, 0.1, WOOD);
  for (const sx of [-1, 1])
    (box(0.08, 0.26, 2.5, sx * 0.74, 1.17, 0.1, DW),
      box(0.12, 0.28, 0.3, sx * 0.6, 0.86, 0, DW));
  box(1.5, 0.26, 0.08, 0, 1.17, -1.13, DW);
  P.push(
    paint(
      new THREE.CylinderGeometry(0.06, 0.06, 1.95, 6)
        .rotateZ(Math.PI / 2)
        .translate(0, 0.72, 0),
      DW,
    ),
  );
  // 拱形布篷，两端红边
  P.push(
    paint(
      new THREE.CylinderGeometry(
        0.8,
        0.8,
        1.9,
        12,
        1,
        true,
        Math.PI / 2,
        Math.PI,
      )
        .rotateX(Math.PI / 2)
        .translate(0, 1.2, -0.15),
      0xeadcbc,
    ),
  );
  for (const z of [-1.1, 0.8])
    P.push(
      paint(
        new THREE.CylinderGeometry(
          0.82,
          0.82,
          0.12,
          12,
          1,
          true,
          Math.PI / 2,
          Math.PI,
        )
          .rotateX(Math.PI / 2)
          .translate(0, 1.2, z),
        0xa8281e,
      ),
    );
  // 车辕与轭
  P.push(
    paint(
      new THREE.BoxGeometry(0.12, 0.12, 2.7)
        .rotateX(-0.09)
        .translate(0, 1.18, 2.55),
      WOOD,
    ),
  );
  box(1.9, 0.12, 0.14, 0, 1.38, 3.9, WOOD);
  // 两头白牛：肩峰、垂皮、彩绘牛角（角尖铜帽）、颈下铜铃、背上的彩毯
  const pivots = [];
  for (const [bi, bx] of [
    [0, -0.55],
    [1, 0.55],
  ]) {
    const bz = 2.95;
    P.push(
      paint(pball(1, bx, 1.08, bz, 0.36, 0.42, 0.98, 12, 8), BULL),
      paint(pball(1, bx, 1.1, bz - 0.2, 0.375, 0.425, 0.5, 12, 8), horn),
      paint(pball(0.25, bx, 1.5, bz + 0.62, 0.85, 1, 1.15, 10, 7), BULL2),
      paint(pcap(0.2, 0.32, bx, 1.27, bz + 1.07, 1.14), BULL2),
      paint(
        new THREE.SphereGeometry(1, 10, 7)
          .scale(0.16, 0.18, 0.36)
          .rotateX(0.55)
          .translate(bx, 1.28, bz + 1.52),
        BULL,
      ),
      paint(pball(0.11, bx, 1.1, bz + 1.82, 1, 0.85, 1.1), DARK),
      paint(pball(1, bx, 0.86, bz + 1.0, 0.06, 0.26, 0.4), BULL),
      paint(pball(0.06, bx, 0.55, bz - 1.02, 1, 1.6, 1), DARK),
      paint(pball(0.07, bx, 0.98, bz + 1.25), GOLD),
    );
    P.push(
      paint(
        taperTube(
          [
            [bx, 1.32, bz - 0.93],
            [bx, 1.0, bz - 1.04],
            [bx, 0.6, bz - 1.02],
          ],
          0.035,
          0.02,
          undefined,
          10,
          5,
        ).geometry,
        BULL,
      ),
    );
    for (const sx of [-1, 1]) {
      P.push(
        paint(pball(0.03, bx + sx * 0.14, 1.36, bz + 1.5), DARK),
        paint(
          pball(1, bx + sx * 0.19, 1.42, bz + 1.36, 0.12, 0.045, 0.07),
          BULL,
        ),
        paint(
          taperTube(
            [
              [bx + sx * 0.1, 1.45, bz + 1.38],
              [bx + sx * 0.22, 1.66, bz + 1.3],
              [bx + sx * 0.2, 1.9, bz + 1.18],
            ],
            0.05,
            0.014,
            undefined,
            10,
            6,
          ).geometry,
          horn,
        ),
        paint(pball(0.03, bx + sx * 0.2, 1.91, bz + 1.17), GOLD),
      );
    }
    // 腿的转轴（走路顺序：左后 → 左前 → 右后 → 右前）
    const off = bi * 0.4;
    pivots.push(
      [bx - 0.16, 0.95, bz - 0.62, off],
      [bx - 0.15, 0.92, bz + 0.6, off + Math.PI / 2],
      [bx + 0.16, 0.95, bz - 0.62, off + Math.PI],
      [bx + 0.15, 0.92, bz + 0.6, off + Math.PI * 1.5],
    );
  }
  // 乘客：车上两两相对盘腿坐；赶车人坐在车前沿，腿垂在车辕两边
  const PG = personGeos();
  for (const [x, z, ry] of [
    [-0.42, -0.75, Math.PI / 2],
    [0.42, -0.75, -Math.PI / 2],
    [-0.42, 0.05, Math.PI / 2],
    [0.42, 0.05, -Math.PI / 2],
  ].slice(0, o.riders ?? 4)) {
    const f = PR() < 0.5;
    P.push(
      recolor(PG[f ? 'cf' : 'cm'], dress(f)).applyMatrix4(
        M(x, 1.05, z, 1, 1, 1, ry),
      ),
    );
  }
  if (o.driver !== false)
    P.push(recolor(PG.hm, pick(WHITES)).applyMatrix4(M(0, 0.6, 1.2)));
  const g = new THREE.Group(),
    shadow = !!o.shadow;
  g.add(mesh(mergeGeos(P), vcolMat(), 0, 0, 0, shadow));
  // 两个木轮（辐条 + 铁箍），绕 X 轴转
  _wheelGeo =
    _wheelGeo ||
    mergeGeos([
      paint(
        new THREE.TorusGeometry(0.72, 0.045, 5, 20).rotateY(Math.PI / 2),
        DW,
      ),
      paint(
        new THREE.TorusGeometry(0.745, 0.025, 4, 20).rotateY(Math.PI / 2),
        0x2a2826,
      ),
      paint(
        new THREE.CylinderGeometry(0.11, 0.11, 0.24, 8).rotateZ(Math.PI / 2),
        DW,
      ),
      ...[0, 1, 2, 3, 4, 5].map((k) =>
        paint(
          new THREE.BoxGeometry(0.04, 1.42, 0.05).rotateX((k * Math.PI) / 6),
          DW,
        ),
      ),
    ]);
  const wheels = [-0.85, 0.85].map((x) =>
    mesh(_wheelGeo, vcolMat(), x, 0.745, 0, shadow),
  );
  g.add(...wheels);
  // 八条牛腿：一个 InstancedMesh，原点在肩 / 髋
  const legGeo = mergeGeos([
    paint(
      new THREE.CylinderGeometry(0.06, 0.085, 0.82, 6).translate(0, -0.41, 0),
      null,
    ),
    paint(
      new THREE.CylinderGeometry(0.07, 0.075, 0.09, 6).translate(0, -0.87, 0),
      DARK,
    ),
  ]);
  const legs = instanced(
      legGeo,
      vcolMat(),
      pivots.map(([x, y, z]) => M(x, y, z)),
      shadow,
    ),
    c = new Color(BULL);
  pivots.forEach((_, i) => legs.setColorAt(i, c));
  g.add(legs);
  g.userData.npc = true;
  g.userData.step = (dist, moving) => {
    for (const w of wheels) w.rotation.x = dist / 0.745;
    const ph = (dist / 1.6) * Math.PI * 2;
    pivots.forEach(([x, y, z, off], i) =>
      legs.setMatrixAt(
        i,
        M(x, y, z, 1, 1, 1, 0, moving ? Math.sin(ph + off) * 0.3 : 0),
      ),
    );
    legs.instanceMatrix.needsUpdate = true;
  };
  return g;
}
// 餐桌 + 四把椅子（黑色铁艺），pts = [[x, z], ...]
function diningSets(pts, y, mat) {
  const box = new THREE.BoxGeometry(1, 1, 1),
    tops = [],
    legs = [],
    seats = [];
  for (const [x, z] of pts) {
    tops.push(M(x, y + 0.76, z, 1.25, 0.05, 0.8));
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        legs.push(M(x + sx * 0.55, y + 0.37, z + sz * 0.33, 0.05, 0.74, 0.05));
        seats.push(
          M(x + sx * 0.32, y + 0.45, z + sz * 0.72, 0.42, 0.04, 0.42),
          M(x + sx * 0.32, y + 0.7, z + sz * 0.92, 0.42, 0.45, 0.04),
        );
      }
  }
  const g = new THREE.Group();
  g.add(
    instanced(box, mat, tops, false),
    instanced(box, mat, legs, false),
    instanced(box, mat, seats, false),
  );
  return g;
}
// 额外的贴图与材质（在 buildMaterials 末尾调用）
function buildExtras() {
  const std = (o, s) => {
    const m = new THREE.MeshStandardMaterial(o);
    m.userData.s = s;
    return m;
  };
  // 镂空格栅（木格 / 石雕花窗）：白线 + 透明孔，颜色由材质决定
  TEX.jali = canvasTex(128, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) {
      g.fillRect(i * 32, 0, 9, s);
      g.fillRect(0, i * 32, s, 9);
    }
  });
  TEX.diamond = canvasTex(128, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.strokeStyle = '#fff';
    g.lineWidth = 9;
    for (let i = -4; i < 8; i++) {
      g.beginPath();
      g.moveTo(i * 32, 0);
      g.lineTo(i * 32 + s, s);
      g.stroke();
      g.beginPath();
      g.moveTo(i * 32, 0);
      g.lineTo(i * 32 - s, s);
      g.stroke();
    }
  });
  // Kerala 风格壁画（Mahakumbha Mela）：赭黄底、青绿色的河、成群的人物
  TEX.mural = canvasTex(
    512,
    (g, s) => {
      g.fillStyle = '#d9a23c';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `hsl(${[8, 22, 40, 120, 345][i % 5]},${55 + TR() * 25}%,${35 + TR() * 30}%)`;
        const x = TR() * s,
          y = TR() * s;
        g.beginPath();
        g.ellipse(x, y, 5 + TR() * 7, 9 + TR() * 12, TR() * 0.6 - 0.3, 0, 7);
        g.fill();
        g.fillStyle = '#f3d9b0';
        g.beginPath();
        g.arc(x, y - 14, 4, 0, 7);
        g.fill();
      }
      g.strokeStyle = '#3aa39a';
      g.lineWidth = 78;
      g.beginPath();
      g.moveTo(-20, s * 0.6);
      g.bezierCurveTo(s * 0.3, s * 0.3, s * 0.6, s * 0.8, s + 20, s * 0.45);
      g.stroke();
      g.strokeStyle = 'rgba(240,250,245,.75)';
      g.lineWidth = 3;
      for (let k = -2; k <= 2; k++) {
        g.beginPath();
        g.moveTo(-20, s * 0.6 + k * 14);
        g.bezierCurveTo(
          s * 0.3,
          s * 0.3 + k * 14,
          s * 0.6,
          s * 0.8 + k * 14,
          s + 20,
          s * 0.45 + k * 14,
        );
        g.stroke();
      }
    },
    false,
  );
  MAT.mud.color.set(0xb8663a); // 穹顶是赭红的泥灰色
  MAT.brickDS = std(
    {
      map: TEX.brick,
      color: 0xc08a5e,
      roughness: 0.95,
      side: THREE.DoubleSide,
    },
    2.4,
  );
  MAT.brickIn = std(
    { map: TEX.brick, color: 0xb9774c, roughness: 0.95, side: THREE.BackSide },
    2.4,
  );
  MAT.graniteDS = std(
    { map: TEX.stone, color: 0x9a968e, roughness: 0.9, side: THREE.DoubleSide },
    4,
  );
  MAT.avud = std(
    { map: TEX.plaster, color: 0x8b5a3c, roughness: 0.6, metalness: 0.1 },
    3,
  ); // 七圈盘蛇的 avudaiyar
  MAT.greenStone = std({ map: TEX.stone, color: 0x6f8d7c, roughness: 0.75 }, 3);
  MAT.concrete = std({ map: TEX.plaster, color: 0xbdb6a8, roughness: 0.95 }, 5);
  MAT.jali = std(
    {
      map: TEX.jali,
      color: 0x4a2c18,
      roughness: 0.8,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    },
    0.9,
  );
  MAT.jaliStone = std(
    {
      map: TEX.diamond,
      color: 0xefe9dc,
      roughness: 0.8,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    },
    0.9,
  );
  MAT.grid = std(
    {
      map: TEX.jali,
      color: 0x6a4a30,
      roughness: 0.8,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    },
    2.4,
  ); // 钢格栅顶棚
  MAT.sariRed = std(
    { color: 0x9c1b22, roughness: 0.85, side: THREE.DoubleSide },
    4,
  );
  MAT.sariGreen = std(
    { color: 0x1f6a3a, roughness: 0.85, side: THREE.DoubleSide },
    4,
  );
  MAT.goldTrim = std(
    {
      color: 0xd8a63c,
      roughness: 0.45,
      metalness: 0.7,
      side: THREE.DoubleSide,
    },
    4,
  );
  MAT.muralM = std(
    {
      map: TEX.mural,
      roughness: 0.8,
      side: THREE.DoubleSide,
      emissive: 0xffffff,
      emissiveMap: TEX.mural,
      emissiveIntensity: 0.12,
    },
    4,
  );
  MAT.pondWater = std(
    {
      map: TEX.water,
      color: 0x33574a,
      roughness: 0.15,
      metalness: 0.2,
      transparent: true,
      opacity: 0.93,
    },
    4,
  );
  MAT.rock = new THREE.MeshLambertMaterial({
    color: 0x8d877c,
    flatShading: true,
  });
  MAT.lotusW = std({ color: 0xf6efe6, roughness: 0.7 }, 4);
  MAT.pad = std({ color: 0x4d7c38, roughness: 0.8 }, 4);
  MAT.eyeW = emi(
    std(
      {
        color: 0xf4efe2,
        roughness: 0.4,
        emissive: 0xfff0d0,
        emissiveIntensity: 0.4,
      },
      4,
    ),
    0.5,
  );
}

// —— Adiyogi 的头（第十一轮）：参照 Wikimedia Commons 上的正面、侧面照片，用代码“雕”出五官 ——
// 头部局部坐标（hd 组内、缩放前）：原点在头中心，+Z 朝前，+Y 朝上；头宽约 10.3、高约 14.6、前后约 12。
// 做法：自建一个经纬网格，正面（经度 0 附近）和脸的高度（纬度中段）加密，约 0.05 单位一格；
// 先摆成下颌收窄的椭球，再在正面叠加起伏 relief(x, y)：眉弓、眼窝、半闭的上眼睑和眼缝、长直的鼻梁与鼻翼、
// 饱满带笑意的双唇、圆下巴、颧骨。凹处（眼缝、嘴缝、鼻孔、鼻翼沟）同时记一个 dark 值，用顶点色压暗，远看也读得出五官。
// 想调五官：改 relief() 里对应那一行的位置 / 大小 / 高度即可。
function adiyogiHead() {
  const A = 5.15,
    B = 7.3,
    CF = 5.9,
    CB = 6.4; // 椭球半轴：左右、上下、前、后
  const G = (x, y, cx, cy, sx, sy) =>
    Math.exp(-(((x - cx) / sx) ** 2) - ((y - cy) / sy) ** 2);
  const line = (d, w) => Math.exp(-((d / w) ** 2));
  let dark = 0;
  const relief = (x, y) => {
    let F = 0;
    dark = 0;
    F += 0.35 * G(x, y, 0, 2.9, 2.6, 1.3); // 额头微鼓
    for (const s of [-1, 1]) {
      F -= 0.25 * G(x, y, s * 4.3, 1.7, 0.8, 1.2); // 太阳穴
      F +=
        0.75 *
        G(
          x,
          y,
          s * 2.0,
          1.15 + 0.1 * (1 - ((x * s - 2.0) / 1.6) ** 2),
          1.55,
          0.38,
        ); // 眉弓：弓形，中段最高
      const ex = s * 2.05,
        u = (x - ex) / 1.0,
        inEye = line(Math.max(0, Math.abs(u) - 0.95), 0.14);
      F -= 0.78 * G(x, y, ex, 0.25, 1.25, 0.8); // 眼窝
      F += 0.62 * G(x, y, ex, 0.28, 0.95, 0.42); // 半闭的上眼睑（盖着眼球）
      F += 0.16 * G(x, y, ex, -0.22, 0.85, 0.2); // 下眼睑
      const ySlit = -0.02 + 0.1 * u * s - 0.08 * (1 - u * u); // 眼缝：向下看，外眼角微微上挑
      const slit = line(y - ySlit, 0.09) * inEye;
      F -= 0.3 * slit;
      dark += 0.9 * slit;
      const crease =
        line(y - (ySlit + 0.46 - 0.06 * u * u), 0.09) *
        line(Math.max(0, Math.abs(u) - 0.8), 0.15);
      F -= 0.09 * crease;
      dark += 0.25 * crease; // 上眼睑的褶线
      F += 0.35 * G(x, y, s * 3.3, -0.8, 1.2, 0.9); // 颧骨
      F += 0.38 * G(x, y, s * 2.55, -2.0, 1.1, 1.0); // 饱满的面颊
      F += 0.72 * G(x, y, s * 0.72, -2.3, 0.38, 0.32); // 鼻翼
      const alar = G(x, y, s * 1.06, -2.2, 0.12, 0.36);
      F -= 0.22 * alar;
      dark += 0.5 * alar;
      const nos = G(x, y, s * 0.4, -2.56, 0.2, 0.1);
      F -= 0.3 * nos;
      dark += 0.9 * nos;
      const cor = G(x, y, s * 1.78, -3.55, 0.24, 0.26);
      F -= 0.18 * cor;
      dark += 0.4 * cor; // 嘴角（微微上翘的笑意）
    }
    F += 0.35 * G(x, y, 0, 1.0, 0.8, 0.5); // 眉心
    // 鼻梁：自眉心起越往下越高越宽，到鼻尖（y≈-2.05）最高，鼻底以下迅速收回
    const nh =
        (0.15 + 1.75 * smooth(0.9, -2.0, y)) *
        smooth(-2.75, -2.3, y) *
        smooth(1.5, 0.7, y),
      nw = 0.42 + 0.25 * smooth(0, -2.2, y);
    F += nh * Math.exp(-((x / nw) ** 2)) + 0.35 * G(x, y, 0, -2.05, 0.5, 0.4);
    F += 0.45 * G(x, y, 0, -3.1, 1.3, 0.6); // 人中一带
    F +=
      0.78 * G(x, y, 0, -3.5, 1.35, 0.3) - 0.1 * G(x, y, 0, -3.33, 0.25, 0.12); // 上唇与唇峰
    F += 0.88 * G(x, y, 0, -4.12, 1.12, 0.33); // 下唇
    const yM = -3.78 + 0.22 * (x / 1.6) ** 2,
      mouth = line(y - yM, 0.09) * line(Math.max(0, Math.abs(x) - 1.55), 0.15);
    F -= 0.35 * mouth;
    dark += 0.8 * mouth; // 嘴缝
    F -= 0.25 * G(x, y, 0, -4.65, 0.9, 0.22); // 下唇下的凹
    F += 1.05 * G(x, y, 0, -5.45, 1.25, 0.8); // 下巴：照片侧面看下巴饱满、几乎和嘴唇齐平
    return F;
  };
  const taper = (y) => {
    const t = clamp((-y + 0.2) / 7.5, 0, 1);
    return [1 - 0.44 * t ** 1.3, 1 - 0.1 * t ** 1.3];
  }; // 下半张脸收窄成椭圆下巴，前后几乎不收
  // 同一套经纬网格生成两层：脸和头皮（260×200 格），以及外面一层头发（发棱比五官粗，150×110 格就够）
  const build = (hairLayer, NU, NV) => {
    const idx = [];
    for (let j = 0; j < NV; j++)
      for (let i = 0; i < NU; i++) {
        const a = j * (NU + 1) + i,
          b = a + NU + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    const pos = new Float32Array((NU + 1) * (NV + 1) * 3),
      col = new Float32Array(pos.length);
    let k = 0;
    for (let j = 0; j <= NV; j++) {
      const s = (j / NV) * 2 - 1,
        th = Math.PI / 2 + (Math.PI / 2) * (0.4 * s + 0.6 * s ** 3); // 纬度：脸的高度加密
      for (let i = 0; i <= NU; i++, k += 3) {
        const u = (i / NU) * 2 - 1,
          ph = Math.PI * (0.35 * u + 0.65 * u ** 3); // 经度：正面加密
        const dz = Math.sin(th) * Math.cos(ph);
        let x = Math.sin(th) * Math.sin(ph) * A,
          y = Math.cos(th) * B,
          z = dz * (dz > 0 ? CF : CB);
        let [kx, kz] = taper(y);
        if (hairLayer) {
          const hang = smooth(0.15, -0.25, dz);
          kx = lerp(kx, 1, hang);
          kz = lerp(kz, 1, hang);
        } // 脑后的头发顺着垂下，不随下巴收窄
        x *= kx;
        z *= kz;
        const w = smooth(0.2, 0.7, dz);
        dark = 0;
        if (w > 0) z += relief(x, y) * w;
        let c = 1 - Math.min(0.75, dark * w);
        if (hairLayer) {
          // 发际线：额头正中约 y=4，向两侧降到太阳穴、耳朵上方；脑后整片都是头发。发际线以下的部分缩进头里看不见
          const yH = 4.0 - 2.8 * smooth(2.0, 5.2, Math.abs(x)),
            m = smooth(-0.15, 0.2, dz),
            h = 1 - m + m * smooth(yH - 0.25, yH + 0.25, y);
          const q = Math.atan2(x, y + 4) + 0.08 * Math.sin(z * 0.6),
            ridge =
              0.8 * (0.5 + 0.5 * Math.cos(q * 22)) ** 0.7 +
              0.5 * (fbm(q * 9 + 3, z * 0.35 + y * 0.2, 3) - 0.5); // 向后梳、一绺绺的发棱，带一点不规则的结块
          const t =
              -0.6 +
              h *
                (1.1 +
                  ridge +
                  1.7 * smooth(3, 7.5, y) * smooth(-7, 1, z) +
                  2.2 * smooth(0.1, -0.45, dz) * smooth(4.5, 0, y)),
            r = Math.hypot(x, y, z) || 1; // 头顶蓬起；脑后下半部的发团更厚，把发辫的根部包住
          x += (x / r) * t;
          y += (y / r) * t;
          z += (z / r) * t;
          c = 0.7 + 0.3 * clamp(ridge, 0, 1); // 发棱之间略暗
        }
        pos[k] = x;
        pos[k + 1] = y;
        pos[k + 2] = z;
        col[k] = col[k + 1] = col[k + 2] = c;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  };
  const geo = build(false, 260, 200),
    hairGeo = build(true, 150, 110);
  // 正面某点 (x, y) 的表面 z（摆 tilak 等小件用）
  const surfZ = (x, y) => {
    const [kx, kz] = taper(y),
      xx = x / kx,
      d = Math.max(0, 1 - (xx / A) ** 2 - (y / B) ** 2);
    const z0 = CF * Math.sqrt(d) * kz;
    return z0 + relief(x, y) * smooth(0.2, 0.7, z0 / CF / kz);
  };
  return { geo, hairGeo, surfZ };
}

// —— Adiyogi：34 m 高、45 m 宽、25 m 深的钢制半身像，面朝正南 ——
function createAdiyogi() {
  const g = new THREE.Group(),
    S = MAT.steel,
    yc = 22,
    TA = 22.5,
    TB = 11,
    TC = 12.5; // yc：头部中心高度；TA/TB/TC：肩部椭球半轴
  const surf = (x, z) =>
    TB * Math.sqrt(Math.max(0.02, 1 - (x / TA) ** 2 - (z / TC) ** 2)); // 肩部表面高度
  // 广场：南北向的大铺地、红色铺砖带、台阶与两侧石柱
  const plaza = tbox(124, 0.16, 152, MAT.paving, 0, 0.08, 58);
  plaza.castShadow = false;
  g.add(plaza);
  for (const z of [34, 62, 90, 118]) {
    const s = tbox(124, 0.05, 5, MAT.redPaver, 0, 0.19, z);
    s.castShadow = false;
    g.add(s);
  }
  for (let i = 0; i < 3; i++)
    g.add(
      tbox(78 - i * 3, 0.35, 44 - i * 3, MAT.granite, 0, 0.17 + i * 0.35, 3),
    );
  for (const sx of [-1, 1])
    g.add(
      tbox(3.2, 0.8, 3.2, MAT.granite, sx * 54, 0.4, 44),
      tbox(2.2, 13, 2.2, MAT.darkStone, sx * 54, 7.3, 44),
      tbox(2.8, 0.5, 2.8, MAT.granite, sx * 54, 14, 44),
    );
  const body = new THREE.Group();
  body.position.y = 1;
  g.add(body);
  // 躯干：又宽又浅的肩部穹面 + 粗壮的颈
  const torso = mesh(new THREE.SphereGeometry(1, 40, 20), S, 0, 0, 0);
  torso.scale.set(TA, TB, TC);
  body.add(
    torso,
    mesh(new THREE.CylinderGeometry(4.9, 6.4, 10, 20), S, 0, 12, 0.4),
  );
  // 头部整体放在 hd 组里（坐标相对头部中心），改 hd.scale / hd.rotation 即可调整头身比例与仰角
  const hd = new THREE.Group();
  hd.position.set(0, yc, 0.6);
  hd.scale.setScalar(1.25);
  hd.rotation.x = -0.1;
  body.add(hd);
  // 脸：一整张按参考照片“雕”出来的高密度网格（见 adiyogiHead），五官都是网格本身的起伏，凹处顶点色压暗
  const HEAD = adiyogiHead(),
    faceMat = S.clone();
  faceMat.vertexColors = true;
  hd.add(mesh(HEAD.geo, faceMat));
  for (const sx of [-1, 1]) {
    const ear = mesh(
      new THREE.SphereGeometry(1, 12, 10),
      S,
      sx * 5.25,
      -0.5,
      0.2,
    );
    ear.scale.set(0.42, 2.3, 1.15);
    ear.rotation.z = sx * 0.08;
    const ring = mesh(
      new THREE.TorusGeometry(0.95, 0.2, 8, 18),
      MAT.copper,
      sx * 5.55,
      -3.6,
      0.5,
    );
    ring.rotation.y = Math.PI / 2;
    hd.add(ear, ring);
  }
  // 额头正中一滴白色的 tilak（上尖下圆）
  const tk = mergeGeos([
    new THREE.SphereGeometry(
      0.32,
      14,
      10,
      0,
      Math.PI * 2,
      Math.PI / 2,
      Math.PI / 2,
    ),
    new THREE.ConeGeometry(0.32, 0.95, 14, 1, true).translate(0, 0.475, 0),
  ]);
  tk.computeVertexNormals();
  const tilak = mesh(tk, MAT.white, 0, 2.35, HEAD.surfZ(0, 2.35) + 0.02, false);
  tilak.scale.set(1.25, 1.25, 0.5);
  tilak.rotation.x = -0.32;
  hd.add(tilak);
  // 头发：蓬松的发冠（没有高耸的发髻），大波浪发辫披到肩上
  hd.add(mesh(HEAD.hairGeo, faceMat)); // 头发：贴着头型的一层发壳，发际线以上、脑后整片，带向后梳的发棱（见 adiyogiHead）
  const moon = mesh(
    new THREE.TorusGeometry(2.3, 0.34, 8, 20, Math.PI * 1.1),
    MAT.moon,
    4.9,
    6.9,
    2.6,
    false,
  );
  moon.rotation.set(-0.35, 0.5, Math.PI + 1.15);
  hd.add(moon);
  const locks = [];
  for (let a = 96; a <= 264.1; a += 168 / 26) {
    // 发辫从耳后垂下（第十一轮由 52°–308° 收窄，不再挡住侧脸；条数不变，随机数序列不变）
    const A = (a + rr(-3, 3)) * deg,
      sn = Math.sin(A),
      cs = Math.cos(A),
      j = rnd(),
      wv = rr(-0.9, 0.9);
    const p3x = sn * (13.5 + j * 2),
      p3z = cs * 8.6 - 1.2,
      p4x = sn * (18.5 + j * 2),
      p4z = cs * 9 - 1.2;
    const curve = new THREE.CatmullRomCurve3([
      new V3(sn * 5.8, yc + 2.0, cs * 5.8 + 0.4),
      new V3(sn * 8.2 + cs * wv, yc - 2.5, cs * 7.8),
      new V3(sn * 9.0 - cs * wv, yc - 7.5, cs * 8.2 - 0.4),
      new V3(sn * 11, 13.2, cs * 8.6 - 0.8),
      new V3(p3x, surf(p3x, p3z) + 0.7, p3z),
      new V3(p4x, surf(p4x, p4z) + 0.2, p4z),
    ]);
    locks.push(new THREE.TubeGeometry(curve, 16, rr(1.05, 1.6), 6));
  }
  body.add(mesh(mergeGeos(locks), S));
  // 颈间之蛇：盘在颈上，蛇首昂起在他的右肩一侧（观者左手边）
  const sp = [],
    a0 = 0.75 - Math.PI * 2 * 1.3;
  for (let i = 0; i <= 40; i++) {
    const t = i / 40,
      a = a0 + t * Math.PI * 2 * 1.3,
      r = 6.9 - t * 0.6;
    sp.push(new V3(-Math.sin(a) * r, 9.6 + t * 2.4, Math.cos(a) * r + 0.4));
  }
  sp.push(
    new V3(-Math.sin(0.85) * 7.2, 13.6, Math.cos(0.85) * 7.2),
    new V3(-Math.sin(0.95) * 8.2, 15.6, Math.cos(0.95) * 8.0),
    new V3(-Math.sin(1.0) * 8.6, 17.4, Math.cos(1.0) * 8.2),
  );
  body.add(
    mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sp), 100, 0.6, 8),
      S,
    ),
  );
  const hood = mesh(
    new THREE.SphereGeometry(1, 12, 10),
    S,
    -Math.sin(1.0) * 8.7,
    18.4,
    Math.cos(1.0) * 8.3,
  );
  hood.scale.set(1.5, 1.9, 0.5);
  hood.rotation.y = -0.9;
  body.add(hood);
  // 细绳念珠
  const mp = [];
  for (let i = 0; i <= 24; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 24,
      x = 7.4 * Math.sin(a),
      y = 9.2 - 5.4 * Math.cos(a);
    mp.push(
      new V3(
        x,
        y,
        TC * Math.sqrt(Math.max(0.02, 1 - (x / TA) ** 2 - (y / TB) ** 2)) +
          0.12,
      ),
    );
  }
  body.add(
    mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(mp), 48, 0.13, 5),
      MAT.wood,
    ),
    mesh(
      new THREE.SphereGeometry(0.45, 8, 6),
      MAT.wood,
      0,
      3.6,
      mp[12].z + 0.2,
    ),
  );
  // 像前的 Yogeshwar Linga（参照 Isha 官网照片）：方亭、赤陶色四坡攒尖顶、木条吊顶；地面嵌着六芒星圆盘，
  //  中间是黑色环形水盘，盘里一座刻满经文的银色穹形林伽（象征五个主要脉轮）
  const yl = new THREE.Group();
  yl.position.set(0, 0, 33);
  yl.add(tbox(13, 0.5, 13, MAT.granite, 0, 0.25, 0));
  const disk = mesh(
      new THREE.CircleGeometry(4.6, 48).rotateX(-Math.PI / 2),
      MAT.sandstone,
      0,
      0.51,
      0,
      false,
    ),
    rim = mesh(
      new THREE.RingGeometry(4.3, 4.6, 48).rotateX(-Math.PI / 2),
      MAT.gold,
      0,
      0.52,
      0,
      false,
    );
  const star = [];
  for (let k = 0; k < 6; k++) {
    const a0 = (k * Math.PI) / 3;
    star.push(
      M(
        Math.cos(a0) * 2.15,
        0.53,
        Math.sin(a0) * 2.15,
        0.08,
        0.02,
        3.75,
        -a0 + Math.PI / 2 + Math.PI / 6,
      ),
    );
  }
  yl.add(
    disk,
    rim,
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.gold, star, false),
  );
  const basin = mesh(
    new THREE.TorusGeometry(1.7, 0.42, 12, 40),
    MAT.black,
    0,
    0.9,
    0,
  );
  basin.rotation.x = Math.PI / 2;
  basin.scale.z = 1.4;
  const dome = mesh(
    new THREE.SphereGeometry(1.1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    MAT.silver,
    0,
    0.62,
    0,
  );
  yl.add(
    basin,
    tcyl(1.7, 1.7, 0.1, 32, MAT.pondWater, 0, 0.95, 0),
    dome,
    mesh(new THREE.TorusGeometry(0.9, 0.12, 6, 24), MAT.pad, 0, 1.2, 0, false),
  );
  yl.children[yl.children.length - 1].rotation.x = Math.PI / 2;
  yl.add(
    columns(
      [
        [-5.6, -5.6],
        [5.6, -5.6],
        [-5.6, 5.6],
        [5.6, 5.6],
        [0, -5.6],
        [0, 5.6],
        [-5.6, 0],
        [5.6, 0],
      ],
      0.5,
      3.4,
      0.22,
      MAT.darkStone,
      true,
    ),
  );
  const yr = new THREE.Group();
  asRoof(yr);
  yl.add(yr);
  const slats = [];
  for (let x = -5.8; x <= 5.8; x += 0.5)
    slats.push(M(x, 4.0, 0, 0.12, 0.08, 12));
  yr.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.wood, slats, false));
  const pyr = mesh(new THREE.ConeGeometry(9.6, 2.6, 4), MAT.salmon, 0, 5.4, 0);
  pyr.rotation.y = Math.PI / 4;
  yr.add(
    tbox(13.4, 0.3, 13.4, MAT.salmon, 0, 4.15, 0),
    pyr,
    mesh(new THREE.SphereGeometry(0.35, 10, 8), MAT.gold, 0, 6.8, 0),
  );
  yl.add(
    glowPoints(
      [
        [-3, 0.9, 3],
        [3, 0.9, 3],
        [-3, 0.9, -3],
        [3, 0.9, -3],
      ],
      2.5,
    ),
  );
  // 半身像四周的一圈黑色铁栏杆（照片里很明显）
  const fence = [];
  for (let i = 0; i < 160; i++) {
    const a0 = (i / 160) * Math.PI * 2;
    fence.push(
      M(Math.cos(a0) * 26, 1.55, Math.sin(a0) * 15.5, 0.06, 1.3, 0.06),
    );
  }
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.black, fence, false));
  const fr = mesh(
    new THREE.TorusGeometry(1, 0.03, 4, 120),
    MAT.black,
    0,
    2.15,
    0,
    false,
  );
  fr.rotation.x = Math.PI / 2;
  fr.scale.set(26, 15.5, 1);
  g.add(fr);
  g.add(yl, pointLight(0xffb070, 1500, 220, 0, 9, 44));
  const tri = [];
  for (let i = 0; i < 9; i++)
    for (const sx of [-1, 1]) tri.push([sx * (9 + i * 4.6), 46]);
  for (const [x, z] of tri) {
    const t = trishul(2.6);
    t.position.set(x, 0.16, z);
    g.add(t);
  }
  const row = [];
  for (let i = 0; i < 9; i++)
    for (const sx of [-1, 1]) row.push([sx * 30, 0.9, 30 + i * 12]);
  g.add(
    glowPoints(row, 4),
    instanced(
      new THREE.CylinderGeometry(0.3, 0.4, 0.8, 8),
      MAT.darkStone,
      row.map(([x, , z]) => M(x, 0.4, z)),
    ),
  );
  // 人群（可在「行人」里关掉）：广场上朝着像站着、坐着的人，越靠前越密；Yogeshwar Linga 四周一圈献水的人
  const ppl = [];
  for (let tries = 0; ppl.length < 230 && tries < 4000; tries++) {
    const z = 48 + Math.pow(PR(), 1.6) * 80,
      x = pr(-50, 50);
    if (
      Math.abs(Math.abs(x) - 30) < 1.2 ||
      (Math.abs(x) > 52 && Math.abs(z - 44) < 3)
    )
      continue;
    const ry = Math.PI + Math.atan2(x, z) * 0.6 + pr(-0.35, 0.35);
    ppl.push(folk(x, 0.16, z, ry, PR() < 0.22 ? 'c' : 's'));
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + pr(-0.1, 0.1),
      rad = pr(2.7, 3.3);
    ppl.push(
      folk(Math.sin(a) * rad, 0.5, 33 + Math.cos(a) * rad, a + Math.PI, 's'),
    );
  }
  g.add(crowd(ppl));
  return g;
}

// —— Dhyanalinga：赭红泥灰的砖穹顶（直径 76 ft ≈ 23.2 m、高 33 ft ≈ 10 m），坐在 6 ft 高的石鼓墙上；入口朝东 ——
// 由外到内（局部 +Z 向东）：万教柱下沉院 → 石门 thorana → 三级高台阶 → 内绕行廊（Patanjali / Vanashree / 六块浮雕）→ 石拱隧道 → 殿内
function createDhyanalinga() {
  const g = new THREE.Group(),
    R = 11.6,
    DR = 1.85,
    RISE = 8.2;
  const lawn = tcyl(27, 27, 0.1, 48, MAT.lawn, 0, 0.05, 0);
  lawn.castShadow = false;
  g.add(lawn); // 航拍：穹顶西、南两侧是草坪，东侧入口一带是石板地
  const ring = mesh(
    new THREE.RingGeometry(R + 2.2, R + 5, 64).rotateX(-Math.PI / 2),
    MAT.paving,
    0,
    0.12,
    0,
    false,
  );
  g.add(ring); // 外绕行道
  // 石鼓墙（空心）+ 石过梁圈 + 28 个三角形石通风口
  g.add(
    tube(R + 0.5, R - 0.45, DR - 0.6, 64, MAT.graniteDS, 0),
    tube(R + 0.62, R - 0.45, 0.6, 64, MAT.graniteDS, DR - 0.6),
  );
  const ventGeo = new THREE.CylinderGeometry(0.48, 0.48, 1.3, 3);
  ventGeo.rotateX(-Math.PI / 2);
  const vents = [],
    cells = [],
    lamps = [];
  for (let i = 0; i < 28; i++) {
    const a = ((i + 0.5) * Math.PI * 2) / 28,
      s = Math.sin(a),
      c = Math.cos(a);
    if (i !== 0 && i !== 27) {
      vents.push(M(s * (R - 0.05), DR + 0.42, c * (R - 0.05), 1, 1, 1, a));
      cells.push(M(s * (R - 0.62), 0.8, c * (R - 0.62), 1.25, 1.25, 0.5, a));
    }
    for (const da of [-0.056, 0.056])
      lamps.push([
        Math.sin(a + da) * (R + 0.85),
        DR + 0.12,
        Math.cos(a + da) * (R + 0.85),
      ]);
  }
  g.add(
    instanced(ventGeo, MAT.black, vents, false),
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.black, cells, false),
    glowPoints(lamps, 1.6, 0xffa850),
  );
  // 穹顶外壳（泥灰）+ 内壳（裸砖），顶上是镀金的林伽形铜顶
  const shell = new THREE.SphereGeometry(
    R,
    64,
    24,
    0,
    Math.PI * 2,
    0,
    Math.PI / 2,
  );
  const dome = asRoof(mesh(scaleUV(shell.clone(), 10, 3), MAT.mud, 0, DR, 0));
  dome.scale.y = RISE / R;
  const inner = asRoof(
    mesh(scaleUV(shell.clone(), 30, 9), MAT.brickIn, 0, DR, 0, false),
  );
  inner.scale.set(0.975, (RISE / R) * 0.97, 0.975);
  const top = DR + RISE;
  g.add(
    dome,
    inner,
    asRoof(tcyl(0.9, 1.1, 0.5, 20, MAT.granite, 0, top + 0.1, 0)),
    asRoof(
      mesh(
        new THREE.CapsuleGeometry(0.42, 0.55, 6, 14),
        MAT.gold,
        0,
        top + 0.95,
        0,
      ),
    ),
  );
  // —— 殿内 ——
  const floor = tcyl(R - 0.45, R - 0.45, 0.12, 48, MAT.darkStone, 0, 0.14, 0);
  floor.castShadow = false;
  g.add(floor);
  const L = new THREE.Group();
  L.position.y = 0.2;
  g.add(L);
  // jalaseema：方形水池，花岗岩边框上一圈铜灯
  for (const [w, d, x, z] of [
    [9.6, 0.55, 0, 4.55],
    [9.6, 0.55, 0, -4.55],
    [0.55, 8.6, 4.55, 0],
    [0.55, 8.6, -4.55, 0],
  ])
    L.add(tbox(w, 0.3, d, MAT.granite, x, 0.15, z));
  const water = mesh(
    new THREE.PlaneGeometry(8.6, 8.6).rotateX(-Math.PI / 2),
    MAT.pondWater,
    0,
    0.2,
    0,
    false,
  );
  L.add(water, tbox(5.4, 0.42, 5.4, MAT.avud, 0, 0.21, 0));
  const brass = [],
    bl = [];
  for (let i = 0; i < 6; i++)
    for (const s of [-1, 1]) {
      brass.push(
        M(s * 4.55, 0.4, -3.6 + i * 1.44),
        M(-3.6 + i * 1.44, 0.4, s * 4.55),
      );
      bl.push(
        [s * 4.55, 0.62, -3.6 + i * 1.44],
        [-3.6 + i * 1.44, 0.62, s * 4.55],
      );
    }
  L.add(
    instanced(new THREE.SphereGeometry(0.16, 8, 6), MAT.gold, brass, false),
    glowPoints(bl, 1.3, 0xffb060),
  );
  // avudaiyar：七圈盘蛇（棕色石），蛇头朝东伸出、带出水口
  const AV = 0.42;
  L.add(tcyl(2.25, 2.35, 1.5, 36, MAT.avud, 0, AV + 0.75, 0));
  for (let i = 0; i < 7; i++) {
    const t = mesh(
      new THREE.TorusGeometry(2.42 + (i === 6 ? 0.06 : 0), 0.125, 8, 48),
      MAT.avud,
      0,
      AV + 0.13 + i * 0.215,
      0,
    );
    t.rotation.x = Math.PI / 2;
    L.add(t);
  }
  const lip = mesh(
    new THREE.TorusGeometry(2.2, 0.16, 8, 48),
    MAT.avud,
    0,
    AV + 1.56,
    0,
  );
  lip.rotation.x = Math.PI / 2;
  L.add(lip);
  const neck = mesh(
    new THREE.SphereGeometry(1, 14, 10),
    MAT.avud,
    0,
    AV + 1.2,
    2.5,
  );
  neck.scale.set(0.7, 0.36, 1.1);
  neck.rotation.x = 0.35;
  const head = mesh(
    new THREE.SphereGeometry(1, 14, 10),
    MAT.avud,
    0,
    AV + 0.75,
    3.25,
  );
  head.scale.set(0.5, 0.4, 0.62);
  L.add(
    neck,
    head,
    mesh(
      new THREE.CylinderGeometry(0.07, 0.1, 0.4, 8).rotateX(Math.PI / 2),
      MAT.gold,
      0,
      AV + 0.6,
      3.85,
    ),
  );
  // 林伽：黑色、通高 13 ft 9 in（≈4.2 m），七道等距铜环 = 七个脉轮；腰间系白布
  const LY = AV + 1.5,
    lg = mesh(
      new THREE.CapsuleGeometry(0.78, 2.55, 8, 28),
      MAT.black,
      0,
      LY + 1.27,
      0,
    );
  L.add(lg);
  for (let i = 0; i < 7; i++) {
    const b = mesh(
      new THREE.TorusGeometry(0.785, 0.024, 6, 40),
      MAT.copper,
      0,
      LY + 0.3 + i * 0.36,
      0,
      false,
    );
    b.rotation.x = Math.PI / 2;
    L.add(b);
  }
  const band = mesh(
    new THREE.TorusGeometry(0.8, 0.05, 6, 32),
    MAT.white,
    0,
    LY + 0.92,
    0,
    false,
  );
  band.rotation.x = Math.PI / 2;
  band.scale.z = 2.4;
  L.add(band, tbox(0.2, 0.85, 0.03, MAT.white, 0, LY + 0.5, 0.81));
  const garland = [
    new V3(-0.9, LY + 0.05, 0.1),
    new V3(-0.9, LY + 2.5, 0.05),
    new V3(-0.6, LY + 3.25, 0),
    new V3(0, LY + 3.52, 0),
    new V3(0.6, LY + 3.25, 0),
    new V3(0.9, LY + 2.5, 0.05),
    new V3(0.9, LY + 0.05, 0.1),
  ];
  L.add(
    mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(garland), 40, 0.085, 6),
      MAT.pad,
    ),
  );
  // 林伽正上方悬着的镀金铜半球，水从这里滴落
  g.add(
    mesh(
      new THREE.SphereGeometry(0.95, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      MAT.gold,
      0,
      7.6,
      0,
    ),
    tcyl(0.03, 0.03, 1.6, 6, MAT.gold, 0, 9.1, 0),
  );
  const fl = [];
  for (let i = 0; i < 28; i++) {
    const a = ((i + 0.5) * Math.PI * 2) / 28;
    fl.push([Math.sin(a) * (R - 1.3), 0.45, Math.cos(a) * (R - 1.3)]);
  }
  const il = new THREE.PointLight(0xffb070, 30, 14, 1.2);
  il.position.set(0, 5.6, 2.5); // 殿内常亮的暖光（不随时段变化）
  g.add(
    glowPoints(fl, 1.4, 0xffa850),
    pointLight(0xffa050, 90, 34, 0, 4.5, 3),
    il,
  );
  // 殿内静坐的人：靠墙 aura cell 前一圈，林伽水池外一圈，都面朝林伽（入口通道留空）
  const med = [];
  for (let i = 1; i < 27; i++) {
    const a = ((i + 0.5) * Math.PI * 2) / 28;
    if (hash(i, 7) < 0.8)
      med.push(
        folk(
          Math.sin(a) * (R - 1.7),
          0.2,
          Math.cos(a) * (R - 1.7),
          a + Math.PI,
          'c',
          0.45,
          0.6,
        ),
      );
  }
  for (let i = 0; i < 22; i++) {
    const a = ((i + 0.5) * Math.PI * 2) / 22 + pr(-0.05, 0.05),
      rad = pr(6.3, 7.6);
    if (Math.abs(Math.sin(a / 2)) > 0.18)
      med.push(
        folk(
          Math.sin(a) * rad,
          0.2,
          Math.cos(a) * rad,
          a + Math.PI,
          'c',
          0.45,
          0.6,
        ),
      );
  }
  g.add(crowd(med));
  // —— 石拱隧道（宽 2.9 m、高 2.4 m），拱上是七头蛇 ——
  const TZ = R + 2.6,
    TL = 6.4;
  for (const sx of [-1, 1])
    g.add(tbox(0.8, 1.7, TL, MAT.granite, sx * 1.85, 0.85, TZ));
  const vg = new THREE.CylinderGeometry(
    2.25,
    2.25,
    TL,
    18,
    1,
    true,
    Math.PI / 2,
    Math.PI,
  );
  vg.rotateX(Math.PI / 2);
  scaleUV(vg, 2, 2);
  g.add(
    mesh(vg, MAT.graniteDS, 0, 1.7, TZ),
    tbox(3, 0.12, TL, MAT.granite, 0, 0.1, TZ),
    mesh(
      new THREE.ShapeGeometry(archShape(2.9, 3.1)),
      MAT.doorGlow,
      0,
      0.1,
      R + 0.7,
      false,
    ),
  );
  const hoods = [];
  for (let i = -3; i <= 3; i++)
    hoods.push(
      M(
        i * 0.36,
        4.35 - Math.abs(i) * 0.12,
        TZ + TL / 2 - 0.2,
        0.3,
        0.52,
        0.14,
        0,
        0,
        -i * 0.16,
      ),
    );
  g.add(
    instanced(new THREE.SphereGeometry(1, 10, 8), MAT.darkStone, hoods),
    tbox(2.6, 0.5, 0.5, MAT.darkStone, 0, 3.75, TZ + TL / 2 - 0.2),
  );
  // —— 内绕行廊：中间露天石板路，两侧石柱托梁的带顶侧廊，外侧红砖墙 ——
  const Z0 = 20,
    Z1 = 40,
    zc = (Z0 + Z1) / 2,
    PL = Z1 - Z0;
  g.add(tbox(4.6, 0.2, PL + 4, MAT.granite, 0, 0.1, zc - 1));
  const piers = [];
  for (let i = 0; i < 7; i++)
    for (const sx of [-1, 1])
      piers.push([sx * 2.85, Z0 + 0.6 + (i * (PL - 1.2)) / 6]);
  g.add(stoneColumns(piers, 0.5, 3.9, 0.4, MAT.concrete, MAT.granite));
  for (const sx of [-1, 1]) {
    g.add(
      tbox(7.4, 0.5, PL, MAT.granite, sx * 6.1, 0.25, zc),
      tbox(0.9, 0.55, PL + 0.6, MAT.granite, sx * 2.85, 4.67, zc),
      tbox(0.5, 4.6, PL, MAT.brick, sx * 9.9, 2.3, zc),
      tbox(7.6, 4.6, 0.5, MAT.brick, sx * 6.3, 2.3, Z0 - 0.25),
    );
    g.add(
      asRoof(tbox(8.6, 0.3, PL + 1, MAT.wood, sx * 6.2, 5.1, zc)),
      asRoof(tbox(9, 0.2, PL + 1.4, MAT.darkStone, sx * 6.2, 5.35, zc)),
    );
    // 三块花岗岩浮雕（六位南印度圣者的故事）
    for (const z of [22.6, 27.2, 31.8]) {
      const p = new THREE.Group();
      p.position.set(sx * 9.6, 2.5, z);
      p.rotation.y = (-sx * Math.PI) / 2;
      const figs = [];
      for (let k = 0; k < 4; k++) {
        figs.push(
          new THREE.CapsuleGeometry(0.2, 0.75, 4, 8).translate(
            -1.2 + k * 0.8,
            -0.1 + (k % 2) * 0.12,
            0.08,
          ),
          new THREE.SphereGeometry(0.19, 8, 6).translate(
            -1.2 + k * 0.8,
            0.72 + (k % 2) * 0.12,
            0.1,
          ),
        );
      }
      p.add(
        tbox(3.7, 2.3, 0.14, MAT.granite),
        mesh(mergeGeos(figs), MAT.concrete, 0, 0, 0, false),
        tbox(3.9, 0.12, 0.2, MAT.pad, 0, 1.2, 0.04),
      );
      g.add(p);
    }
    // 龛：白石雕柱 + 过梁，两侧木格栅
    const sh = new THREE.Group();
    sh.position.set(sx * 9.55, 0.5, 36.4);
    sh.rotation.y = (-sx * Math.PI) / 2;
    sh.add(
      tbox(0.55, 3.5, 0.55, MAT.white, -1.75, 1.75, 0.5),
      tbox(0.55, 3.5, 0.55, MAT.white, 1.75, 1.75, 0.5),
      tbox(4.5, 0.5, 0.8, MAT.white, 0, 3.75, 0.5),
      tbox(4.9, 0.25, 1, MAT.white, 0, 4.1, 0.5),
      tbox(1.5, 2.6, 0.08, MAT.jali, -2.85, 1.9, 0.1),
      tbox(1.5, 2.6, 0.08, MAT.jali, 2.85, 1.9, 0.1),
    );
    if (sx < 0) {
      // 左：Patanjali，11 ft 黑石像，立在下沉的龛里，下半身为蛇、头顶蛇兜
      const pt = new THREE.Group();
      pt.position.set(0, -0.3, 0.9);
      for (let i = 0; i < 3; i++) {
        const c = mesh(
          new THREE.TorusGeometry(0.62 - i * 0.12, 0.2, 8, 20),
          MAT.black,
          0,
          0.2 + i * 0.36,
          0,
        );
        c.rotation.x = Math.PI / 2;
        pt.add(c);
      }
      const hd = mesh(
        new THREE.SphereGeometry(1, 12, 10),
        MAT.black,
        0,
        3.05,
        -0.22,
      );
      hd.scale.set(0.85, 0.95, 0.22);
      pt.add(
        mesh(new THREE.CapsuleGeometry(0.4, 1.1, 6, 12), MAT.black, 0, 1.75, 0),
        mesh(new THREE.SphereGeometry(0.3, 12, 10), MAT.black, 0, 2.75, 0.02),
        hd,
        mesh(
          new THREE.SphereGeometry(1, 8, 6).scale(0.42, 0.16, 0.16),
          MAT.black,
          0,
          1.95,
          0.4,
        ),
        tbox(1.9, 0.3, 1.9, MAT.darkStone, 0, -0.15, 0),
      );
      const gar = mesh(
        new THREE.TorusGeometry(0.5, 0.045, 6, 20),
        MAT.lotusW,
        0,
        1.8,
        0.2,
        false,
      );
      gar.scale.y = 1.6;
      gar.rotation.x = -0.25;
      pt.add(gar);
      sh.add(
        pt,
        tbox(2.9, 3.3, 0.2, MAT.brick, 0, 1.65, -0.12),
        glowPoints(
          [
            [-1, 0.2, 1.6],
            [1, 0.2, 1.6],
            [0, 0.2, 2],
          ],
          1.6,
        ),
      );
    } else {
      // 右：Vanashree，绿花岗岩的菩提树浮雕，中心一片金叶，龛位抬高
      const tree = mesh(
        new THREE.IcosahedronGeometry(1, 1),
        MAT.greenStone,
        0,
        2.45,
        0.2,
      );
      tree.scale.set(1.25, 0.85, 0.16);
      const leaf = mesh(
        new THREE.SphereGeometry(0.2, 4, 2),
        MAT.gold,
        0,
        2.35,
        0.4,
        false,
      );
      leaf.scale.set(0.8, 1.2, 0.3);
      sh.add(
        tbox(3, 1.0, 1.4, MAT.granite, 0, 0.5, 0.6),
        tbox(2.9, 2.5, 0.25, MAT.greenStone, 0, 2.2, 0.05),
        tree,
        tcyl(0.1, 0.16, 1, 6, MAT.greenStone, 0, 1.5, 0.2),
        leaf,
        glowPoints([[0, 1.25, 1]], 1.8),
      );
    }
    g.add(sh);
  }
  g.add(stairs(4.6, 3, 0.34, 0.5, MAT.granite, 0, 1.12, Z1 + 1.5, -1, 0)); // 三级高台阶：Tamas / Rajas / Sattva
  // —— 石门 thorana + 万教柱下沉院（三面深色石墙围合，像张开的双臂）——
  const ZT = 43;
  g.add(tbox(6, 1.1, 3, MAT.granite, 0, 0.55, ZT));
  for (const sx of [-1, 1]) {
    g.add(
      tbox(0.85, 4.1, 1.1, MAT.granite, sx * 1.85, 3.15, ZT),
      tbox(1.15, 0.4, 1.4, MAT.granite, sx * 1.85, 5.2, ZT),
      tbox(4.9, 4.6, 1.2, MAT.darkStone, sx * 4.75, 2.3, ZT + 0.2),
    );
    const door = tbox(1.35, 3.3, 0.12, MAT.wood, sx * 1.4, 2.75, ZT - 0.9);
    door.rotation.y = sx * 1.15;
    g.add(door);
    [
      [3.4, 4.2],
      [3.4, 3.0],
      [3.4, 1.9],
    ].forEach(([len, h], i) =>
      g.add(
        tbox(1.5, h, len, MAT.darkStone, sx * 7.6, h / 2, ZT + 2.3 + i * 3.4),
      ),
    );
  }
  g.add(
    tbox(5.6, 0.75, 1.3, MAT.granite, 0, 5.75, ZT),
    tbox(6.3, 0.3, 1.6, MAT.granite, 0, 6.25, ZT),
    mesh(
      new THREE.SphereGeometry(0.42, 10, 8),
      MAT.granite,
      0,
      5.75,
      ZT + 0.65,
    ),
    stairs(3.4, 3, 0.34, 0.5, MAT.granite, 0, 1.1, ZT + 1.5, 1, 0),
  );
  const court = tbox(13.8, 0.14, 12, MAT.paving, 0, 0.08, ZT + 7);
  court.castShadow = false;
  g.add(court);
  // Sarva Dharma Sthamba：17 ft（≈5.2 m）白色花岗岩整石，顶部石雕旭日；背面刻七脉轮
  const st = new THREE.Group();
  st.position.set(0, 0.15, ZT + 5.2);
  st.add(
    tbox(2.4, 0.4, 1.3, MAT.granite, 0, 0.2, 0),
    tbox(1.45, 4.5, 0.55, MAT.white, 0, 2.65, 0),
  );
  const sunD = mesh(
    new THREE.CylinderGeometry(0.72, 0.72, 0.5, 24, 1, false, 0, Math.PI)
      .rotateX(Math.PI / 2)
      .rotateZ(Math.PI / 2),
    MAT.white,
    0,
    4.9,
    0,
  );
  st.add(sunD);
  const rays = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i * Math.PI) / 8;
    rays.push(
      M(
        Math.cos(a) * 0.95,
        4.9 + Math.sin(a) * 0.95,
        0,
        1,
        1,
        1,
        0,
        0,
        a - Math.PI / 2,
      ),
    );
  }
  st.add(
    instanced(new THREE.ConeGeometry(0.11, 0.42, 4), MAT.white, rays, false),
  );
  for (let i = 0; i < 7; i++)
    st.add(
      mesh(
        new THREE.CylinderGeometry(0.2, 0.2, 0.04, 12).rotateX(Math.PI / 2),
        MAT.sandstone,
        0,
        0.9 + i * 0.55,
        -0.29,
        false,
      ),
    );
  for (let i = 0; i < 3; i++)
    st.add(
      mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.04, 12).rotateX(Math.PI / 2),
        MAT.sandstone,
        0,
        1.4 + i * 1.2,
        0.29,
        false,
      ),
    );
  g.add(
    st,
    glowPoints(
      [
        [-5, 0.5, ZT + 3],
        [5, 0.5, ZT + 3],
        [-5, 0.5, ZT + 9],
        [5, 0.5, ZT + 9],
      ],
      2.5,
    ),
  );
  // 入口两翼：白色平顶的长屋（各约 27 × 9 m），朝东一侧是柱廊
  for (const sx of [-1, 1]) {
    const w = house(26, 8, 3.6, {
      roof: 'flat',
      wall: MAT.white,
      veranda: 2.4,
      plinth: 0.5,
      win: 6,
      colMat: MAT.concrete,
      roofMat: MAT.concrete,
    });
    w.position.set(sx * 21.5, 0, ZT + 2.5);
    g.add(w);
  }
  // 穹顶背后（西南）的 Trimurti 整石浮雕：Rudra / Hara / Sadashiva 三张面孔
  const tm = new THREE.Group();
  tm.position.set(-7, 0, -R - 8.5);
  tm.rotation.y = Math.PI + 0.55;
  tm.add(
    tbox(7.4, 4.6, 0.8, MAT.sandstone, 0, 2.3, 0),
    tbox(8, 0.4, 1.4, MAT.granite, 0, 0.2, 0.2),
  );
  for (const x of [-2.3, 0, 2.3]) {
    const f = mesh(
      new THREE.SphereGeometry(1, 14, 12),
      MAT.sandstone,
      x,
      2.1,
      0.42,
    );
    f.scale.set(0.92, 1.25, 0.42);
    const cr = mesh(
      new THREE.ConeGeometry(0.75, 1.3, 10),
      MAT.sandstone,
      x,
      3.75,
      0.36,
    );
    cr.scale.z = 0.4;
    tm.add(
      f,
      cr,
      mesh(
        new THREE.SphereGeometry(0.16, 8, 6).scale(1, 2.2, 1),
        MAT.sandstone,
        x,
        1.95,
        0.84,
      ),
    );
  }
  const tl = [];
  for (let i = 0; i < 9; i++) tl.push([-3.6 + i * 0.9, 0.55, 0.95]);
  tm.add(glowPoints(tl, 1.6));
  g.add(tm);
  return g;
}

// —— Nandi：约 15 ft 高的黑色公牛，面向 Dhyanalinga 卧着：头颈高昂、肩上有峰、新月形的角，一条前腿屈膝踏地，颈间一串铜铃垂到胸前 ——
function createNandi() {
  const g = new THREE.Group(),
    B = new THREE.MeshStandardMaterial({
      color: 0x25262c,
      roughness: 0.42,
      metalness: 0.5,
    });
  const base = tcyl(8.2, 8.2, 0.2, 48, MAT.paving, 0, 0.1, 0);
  base.castShadow = false;
  g.add(base, tcyl(5.6, 5.8, 0.25, 40, MAT.granite, 0, 0.32, 0));
  // 围栏：黑色短柱 + 一圈绳
  const bol = [];
  for (let i = 0; i < 12; i++)
    bol.push([
      Math.cos((i * Math.PI) / 6 + 0.26) * 6.6,
      Math.sin((i * Math.PI) / 6 + 0.26) * 6.6,
    ]);
  const rope = mesh(
    new THREE.TorusGeometry(6.6, 0.03, 4, 60),
    MAT.straw,
    0,
    0.95,
    0,
    false,
  );
  rope.rotation.x = Math.PI / 2;
  g.add(columns(bol, 0.2, 0.95, 0.13, MAT.black, true), rope);
  const n = new THREE.Group();
  n.position.y = 0.45;
  n.scale.setScalar(0.8);
  g.add(n);
  const blob = (sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = mesh(new THREE.SphereGeometry(1, 24, 18), B, x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.set(rx, ry, rz);
    n.add(m);
    return m;
  };
  const limb = (a, b, r) => {
    const d = new V3(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
      m = mesh(
        new THREE.CapsuleGeometry(r, d.length(), 6, 14),
        B,
        (a[0] + b[0]) / 2,
        (a[1] + b[1]) / 2,
        (a[2] + b[2]) / 2,
      );
    m.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.normalize());
    n.add(m);
    return m;
  };
  // 躯干：腹、臀、胸、肩峰
  blob(1.8, 1.5, 3.4, 0, 1.6, -1.0);
  blob(1.75, 1.45, 1.6, 0, 1.5, -2.7);
  blob(1.5, 1.75, 1.5, 0, 2.0, 1.4);
  blob(1.0, 0.95, 1.25, 0, 3.55, 0.45);
  // 颈（粗壮、前倾）、垂皮、头、吻部、额
  limb([0, 2.5, 1.6], [0, 4.25, 3.05], 1.12);
  blob(0.36, 1.45, 1.05, 0, 2.9, 3.3, -0.45);
  blob(0.32, 1.0, 0.75, 0, 1.8, 2.8, -0.1);
  blob(0.92, 0.95, 1.45, 0, 4.95, 3.9, 0.2);
  blob(0.68, 0.6, 0.78, 0, 4.55, 5.05, 0.15);
  blob(0.72, 0.22, 0.32, 0, 4.3, 5.55);
  blob(1.0, 0.46, 0.58, 0, 5.6, 3.25);
  for (const sx of [-1, 1]) {
    blob(0.24, 0.16, 0.3, sx * 0.4, 5.15, 4.7); // 眉骨
    blob(0.7, 0.19, 0.34, sx * 1.38, 5.15, 3.15, 0, sx * -0.35, sx * 0.2); // 耳
    const horn = taperTube(
      [
        [sx * 0.65, 5.7, 3.25],
        [sx * 1.3, 6.2, 3.15],
        [sx * 1.52, 7.0, 3.05],
        [sx * 1.22, 7.7, 2.98],
        [sx * 0.78, 8.1, 2.95],
      ],
      0.34,
      0.05,
      B,
    );
    n.add(horn);
    blob(0.1, 0.07, 0.07, sx * 0.32, 4.45, 5.72); // 鼻孔
    // 后腿：侧卧的大腿、贴地前伸的小腿与蹄
    blob(0.85, 1.25, 1.55, sx * 1.45, 1.3, -2.3);
    limb([sx * 1.85, 0.42, -1.9], [sx * 1.95, 0.4, -0.2], 0.36);
    blob(0.4, 0.3, 0.5, sx * 1.95, 0.32, 0.25);
  }
  // 前腿：牠的左腿屈膝踏地（随时要起身的样子），右腿折在身下
  limb([1.2, 1.9, 1.7], [1.55, 2.35, 3.45], 0.52);
  limb([1.55, 2.3, 3.5], [1.6, 0.5, 3.95], 0.36);
  blob(0.46, 0.3, 0.56, 1.6, 0.3, 4.1);
  blob(0.5, 0.5, 0.5, 1.55, 2.35, 3.5);
  limb([-1.25, 0.5, 1.7], [-1.3, 0.5, 3.3], 0.42);
  blob(0.5, 0.46, 0.5, -1.3, 0.55, 3.5);
  limb([-1.3, 0.45, 3.4], [-1.0, 0.36, 2.3], 0.3);
  // 尾巴：从臀后绕到身侧
  n.add(
    taperTube(
      [
        [0, 2.5, -4.1],
        [-0.5, 1.6, -4.35],
        [-1.5, 0.6, -3.9],
        [-2.2, 0.4, -2.8],
        [-2.35, 0.4, -1.9],
      ],
      0.2,
      0.09,
      B,
    ),
  );
  blob(0.2, 0.2, 0.42, -2.35, 0.42, -1.6);
  // 颈间的铜铃串：绕颈一圈，前面垂到胸口
  const gp = [],
    bells = [];
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * Math.PI * 2,
      c = Math.cos(a),
      s = Math.sin(a);
    const f = (1 + c) / 2;
    gp.push(new V3(s * (1.3 + f * 0.25), 3.75 - f * 2.3, 1.25 + f * 2.4));
  }
  const cv = new THREE.CatmullRomCurve3(gp, true);
  n.add(mesh(new THREE.TubeGeometry(cv, 80, 0.06, 6, true), MAT.straw));
  for (let i = 0; i < 26; i++) {
    const t = 0.5 + ((i - 12.5) / 26) * 0.62,
      p = cv.getPointAt(((t % 1) + 1) % 1);
    if (p.y < 3.2) bells.push(M(p.x, p.y - 0.14, p.z + 0.08, 1, 1, 1));
  }
  n.add(
    instanced(new THREE.ConeGeometry(0.11, 0.24, 8), MAT.gold, bells, false),
  );
  // 夜里绕着牛的一圈油灯
  const lamps = [];
  for (let i = 0; i < 36; i++)
    lamps.push([
      Math.cos((i * Math.PI) / 18) * 7.4,
      0.35,
      Math.sin((i * Math.PI) / 18) * 7.4,
    ]);
  g.add(
    glowPoints(lamps, 1.5, 0xffa850),
    tcyl(0.5, 0.3, 0.3, 14, MAT.darkStone, 0, 0.35, 7.2),
  );
  return g;
}

// —— Linga Bhairavi：倒三角形的殿墙（象征子宫），殿内尽端的小三角是神龛；正面朝东北，对着 Dhyanalinga ——
// 局部坐标：三角底边在 z=0（宽 23 m），顶点在 z=-24；前面 z=0..15 是 15×15 m 的平顶前殿
function createLingaBhairavi() {
  const g = new THREE.Group(),
    Y = 0.6,
    HW = 11.5,
    LEN = 24,
    H = 6.2;
  const HOLE = [-2.7, 2.7, -11.2, -15.9]; // Devi 前的下沉小坑
  g.add(
    triSlabHole(HW + 1.2, LEN + 2.4, Y, MAT.granite, 0, HOLE),
    tbox(17, Y, 16, MAT.granite, 0, Y / 2, 8),
  );
  const fl = triSlabHole(HW - 0.4, LEN - 0.8, 0.06, MAT.darkStone, Y, HOLE);
  fl.castShadow = false;
  g.add(fl);
  // Devi 前方下沉的小坑：从殿内地面走四级台阶下去，坑边一圈黄铜立柱和红绳
  const SK = new THREE.Group();
  SK.position.y = Y + 0.07;
  g.add(SK);
  const pitF = tbox(5.4, 0.12, 4.6, MAT.darkStone, 0, -1.02, -13.6);
  pitF.castShadow = false;
  SK.add(pitF);
  for (const sx of [-1, 1])
    SK.add(tbox(0.3, 1.08, 4.6, MAT.darkStone, sx * 2.85, -0.5, -13.6));
  SK.add(
    tbox(6.0, 1.08, 0.3, MAT.darkStone, 0, -0.5, -16.05),
    stairs(5.4, 4, 0.25, 0.42, MAT.granite, 0, 0, -11.3, -1, -1.0),
  );
  const rp = [];
  for (const x of [-2.6, -1.3, 1.3, 2.6])
    rp.push(M(x, 0.45, -11.2, 0.07, 0.9, 0.07));
  for (const z of [-12.3, -13.6, -14.9])
    for (const sx of [-1, 1]) rp.push(M(sx * 2.9, 0.45, z, 0.07, 0.9, 0.07));
  SK.add(
    instanced(new THREE.CylinderGeometry(1, 1, 1, 8), MAT.gold, rp, false),
    tbox(5.4, 0.04, 0.04, MAT.red, 0, 0.82, -11.2),
    tbox(0.04, 0.04, 3.8, MAT.red, -2.9, 0.82, -13.6),
    tbox(0.04, 0.04, 3.8, MAT.red, 2.9, 0.82, -13.6),
  );
  // 两道斜墙：下段白墙、上段红砖；内侧挂红 / 绿纱丽幔
  const wl = Math.hypot(HW, LEN);
  for (const sx of [-1, 1]) {
    const ry = Math.atan2(LEN, -sx * HW),
      w = new THREE.Group();
    w.position.set((sx * HW) / 2, Y, -LEN / 2);
    w.rotation.y = ry;
    w.add(
      tbox(wl, 3.6, 0.6, MAT.white, 0, 1.8, 0),
      tbox(wl, H - 3.6, 0.6, MAT.brick, 0, 3.6 + (H - 3.6) / 2, 0),
      tbox(wl + 0.4, 0.3, 0.9, MAT.granite, 0, H + 0.15, 0),
    );
    const inz = sx * -0.36,
      sari = sx < 0 ? MAT.sariRed : MAT.sariGreen;
    w.add(
      mesh(new THREE.PlaneGeometry(11, 2.3), sari, 0, 2.05, inz, false),
      mesh(
        new THREE.PlaneGeometry(11, 0.14),
        MAT.goldTrim,
        0,
        0.95,
        inz * 1.03,
        false,
      ),
      mesh(
        new THREE.PlaneGeometry(11, 0.14),
        MAT.goldTrim,
        0,
        3.15,
        inz * 1.03,
        false,
      ),
    );
    const dots = [];
    for (let i = 0; i < 9; i++) dots.push([-4 + i, 4.2 + (i % 3) * 0.45, inz]);
    w.add(glowPoints(dots, 0.9, 0xfff0d0));
    g.add(w);
    g.add(
      tbox(HW - 3.2, H, 0.6, MAT.white, (sx * (HW + 3.2)) / 2, Y + H / 2, -0.1),
    ); // 正面墙（中间留 6.4 m 宽的门洞）
  }
  g.add(tbox(6.4, 1.3, 0.6, MAT.brick, 0, Y + H - 0.65, -0.1));
  // 屋面：三角形楼板，中间是镂空石花窗的三角天窗
  const roof = new THREE.Group();
  asRoof(roof);
  roof.add(triSlab(HW + 0.6, LEN + 1.2, 0.35, MAT.concrete, Y + H + 0.3, 0.5));
  const sky = triSlab(HW * 0.5, LEN * 0.5, 0.05, MAT.jaliStone, Y + H + 0.45);
  sky.position.z = -(LEN * 0.36 - LEN * 0.5 * 0.3);
  sky.castShadow = false;
  roof.add(sky);
  g.add(roof);
  // 神龛（小三角的尖端）：深色雕花石框、Devi、两侧白色镂空雕花石柱、整面墙的油灯
  const SZ = -15.5,
    S = new THREE.Group();
  S.position.set(0, Y, SZ);
  g.add(S);
  S.add(
    tbox(7.2, H, 0.5, MAT.brick, 0, H / 2, -1.4),
    tbox(3.4, 4.4, 0.5, MAT.darkStone, 0, 2.2, -1.0),
    tbox(2.3, 3.5, 0.3, MAT.sariRed, 0, 2.0, -0.82),
    tbox(3.8, 0.35, 0.8, MAT.darkStone, 0, 4.55, -0.9),
  );
  for (const sx of [-1, 1]) {
    S.add(
      tbox(1.0, 0.6, 1.0, MAT.white, sx * 2.9, 0.3, 1.6),
      tbox(0.8, 3.0, 0.8, MAT.white, sx * 2.9, 2.1, 1.6),
      tbox(1.1, 0.5, 1.1, MAT.white, sx * 2.9, 3.85, 1.6),
    );
    for (const r of [0, Math.PI / 2]) {
      const j = mesh(
        new THREE.PlaneGeometry(0.62, 2.2),
        MAT.jaliStone,
        sx * 2.9 + (r ? sx * -0.41 : 0),
        2.1,
        1.6 + (r ? 0 : 0.41),
        false,
      );
      j.rotation.y = r ? (-sx * Math.PI) / 2 : 0;
      S.add(j);
    }
    const cur = mesh(
      new THREE.PlaneGeometry(0.8, 3.6),
      MAT.sariRed,
      sx * 1.75,
      2.3,
      -0.7,
      false,
    );
    cur.rotation.y = -sx * 0.5;
    S.add(cur);
    const wallLamps = [];
    for (let i = 0; i < 5; i++)
      for (let k = 0; k < 5; k++)
        wallLamps.push([sx * (2.2 + i * 0.32), 1.2 + k * 0.75, -1.1]);
    S.add(glowPoints(wallLamps, 0.8, 0xffa040));
  }
  // Devi：约 8 ft 的黑色林伽形身躯，三只眼、十臂，下身裹红金纱丽
  const d = new THREE.Group();
  d.position.set(0, -0.95, -0.35);
  S.add(d); // Devi 立在下沉小坑的底面上
  const body = mesh(
    new THREE.CapsuleGeometry(0.72, 1.25, 8, 20),
    MAT.black,
    0,
    1.75,
    0,
  );
  body.scale.z = 0.72;
  d.add(
    tbox(2.2, 0.5, 1.3, MAT.darkStone, 0, 0.25, 0),
    body,
    mesh(
      new THREE.CylinderGeometry(0.76, 0.86, 0.95, 20),
      MAT.sariRed,
      0,
      0.98,
      0,
    ),
  );
  for (const y of [0.72, 0.95, 1.18]) {
    const r = mesh(
      new THREE.TorusGeometry(0.82, 0.035, 5, 24),
      MAT.goldTrim,
      0,
      y,
      0,
      false,
    );
    r.rotation.x = Math.PI / 2;
    d.add(r);
  }
  for (const sx of [-1, 1]) {
    const e = mesh(
      new THREE.SphereGeometry(0.15, 10, 8),
      MAT.eyeW,
      sx * 0.3,
      2.25,
      0.5,
      false,
    );
    e.scale.set(1.5, 0.75, 0.3);
    d.add(
      e,
      mesh(
        new THREE.SphereGeometry(0.07, 8, 6),
        MAT.black,
        sx * 0.3,
        2.25,
        0.55,
        false,
      ),
    );
    for (let i = 0; i < 5; i++) {
      const a = -0.75 + i * 0.36,
        arm = mesh(
          new THREE.CapsuleGeometry(0.06, 0.7, 4, 6),
          MAT.darkStone,
          sx * (0.72 + Math.cos(a) * 0.45),
          1.75 + Math.sin(a) * 0.5,
          -0.05,
        );
      arm.rotation.z = sx * (a - Math.PI / 2);
      d.add(arm);
    }
  }
  const eye3 = mesh(
    new THREE.SphereGeometry(0.13, 10, 8),
    MAT.gold,
    0,
    2.62,
    0.47,
    false,
  );
  eye3.scale.set(0.6, 1.5, 0.3);
  const gar = mesh(
    new THREE.TorusGeometry(0.62, 0.06, 6, 24),
    MAT.lotusW,
    0,
    1.75,
    0.32,
    false,
  );
  gar.scale.y = 1.7;
  gar.rotation.x = -0.12;
  d.add(
    eye3,
    mesh(
      new THREE.SphereGeometry(0.05, 6, 5),
      MAT.sariRed,
      0,
      2.62,
      0.52,
      false,
    ),
    mesh(
      new THREE.SphereGeometry(0.05, 6, 5),
      MAT.gold,
      0.12,
      1.98,
      0.52,
      false,
    ),
    gar,
  );
  const bells = [];
  for (let i = 0; i < 9; i++)
    bells.push(M(-2 + i * 0.5, 4.2 - (i % 2) * 0.3, 0.6, 1, 1, 1));
  S.add(
    instanced(new THREE.ConeGeometry(0.09, 0.22, 8), MAT.gold, bells, false),
    glowPoints(
      [
        [-0.9, 0.7, 0.9],
        [0.9, 0.7, 0.9],
        [0, 0.45, 1.2],
      ],
      1.6,
    ),
    pointLight(0xff6a30, 110, 30, 0, 2.6, 3),
  );
  const lbl = new THREE.PointLight(0xffd2a0, 34, 17, 1.2);
  lbl.position.set(0, Y + 4.2, -8);
  g.add(lbl);
  // 殿中央：倾斜立着的大三叉戟，立在方形石座的水盘里
  const tp = new THREE.Group();
  tp.position.set(0.4, Y, -6);
  const tr = bigTrishul(4.4);
  tr.rotation.z = 0.24;
  tr.position.x = -0.5;
  const tg = mesh(
    new THREE.TorusGeometry(0.3, 0.05, 6, 20),
    MAT.sariRed,
    -1.3,
    3.2,
    0.05,
    false,
  );
  tg.scale.y = 2.4;
  tg.rotation.z = 0.24;
  tp.add(
    tbox(2.6, 0.22, 2.6, MAT.white, 0, 0.11, 0),
    mesh(
      new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      MAT.pondWater,
      0,
      0.23,
      0,
      false,
    ),
    tr,
    tg,
  );
  g.add(tp);
  // 前殿：雕蛇纹的石础 + 黑色立柱、出挑的平顶、木格栅；台阶前是灯塔与小三叉戟
  const bases = [],
    posts = [];
  for (const x of [-7, -2.4, 2.4, 7])
    for (const z of [1.6, 7.5, 13.4]) {
      bases.push(M(x, Y + 0.5, z, 0.95, 1, 0.95));
      posts.push(M(x, Y + 2.9, z, 0.24, 3.8, 0.24));
    }
  g.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.granite, bases),
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.black, posts),
  );
  const fr = new THREE.Group();
  asRoof(fr);
  fr.add(
    tbox(19, 0.3, 17.5, MAT.wood, 0, Y + 4.95, 7.6),
    tbox(19.6, 0.16, 18.1, MAT.darkStone, 0, Y + 5.18, 7.6),
  );
  g.add(fr);
  for (const sx of [-1, 1])
    g.add(tbox(0.1, 3.2, 5.4, MAT.jali, sx * 7.4, Y + 2.2, 4.5));
  g.add(stairs(9, 3, 0.2, 0.5, MAT.granite, 0, Y, 16, 1, 0));
  const ot = bigTrishul(3.2);
  ot.position.set(0, 0, 20.5);
  g.add(ot, tcyl(0.5, 0.65, 0.4, 10, MAT.darkStone, 0, 0.2, 20.5));
  for (const sx of [-1, 1]) {
    const lt = lampTower(3.6);
    lt.position.set(sx * 3.6, 0, 19.6);
    g.add(lt);
  }
  g.add(
    glowPoints(
      [
        [-7, Y + 4.3, 13.4],
        [7, Y + 4.3, 13.4],
        [-2.4, Y + 4.3, 13.4],
        [2.4, Y + 4.3, 13.4],
      ],
      3,
      0xff9040,
    ),
  );
  return g;
}

// —— Suryakund 与 Suryakund Mandapam：男众净身池。约 74 m 见方的列柱大殿（Mandapam）环绕着沉在地下 22 ft（≈6.7 m）的池坑：
//    东侧是 28 级又宽又深的大台阶（每级近 1 m 深，清晨男众就坐在台阶上做 Guru Pooja 和练习），台阶尽头是 130 × 40 ft 的水池；
//    三面是 200 块巨石砌的墙，池上横跨一道大砖拱，拱下悬着 20 ft 的铜日 —— 正面（+Z）朝西，对着莲池
function createSuryakund() {
  const g = new THREE.Group(),
    W = 74,
    D = 72,
    PW = 42,
    PD = 39,
    PZ = 0,
    DEP = 6.72,
    H = 6.6,
    zE = PZ - PD / 2,
    zW = PZ + PD / 2,
    NS = 28,
    RISE = 0.24,
    RUN = 0.95;
  const pale = MAT.sandstone.clone();
  pale.color.set(0xdcd3c0);
  pale.userData = { s: 4 };
  floorWithHole(g, W, D, 0, PZ, PW / 2, PD / 2, MAT.granite);
  pit(g, 0, PZ, PW, PD, DEP, MAT.sandstone);
  // 大台阶：自东向西下行，最下面五级没在水里
  g.add(stairs(PW, NS, RISE, RUN, pale, 0, 0, zE, 1, -DEP));
  const stepY = (i) => -i * RISE,
    stepZ = (i) => zE + (i + 0.5) * RUN;
  const WL = -5.45,
    wz = zE + 22.8 * RUN,
    pool = mesh(
      scaleUV(new THREE.PlaneGeometry(PW, zW - wz), PW / 8, 2.4),
      MAT.water,
      0,
      WL,
      (wz + zW) / 2,
      false,
    );
  pool.rotation.x = -Math.PI / 2;
  g.add(pool);
  g.add(
    mesh(
      new THREE.PlaneGeometry(6.5, 5.3),
      MAT.fall,
      0,
      -2.8,
      zW - 0.08,
      false,
    ),
    tbox(7.5, 0.5, 1.2, MAT.darkStone, 0, 0.05, zW + 0.3),
  );
  // 台阶中段的两根通高石柱；水边一方红布围着的林伽；池里三座水银林伽
  for (const x of [-7.5, 7.5])
    g.add(
      tbox(1.3, 0.6, 1.3, pale, x, stepY(12) + 0.3, stepZ(12)),
      tbox(
        0.9,
        H + 3 - stepY(12),
        0.9,
        pale,
        x,
        (H + 3 + stepY(12)) / 2,
        stepZ(12),
      ),
    );
  g.add(tbox(1.6, 1.9, 1.6, MAT.red, -7.5, stepY(21) + 0.95, stepZ(21)));
  for (const x of [-13, 0, 13])
    g.add(
      mesh(
        new THREE.CapsuleGeometry(0.42, 0.5, 5, 10),
        MAT.silver,
        x,
        WL - 0.1,
        zW - 6,
      ),
      tcyl(0.8, 0.9, 0.3, 14, MAT.darkStone, x, WL - 0.5, zW - 6),
    );
  // 台阶上的扶手短柱、练习垫，以及坐着做练习的人
  const posts = [],
    mats = [],
    folk = [],
    sl = [];
  for (let i = 3; i < 23; i += 4)
    for (const x of [-14, -3.5, 3.5, 14])
      posts.push(M(x, stepY(i) + 0.35, stepZ(i), 0.12, 0.7, 0.12));
  for (let i = 1; i <= 15; i += 2)
    for (let x = -19; x <= 19; x += 2) {
      if (Math.abs(Math.abs(x) - 7.5) < 1 && i > 9) continue;
      if (hash(i, x + 40) < 0.62) {
        mats.push(M(x, stepY(i) + 0.012, stepZ(i), 0.66, 0.02, 0.8));
        if (hash(x + 9, i) < 0.8)
          folk.push([
            x,
            stepY(i),
            stepZ(i) - 0.05,
            0,
            [0xf2ede2, 0xf2ede2, 0xe9a03a, 0x8a2f24][
              Math.floor(hash(i, x) * 4)
            ],
          ]);
      }
    }
  for (let i = 0; i < 22; i += 3)
    for (let x = -20; x <= 20; x += 5)
      sl.push([x, stepY(i) + 0.18, stepZ(i) + 0.4]);
  g.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.black, posts),
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.straw, mats, false),
    seated(folk),
    glowPoints(sl, 1.4, 0xffb060),
  );
  // Mandapam：白色花岗岩方柱（带柱础、柱头）；通往 Naga Shrine 的中轴留空
  const cols = [];
  for (let x = -W / 2 + 3; x <= W / 2 - 2; x += 8.5)
    for (let z = -D / 2 + 3; z <= D / 2 - 2; z += 8.25)
      if (
        !(Math.abs(x) < PW / 2 + 0.6 && z > zE - 0.6 && z < zW + 0.6) &&
        !(Math.abs(x) < 5 && z < zE)
      )
        cols.push([x, z]);
  for (let x = -PW / 2; x <= PW / 2; x += 7) cols.push([x, zW + 1.3]);
  for (let z = zE + 3.5; z <= zW; z += 6.4)
    cols.push([-PW / 2 - 1.3, z], [PW / 2 + 1.3, z]);
  for (const x of [-17.5, -10.5, 10.5, 17.5]) cols.push([x, zE - 1.3]);
  g.add(stoneColumns(cols, 0.16, H, 0.4, pale));
  const pm = [];
  for (let x = -30; x <= 30; x += 4)
    for (const z of [-30, -26])
      if (Math.abs(x) > 5) pm.push(M(x, 0.175, z, 0.66, 0.02, 1.8)); // Mandapam 地面上的练习垫
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.straw, pm, false));
  const roof = new THREE.Group();
  asRoof(roof);
  g.add(roof);
  floorWithHole(
    roof,
    W + 3,
    D + 3,
    0,
    PZ,
    PW / 2 + 2,
    PD / 2 + 2,
    MAT.wood,
    H + 0.35,
    0.3,
  );
  floorWithHole(
    roof,
    W + 4,
    D + 4,
    0,
    PZ,
    PW / 2 + 2,
    PD / 2 + 2,
    MAT.salmon,
    H + 0.68,
    0.36,
  );
  // 池坑上的大砖拱（拱轴南北向），两端敞开透天
  const VR = PD / 2 + 2.2,
    vg = new THREE.CylinderGeometry(
      VR,
      VR,
      PW + 4,
      32,
      1,
      true,
      Math.PI / 2,
      Math.PI,
    );
  vg.rotateX(Math.PI / 2);
  vg.scale(1, 8.2 / VR, 1);
  scaleUV(vg, 26, 18);
  const vault = mesh(vg, MAT.brickDS, 0, H + 0.5, PZ);
  vault.rotation.y = Math.PI / 2;
  roof.add(vault);
  // 铜日：直径约 6 m，悬在拱下，朝着台阶
  const sun = new THREE.Group();
  sun.position.set(0, H + 4.2, 6);
  sun.rotation.order = 'YXZ';
  sun.rotation.set(Math.PI / 2 - 0.55, Math.PI, 0);
  sun.add(
    mesh(
      new THREE.CylinderGeometry(1.7, 1.7, 0.3, 28).rotateX(Math.PI / 2),
      MAT.copper,
    ),
    mesh(
      new THREE.SphereGeometry(1.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)
        .rotateX(Math.PI / 2)
        .scale(1, 1, 0.3),
      MAT.copper,
      0,
      0,
      0.1,
    ),
  );
  const rays = [];
  for (let i = 0; i < 26; i++) {
    const a = (i * Math.PI * 2) / 26 + (i % 3) * 0.05,
      l = [1.5, 1.0, 1.25][i % 3];
    rays.push(
      M(
        Math.cos(a) * (1.7 + l * 0.5),
        Math.sin(a) * (1.7 + l * 0.5),
        0,
        1,
        l,
        0.35,
        0,
        0,
        a - Math.PI / 2,
      ),
    );
  }
  sun.add(instanced(new THREE.ConeGeometry(0.3, 1, 5), MAT.gold, rays, false));
  g.add(sun);
  // 西立面（正面）：赤陶瓦坡檐的长柱廊 + 通长台阶，檐后一排小攒尖亭；其余三面是矮石墙
  const vc = [];
  for (let x = -W / 2 + 2; x <= W / 2 - 2; x += 5) vc.push([x, D / 2 + 5]);
  g.add(
    tbox(W, 0.16, 6.5, MAT.granite, 0, 0.08, D / 2 + 3.2),
    stoneColumns(vc, 0.16, 3.6, 0.26, pale),
    stairs(W - 10, 3, 0.16, 0.5, MAT.granite, 0, 0.16, D / 2 + 6.5, 1, 0),
  );
  const ve = asRoof(tbox(W + 2, 0.25, 7.6, MAT.tile, 0, 4.9, D / 2 + 3.4));
  ve.rotation.x = 0.33;
  g.add(ve);
  const cup = [];
  for (let x = -30; x <= 30; x += 10)
    cup.push(M(x, H + 1.7, D / 2 - 2.5, 1, 1, 1, Math.PI / 4));
  roof.add(
    tbox(W - 6, 0.7, 5, MAT.salmon, 0, H + 1.05, D / 2 - 2.5),
    instanced(new THREE.ConeGeometry(2.3, 1.5, 4), MAT.tile, cup),
  );
  g.add(tbox(W, 1.1, 0.5, MAT.sandstone, 0, 0.7, -D / 2 + 0.3));
  for (const sx of [-1, 1])
    g.add(tbox(0.5, 1.1, D, MAT.sandstone, sx * (W / 2 - 0.3), 0.7, 0));
  const ml = [];
  for (let x = -30; x <= 30; x += 12)
    for (const z of [-30, 30]) ml.push([x, H - 0.5, z]);
  const il = new THREE.PointLight(0xffd9a8, 60, 46, 1.1);
  il.position.set(0, 2.5, -4);
  g.add(
    glowPoints(ml, 5),
    pointLight(0xffb060, 300, 70, 0, 2, PZ),
    pointLight(0xffc070, 120, 50, 0, 4, D / 2 - 6),
    il,
  );
  return g;
}

// —— Chandrakund：女众净身池，沉在地下 30 ft（≈9 m），沿 32 级巨大石阶而下；入口是红砖拱丘 + 钢格栅平顶棚，柱脚两只石龟 ——
function createChandrakund() {
  const g = new THREE.Group(),
    PW = 12,
    PD = 30,
    PZ = -2,
    DEP = 9,
    zTop = PZ + PD / 2,
    zB = PZ - PD / 2;
  pit(g, 0, PZ, PW, PD, DEP, MAT.sandstone);
  g.add(stairs(PW, 32, 0.25, 0.56, MAT.granite, 0, 0, zTop, -1, -DEP));
  const pool = mesh(
    scaleUV(new THREE.PlaneGeometry(PW, 12.1), 1.5, 1.5),
    MAT.waterBlue,
    0,
    -8.0,
    zB + 6.05,
    false,
  );
  pool.rotation.x = -Math.PI / 2;
  g.add(pool);
  g.add(
    tcyl(1.3, 1.5, 0.5, 16, MAT.darkStone, 0, -8.2, zB + 5),
    mesh(
      new THREE.CapsuleGeometry(0.42, 0.5, 6, 12),
      MAT.silver,
      0,
      -7.6,
      zB + 5,
    ),
  ); // 池中的水银林伽
  // 池上的拱顶：Kerala 风格的 Mahakumbha Mela 壁画（55 × 15 ft）
  const vg = new THREE.CylinderGeometry(
    PW / 2,
    PW / 2,
    16.8,
    20,
    1,
    true,
    Math.PI / 2,
    Math.PI,
  );
  vg.rotateX(Math.PI / 2);
  vg.scale(1, 0.55, 1);
  g.add(mesh(vg, MAT.muralM, 0, -3.6, zB + 8.4, false));
  // 地面：池坑上方是石板顶（点「剖视」掀开），台阶口敞开，可以沿台阶走下去
  const cover = new THREE.Group();
  asRoof(cover);
  const lid = tbox(PW + 3, 0.3, PD - 8, MAT.paving, 0, 0.0, PZ - 4);
  lid.castShadow = false;
  cover.add(lid);
  g.add(cover);
  // 入口：红砖拱丘（锯齿形砖檐）罩住台阶口
  const mound = new THREE.Group();
  mound.position.set(0, 0, zTop + 0.5);
  const mg = new THREE.CylinderGeometry(
    7.2,
    7.2,
    5,
    28,
    1,
    true,
    Math.PI / 2,
    Math.PI,
  );
  mg.rotateX(Math.PI / 2);
  mg.scale(1, 0.5, 1);
  scaleUV(mg, 9, 2);
  const ag = new THREE.RingGeometry(6.2, 7.2, 28, 1, 0, Math.PI);
  ag.scale(1, 0.5, 1);
  mound.add(
    mesh(mg, MAT.brickDS, 0, 0, -0.5),
    mesh(ag, MAT.brickDS, 0, 0.02, 2.0),
  );
  const teeth = [];
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.14 + i * 0.09);
    teeth.push(
      M(
        Math.cos(a) * 7.0,
        Math.sin(a) * 3.5 + 0.25,
        1.9,
        1,
        1,
        1,
        0,
        0,
        a - Math.PI / 2,
      ),
    );
  }
  mound.add(instanced(new THREE.ConeGeometry(0.55, 0.8, 4), MAT.brick, teeth));
  g.add(mound);
  // 钢格栅平顶棚：混凝土方柱，前排柱脚各一只石龟；两侧是低矮的更衣间
  const CZ = zTop + 8,
    can = new THREE.Group();
  asRoof(can);
  can.add(
    tbox(22, 0.12, 13, MAT.grid, 0, 5.15, CZ),
    tbox(22.4, 0.3, 0.3, MAT.concrete, 0, 5.15, CZ + 6.5),
    tbox(22.4, 0.3, 0.3, MAT.concrete, 0, 5.15, CZ - 6.5),
    tbox(0.3, 0.3, 13, MAT.concrete, 11.1, 5.15, CZ),
    tbox(0.3, 0.3, 13, MAT.concrete, -11.1, 5.15, CZ),
    tbox(14, 0.4, 9, MAT.concrete, 0, 5.75, CZ + 1),
  );
  g.add(can);
  g.add(
    columns(
      [
        [-9.5, CZ + 5.4],
        [-4.6, CZ + 5.4],
        [4.6, CZ + 5.4],
        [9.5, CZ + 5.4],
        [-9.5, CZ - 5.4],
        [9.5, CZ - 5.4],
      ],
      0.16,
      4.9,
      0.22,
      MAT.concrete,
      true,
    ),
  );
  const pv = tbox(24, 0.16, 15, MAT.granite, 0, 0.08, CZ);
  pv.castShadow = false;
  g.add(pv);
  for (const sx of [-1, 1]) {
    const shell = mesh(
      new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      MAT.concrete,
      sx * 4.6,
      0.25,
      CZ + 6.4,
    );
    shell.scale.set(0.75, 0.6, 0.95);
    g.add(
      shell,
      mesh(
        new THREE.SphereGeometry(0.22, 8, 6),
        MAT.darkStone,
        sx * 4.6,
        0.3,
        CZ + 7.5,
      ),
    );
    const wing = house(9, 5, 2.7, {
      roof: 'flat',
      wall: MAT.brick,
      win: 2,
      plinth: 0.2,
      roofMat: MAT.concrete,
    });
    wing.position.set(sx * 16, 0, zTop + 2);
    g.add(wing);
  }
  g.add(tcyl(0.55, 0.3, 0.3, 14, MAT.sandstone, 0, 0.3, CZ + 4));
  const moon = mesh(
    new THREE.TorusGeometry(0.9, 0.18, 8, 22, Math.PI * 1.2),
    MAT.silver,
    0,
    4.4,
    zTop + 2.6,
    false,
  );
  moon.rotation.z = Math.PI + 0.95;
  g.add(moon);
  g.add(
    glowPoints(
      [
        [-PW / 2 + 0.6, -7, zB + 9],
        [PW / 2 - 0.6, -7, zB + 9],
        [-PW / 2 + 0.6, -4, zB + 16],
        [PW / 2 - 0.6, -4, zB + 16],
        [-4.6, 3.6, CZ + 5.4],
        [4.6, 3.6, CZ + 5.4],
      ],
      3.5,
      0xa8c4ff,
    ),
    pointLight(0x9ab8ff, 140, 40, 0, -4, zB + 7),
  );
  return g;
}

// —— Bhiksha Hall：斋堂。约 62 × 52 m 的白色大厅，一次约两千人席地成排、在静默中用餐；南面是入口门廊 ——
function createBhikshaHall() {
  const g = new THREE.Group(),
    Y = 0.6,
    W = 62,
    D = 52,
    H = 7;
  g.add(tbox(W + 3, Y, D + 3, MAT.granite, 0, Y / 2, 0));
  for (const sz of [-1, 1])
    g.add(tbox(W, H, 0.5, MAT.white, 0, Y + H / 2, sz * (D / 2 - 0.25)));
  for (const sx of [-1, 1])
    g.add(tbox(0.5, H, D, MAT.white, sx * (W / 2 - 0.25), Y + H / 2, 0));
  const win = [],
    lou = [];
  for (let x = -27; x <= 27; x += 6)
    for (const sz of [-1, 1]) {
      if (!(sz > 0 && Math.abs(x) < 9))
        win.push(M(x, Y + 2.2, sz * (D / 2 + 0.02), 3.4, 2.2, 0.08));
      lou.push(M(x, Y + 5.6, sz * (D / 2 + 0.02), 4.6, 1.1, 0.08));
    }
  for (let z = -22; z <= 22; z += 6)
    for (const sx of [-1, 1]) {
      win.push(M(sx * (W / 2 + 0.02), Y + 2.2, z, 0.08, 2.2, 3.4));
      lou.push(M(sx * (W / 2 + 0.02), Y + 5.6, z, 0.08, 1.1, 4.6));
    }
  g.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.window, win, false),
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.darkStone, lou, false),
  );
  const roof = new THREE.Group();
  asRoof(roof);
  roof.add(gableRoof(D + 5, W + 5, 4.2, Y + H, MAT.salmon, MAT.white));
  g.add(roof);
  // 室内：两排白柱、成排的草垫、每排前面一溜香蕉叶餐位
  const ic = [];
  for (let x = -24; x <= 24; x += 12) for (const z of [-9, 9]) ic.push([x, z]);
  g.add(columns(ic, Y, H, 0.3, MAT.white, true));
  const mats = [],
    leaves = [];
  for (let i = 0; i < 12; i++) {
    const z = -D / 2 + 4 + i * 3.9;
    mats.push(M(0, Y + 0.03, z, W - 8, 0.05, 0.9));
    leaves.push(M(0, Y + 0.035, z + 0.85, W - 8, 0.04, 0.5));
  }
  g.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.straw, mats, false),
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.pad, leaves, false),
  );
  // 成排席地而坐、面朝香蕉叶用餐的人（约一半的位置坐了人；避开柱子）
  const diners = [];
  for (let i = 0; i < 12; i++)
    for (let x = -26.5; x <= 26.5; x += 1.0) {
      const z = -D / 2 + 4 + i * 3.9;
      if (
        hash(i * 7 + 3, Math.round(x * 2) + 99) > 0.42 ||
        (Math.abs(Math.abs(z) - 9) < 1.2 &&
          Math.abs(x - Math.round(x / 12) * 12) < 0.9)
      )
        continue;
      diners.push(folk(x, Y + 0.05, z, 0, 'c'));
    }
  g.add(crowd(diners));
  // 南入口门廊（约 18 × 14 m）与台阶，门廊两侧是洗手槽
  g.add(
    tbox(19, Y, 15, MAT.granite, 0, Y / 2, D / 2 + 8),
    stoneColumns(
      [-8, -2.7, 2.7, 8].flatMap((x) => [
        [x, D / 2 + 7],
        [x, D / 2 + 14],
      ]),
      Y,
      4.6,
      0.3,
      MAT.white,
    ),
    asRoof(tbox(20.5, 0.4, 16, MAT.concrete, 0, Y + 4.9, D / 2 + 8)),
    stairs(14, 3, 0.2, 0.5, MAT.granite, 0, Y, D / 2 + 15.5, 1, 0),
    mesh(
      new THREE.PlaneGeometry(15, 4.4),
      MAT.doorGlow,
      0,
      Y + 2.2,
      D / 2 + 0.03,
      false,
    ),
  );
  const sb = signBoard('Bhiksha Hall', 7, 1.1);
  sb.position.set(0, Y + 5.9, D / 2 + 15.9);
  g.add(sb);
  for (const sx of [-1, 1]) {
    g.add(
      tbox(12, 0.9, 0.9, MAT.granite, sx * 19, 0.6, D / 2 + 4),
      tbox(11.4, 0.06, 0.6, MAT.pondWater, sx * 19, 1.06, D / 2 + 4),
      tbox(12, 0.1, 0.1, MAT.metalRoof, sx * 19, 1.5, D / 2 + 4),
    );
    const sh = [];
    for (let k = 0; k < 4; k++)
      sh.push(M(sx * 12.5, 0.4 + k * 0.4, D / 2 + 11, 0.9, 0.05, 6));
    g.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.wood, sh));
  }
  const lamps = [];
  for (let x = -24; x <= 24; x += 12)
    for (const z of [-16, 0, 16]) lamps.push([x, Y + 6.2, z]);
  g.add(glowPoints(lamps, 6), pointLight(0xffc080, 220, 70, 0, Y + 5, 0));
  return g;
}

// —— Isha Life 商店 + Peppervine Eatery：入口北翼以北、主路西侧。
//    Peppervine 参照 Wikimedia Commons 的照片：分节雕花的石柱、钢桁架托着棕色屋面板的大敞棚、石板地、棚前的石水槽和木箭头路牌；
//    Isha Life 没找到照片，按敞开式店面推测：货架上是衣物、书、铜器和食品 ——
function createIshaLife() {
  const g = new THREE.Group(),
    Y = 0.45,
    W = 26,
    D = 8,
    H = 3.5;
  g.add(
    tbox(W + 1, Y, D + 5, MAT.granite, 0, Y / 2, 1.8),
    tbox(W, H, 0.3, MAT.plaster, 0, Y + H / 2, -D / 2),
  );
  for (const sx of [-1, 1])
    g.add(tbox(0.3, H, D, MAT.plaster, (sx * W) / 2, Y + H / 2, 0));
  const posts = [];
  for (let x = -W / 2; x <= W / 2; x += W / 6)
    posts.push([x, D / 2], [x, D / 2 + 3]);
  g.add(
    columns(posts, Y, H - 0.3, 0.15, MAT.wood, true),
    tbox(W + 0.4, 0.3, 0.3, MAT.wood, 0, Y + H - 0.2, D / 2),
    tbox(W, 0.05, D, MAT.redPaver, 0, Y + 0.03, 0),
  );
  const roof = new THREE.Group();
  asRoof(roof);
  roof.add(gableRoof(D + 1.6, W + 1.6, 2.6, Y + H, MAT.tile, MAT.plaster));
  const ver = tbox(W + 1.6, 0.2, 3.8, MAT.tile, 0, Y + H - 0.5, D / 2 + 1.7);
  ver.rotation.x = 0.2;
  roof.add(ver);
  g.add(roof);
  // 货架：后墙与两端各一排，分层摆着各色货品；中间是展示台和衣架
  const shelf = [],
    goods = [],
    pal = [
      0xb5482a, 0xd9a441, 0x2f6b4a, 0x7a3b6a, 0xe8dcc0, 0x1f4f7a, 0xc8703a,
      0x8a2f24, 0xf0c87a,
    ];
  for (let k = 0; k < 4; k++) {
    shelf.push(M(0, Y + 0.5 + k * 0.7, -D / 2 + 0.5, W - 1.2, 0.05, 0.6));
    for (let x = -12; x <= 12; x += 0.62)
      if (hash((x * 10) | 0, k) > 0.12)
        goods.push([
          M(
            x,
            Y + 0.72 + k * 0.7,
            -D / 2 + 0.5,
            0.42,
            0.3 + hash(k, (x * 7) | 0) * 0.22,
            0.4,
          ),
          pal[Math.floor(hash((x * 5) | 0, k + 3) * pal.length)],
        ]);
  }
  for (const x of [-9, -3, 3, 9]) {
    shelf.push(
      M(x, Y + 0.85, 0.8, 3.2, 0.08, 1.4),
      M(x, Y + 0.42, 0.8, 3, 0.84, 1.2),
    );
    for (let i = 0; i < 10; i++)
      goods.push([
        M(
          x - 1.3 + (i % 5) * 0.65,
          Y + 1.02,
          0.45 + ((i / 5) | 0) * 0.7,
          0.45,
          0.24,
          0.45,
        ),
        pal[(i + (x | 0) + 9) % pal.length],
      ]);
  }
  const cloth = [];
  for (const x of [-6, 0, 6]) {
    shelf.push(
      M(x, Y + 1.7, 2.6, 2.4, 0.05, 0.05),
      M(x - 1.2, Y + 0.85, 2.6, 0.05, 1.7, 0.05),
      M(x + 1.2, Y + 0.85, 2.6, 0.05, 1.7, 0.05),
    );
    for (let i = 0; i < 9; i++)
      cloth.push([
        M(x - 1 + i * 0.25, Y + 1.1, 2.6, 0.06, 1.1, 0.55),
        pal[(i * 2 + (x | 0) + 12) % pal.length],
      ]);
  }
  g.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.wood, shelf),
    tinted(new THREE.BoxGeometry(1, 1, 1), goods),
    tinted(new THREE.BoxGeometry(1, 1, 1), cloth, 0.95),
  );
  const pots = [];
  for (let i = 0; i < 7; i++)
    pots.push(M(-11.5 + i * 0.75, Y + 0.28, 3.2, 1, 1, 1));
  g.add(instanced(new THREE.SphereGeometry(0.26, 10, 8), MAT.copper, pots)); // 门口一排铜器
  g.add(
    tbox(2.6, 1.0, 0.9, MAT.wood, 11, Y + 0.5, 1.5),
    tbox(2.8, 0.05, 1.1, MAT.darkStone, 11, Y + 1.02, 1.5),
  ); // 收银台
  const sb = signBoard('Isha Life', 6, 1.2);
  sb.position.set(0, Y + H + 0.5, D / 2 + 3.3);
  g.add(sb);
  for (const x of [-13.3, 13.3])
    g.add(
      tcyl(0.5, 0.36, 0.7, 10, MAT.tile, x, Y + 0.35, D / 2 + 3.6),
      mesh(
        new THREE.IcosahedronGeometry(0.75, 1),
        MAT.leaf,
        x,
        Y + 1.25,
        D / 2 + 3.6,
      ),
    );
  const sl = new THREE.PointLight(0xffe2b8, 26, 14, 1.2);
  sl.position.set(0, Y + 2.8, 0.5);
  g.add(sl);
  // —— Peppervine Eatery（西北侧）——
  const pv = new THREE.Group();
  pv.position.set(24, 0, -13);
  g.add(pv);
  const PW = 24,
    PD = 17,
    cps = [],
    seg = [];
  pv.add(tbox(PW + 1.6, 0.3, PD + 1.6, MAT.paving, 0, 0.15, 0));
  for (let i = 0; i < 5; i++)
    for (let k = 0; k < 4; k++)
      cps.push([
        -PW / 2 + 0.6 + (i * (PW - 1.2)) / 4,
        -PD / 2 + 0.6 + (k * (PD - 1.2)) / 3,
      ]);
  for (const [x, z] of cps) {
    seg.push(
      M(x, 0.55, z, 0.62, 0.5, 0.62),
      M(x, 1.25, z, 0.42, 0.9, 0.42, Math.PI / 4),
      M(x, 1.95, z, 0.6, 0.5, 0.6),
      M(x, 2.7, z, 0.42, 1.0, 0.42, Math.PI / 4),
      M(x, 3.4, z, 0.62, 0.45, 0.62),
      M(x, 3.78, z, 0.95, 0.3, 0.5),
    );
  }
  pv.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.concrete, seg));
  // 钢桁架顶棚：上下弦 + 斜腹杆，上面是棕色屋面板，四周深出檐
  const pr = new THREE.Group();
  asRoof(pr);
  pv.add(pr);
  const tb = [],
    TY = 4.0;
  for (let i = 0; i < 5; i++) {
    const x = -PW / 2 + 0.6 + (i * (PW - 1.2)) / 4;
    tb.push(
      M(x, TY, 0, 0.09, 0.09, PD + 4),
      M(x, TY + 0.6, 0, 0.09, 0.09, PD + 4),
    );
    for (let z = -PD / 2 - 1.5; z < PD / 2 + 1.5; z += 1.2)
      tb.push(
        M(
          x,
          TY + 0.3,
          z + 0.6,
          0.05,
          0.85,
          0.05,
          0,
          Math.round(z / 1.2) % 2 ? 0.78 : -0.78,
        ),
      );
  }
  for (let z = -PD / 2 - 1.8; z <= PD / 2 + 1.8; z += (PD + 3.6) / 8)
    tb.push(M(0, TY + 0.62, z, PW + 4, 0.08, 0.08));
  pr.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.black, tb),
    tbox(PW + 5, 0.1, PD + 5, MAT.wood, 0, TY + 0.75, 0),
    tbox(PW + 5.2, 0.12, PD + 5.2, MAT.concrete, 0, TY + 0.87, 0),
  );
  // 桌凳、取餐台与黑板、柱上攀着的胡椒藤
  const tables = [],
    benches = [];
  for (let i = 0; i < 4; i++)
    for (let k = 0; k < 2; k++) {
      const x = -8.2 + i * 5.5,
        z = -1.6 + k * 5.4;
      tables.push(M(x, 1.05, z, 2.6, 0.08, 1));
      benches.push(
        M(x, 0.72, z - 0.95, 2.6, 0.07, 0.4),
        M(x, 0.72, z + 0.95, 2.6, 0.07, 0.4),
        M(x - 1.1, 0.68, z, 0.08, 0.75, 0.8),
        M(x + 1.1, 0.68, z, 0.08, 0.75, 0.8),
      );
    }
  pv.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.wood, tables),
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.wood, benches),
  );
  pv.add(
    tbox(10, 1.05, 1, MAT.darkStone, -3, 0.83, -6.3),
    tbox(PW - 2, 2.9, 0.25, MAT.plaster, 0, 1.75, -7.6),
    tbox(4.5, 1.3, 0.06, MAT.black, 5.5, 2.1, -7.42),
    tbox(8, 1.2, 0.1, MAT.doorGlow, -3, 2.0, -7.45),
  );
  const pfood = [];
  ['#c98a2e', '#f3ead2', '#8a4a1e', '#6f9a3a', '#d8b24a'].forEach((c, i) =>
    pfood.push([
      M(-6.4 + i * 1.7, 1.42, -6.3, 1.2, 0.13, 0.6),
      new Color(c).getHex(),
    ]),
  );
  pv.add(tinted(new THREE.BoxGeometry(1, 1, 1), pfood));
  const vines = [];
  cps
    .filter((_, i) => i % 3 === 0)
    .forEach(([x, z]) => {
      const pts = [];
      for (let t = 0; t <= 16; t++)
        pts.push(
          new V3(
            x + Math.cos(t * 0.9) * 0.36,
            0.4 + t * 0.21,
            z + Math.sin(t * 0.9) * 0.36,
          ),
        );
      vines.push(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.07, 5),
      );
    });
  pv.add(mesh(mergeGeos(vines), MAT.pad));
  const ps = signBoard('Peppervine Eatery', 7, 1.0);
  ps.position.set(0, 3.3, PD / 2 + 2.3);
  pv.add(
    ps,
    tbox(0.14, 3.3, 0.14, MAT.wood, -3.3, 1.65, PD / 2 + 2.3),
    tbox(0.14, 3.3, 0.14, MAT.wood, 3.3, 1.65, PD / 2 + 2.3),
  );
  // 棚前的石水槽（养着睡莲）和木箭头路牌
  const lil = [];
  for (let i = 0; i < 7; i++)
    lil.push(
      M(
        9.6 + (i % 4) * 0.7 - 1,
        0.68,
        11.8 + (i % 2) * 0.4 - 0.2,
        0.26,
        1,
        0.26,
      ),
    );
  pv.add(
    tbox(3.4, 0.7, 1.3, MAT.granite, 9.6, 0.35, 11.8),
    mesh(
      new THREE.PlaneGeometry(2.9, 0.85).rotateX(-Math.PI / 2),
      MAT.pondWater,
      9.6,
      0.66,
      11.8,
      false,
    ),
    instanced(new THREE.CylinderGeometry(1, 1, 0.02, 9), MAT.pad, lil, false),
    tbox(0.14, 1.7, 0.14, MAT.wood, 10.6, 0.85, 10.7),
    tbox(1.9, 0.42, 0.06, MAT.wood, 9.9, 1.55, 10.7),
  );
  g.add(
    glowPoints(
      [
        [-9, Y + 3, 4.5],
        [0, Y + 3, 4.5],
        [9, Y + 3, 4.5],
        [24, 3.6, -9],
        [24, 3.6, -17],
      ],
      4.5,
    ),
  );
  return g;
}

// —— Nalanda：北侧的 Nalanda Stay（白色三层住宿 / 会议楼，翼楼之间是弧形屋面罩着的敞厅）+ 南面的大操场 Nalanda Grounds ——
function createNalanda() {
  const g = new THREE.Group(),
    b = new THREE.Group();
  b.name = 'NalandaStay';
  b.add(
    tbox(120, 0.5, 16, MAT.granite, 0, 0.25, -6),
    tbox(116, 10.5, 12, MAT.white, 0, 5.75, -6),
    asRoof(tbox(118, 0.4, 14, MAT.concrete, 0, 11.2, -6)),
  );
  const win = [],
    rail = [];
  for (const wx of [-52, -17, 17, 52]) {
    b.add(
      tbox(13, 10.5, 30, MAT.white, wx, 5.75, 15),
      asRoof(tbox(14.4, 0.4, 31.4, MAT.concrete, wx, 11.2, 15)),
      tbox(14, 0.5, 31, MAT.granite, wx, 0.25, 15),
    );
    for (let z = 3; z <= 27; z += 4)
      for (const fl of [0, 1, 2])
        for (const sx of [-1, 1])
          win.push(M(wx + sx * 6.53, 2.3 + fl * 3.4, z, 0.08, 1.6, 1.8));
    for (const fl of [0, 1, 2])
      win.push(
        M(wx - 3, 2.3 + fl * 3.4, 30.03, 2, 1.6, 0.08),
        M(wx + 3, 2.3 + fl * 3.4, 30.03, 2, 1.6, 0.08),
      );
  }
  for (let x = -56; x <= 56; x += 4)
    for (const fl of [0, 1, 2])
      win.push(M(x, 2.3 + fl * 3.4, -12.03, 1.8, 1.6, 0.08));
  for (const fl of [1, 2]) rail.push(M(0, 0.6 + fl * 3.4, 0.9, 116, 0.25, 1.6)); // 朝内院的外廊
  b.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.window, win, false),
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.concrete, rail),
  );
  // 翼楼之间的敞厅：弧形白屋面 + 细柱，下面摆着桌椅
  const endM = MAT.white.clone();
  endM.side = THREE.DoubleSide;
  const tables = [];
  for (const cx of [-34.5, 0, 34.5]) {
    const v = asRoof(vaultRoof(22, 26, 2.6, MAT.metalRoof, endM));
    v.position.set(cx, 9.4, 15);
    b.add(v);
    b.add(
      columns(
        [
          [-9, 4],
          [9, 4],
          [-9, 26],
          [9, 26],
          [-9, 15],
          [9, 15],
        ].map(([x, z]) => [cx + x, z]),
        0,
        9.4,
        0.18,
        MAT.white,
      ),
    );
    const fl = tbox(21.5, 0.12, 27, MAT.paving, cx, 0.06, 15);
    fl.castShadow = false;
    b.add(fl);
    for (let i = 0; i < 4; i++)
      for (let k = 0; k < 4; k++)
        tables.push(M(cx - 6.6 + i * 4.4, 0.75, 6 + k * 5.6, 1.6, 0.08, 1.6));
  }
  b.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.wood, tables));
  const sb = signBoard('Nalanda', 6, 1.1);
  sb.position.set(0, 4.2, 30.6);
  b.add(
    sb,
    glowPoints(
      [
        [-34.5, 8.5, 15],
        [0, 8.5, 15],
        [34.5, 8.5, 15],
      ],
      9,
    ),
  );
  g.add(b);
  // Nalanda Grounds：约 165 × 150 m 的操场（傍晚在这里做游戏），四周一圈步道和照明灯杆
  const lawn = new THREE.Group();
  lawn.name = 'NalandaGrounds';
  lawn.position.set(-5, 0, 130);
  const turf = tbox(165, 0.12, 150, MAT.lawn, 0, 0.06, 0);
  turf.castShadow = false;
  lawn.add(turf);
  const worn = tbox(70, 0.02, 50, MAT.paving, 10, 0.13, 5);
  worn.castShadow = false;
  worn.material = new THREE.MeshLambertMaterial({ color: 0xa8926a });
  lawn.add(worn);
  for (const sx of [-1, 1]) {
    lawn.add(
      columns(
        [
          [sx * 32, -3.6],
          [sx * 32, 3.6],
        ],
        0,
        2.4,
        0.06,
        MAT.white,
      ),
      tbox(0.12, 0.12, 7.3, MAT.white, sx * 32, 2.4, 0),
    );
  } // 球门
  const poles = [
    [-84, -76],
    [84, -76],
    [-84, 76],
    [84, 76],
    [0, -78],
    [0, 78],
    [-84, 0],
    [84, 0],
  ];
  lawn.add(
    columns(poles, 0, 12, 0.14, MAT.darkStone),
    glowPoints(
      poles.map(([x, z]) => [x, 12.2, z]),
      14,
      0xfff0d0,
    ),
  );
  g.add(lawn);
  return g;
}

// —— Adiyogi Alayam：约 82,000 平方英尺的无柱大厅。浅粉色的低矮拱顶（中间高、两翼低），正面敞开，立着雕蛇纹的石柱 ——
function createAdiyogiAlayam() {
  const g = new THREE.Group(),
    Y = 0.6,
    W = 100,
    D = 92,
    H = 6.2;
  g.add(
    tbox(W + 5, Y, D + 14, MAT.granite, 0, Y / 2, 3),
    tbox(W, H, D, MAT.darkPlaster, 0, Y + H / 2, 0),
    tbox(52, 2.2, D, MAT.darkPlaster, 0, Y + H + 1.1, 0),
  );
  const endM = MAT.darkPlaster.clone();
  endM.map = null;
  endM.side = THREE.DoubleSide;
  const mid = asRoof(vaultRoof(56, D + 8, 4.6, MAT.salmon, endM));
  mid.position.y = Y + H + 2.2;
  g.add(mid);
  for (const sx of [-1, 1]) {
    const w = asRoof(vaultRoof(30, D + 4, 2.6, MAT.salmon, endM));
    w.position.set(sx * 37, Y + H, 0);
    g.add(w);
  }
  // 敞开的正面：深色内凹 + 四根大石柱（柱身一道赭红色的蛇纹）+ 赤陶花格矮墙
  g.add(tbox(60, 0.8, 10, MAT.darkStone, 0, Y + H + 0.2, D / 2 + 4));
  for (const x of [-27, -9, 9, 27]) {
    g.add(
      tcyl(1.0, 1.1, H, 14, MAT.granite, x, Y + H / 2, D / 2 + 7.5),
      tbox(2.8, 0.5, 2.8, MAT.granite, x, Y + H - 0.2, D / 2 + 7.5),
    );
    const sp = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14,
        a = t * 5;
      sp.push(
        new V3(
          x + Math.sin(a) * 1.08,
          Y + 0.6 + t * 4.4,
          D / 2 + 7.5 + Math.cos(a) * 1.08,
        ),
      );
    }
    g.add(
      mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sp), 28, 0.16, 5),
        MAT.redPlaster,
      ),
    );
  }
  for (const x of [-18, 0, 18])
    g.add(tbox(16, 4.8, 0.2, MAT.window, x, Y + 2.6, D / 2 + 0.12));
  for (const [x, w] of [
    [-40, 16],
    [-25, 10],
    [38, 14],
  ])
    g.add(tbox(w, 1.5, 0.5, MAT.tile, x, Y + 0.75, D / 2 + 9.5));
  for (let i = 0; i < 3; i++)
    g.add(
      tbox(
        40,
        Y - i * 0.2,
        1,
        MAT.granite,
        0,
        (Y - i * 0.2) / 2,
        D / 2 + 10.5 + i,
      ),
    );
  const win = [];
  for (let z = -40; z <= 40; z += 8)
    for (const sx of [-1, 1])
      win.push(M(sx * (W / 2 + 0.06), Y + 3.4, z, 0.1, 3, 3.2));
  g.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.window, win, false),
    glowPoints(
      [-27, -9, 9, 27].map((x) => [x, Y + 5.2, D / 2 + 6]),
      7,
    ),
  );
  return g;
}

// —— Spanda Hall：约 64,000 平方英尺的课程大厅与花园（参照 Isha 官网图库 18 张照片）。
//    大厅：赭红抹灰的台基、四周一圈方石柱外廊、浅灰色低坡四坡金属屋顶，屋脊中央一座抬高的天窗；
//    室内：白色大理石地面、白色层层内收的藻井天花（灯带沿着框线排开）、北墙一幅 140×12 英尺的 Kerala 风格湿婆生平壁画，壁画前是岩石讲座。
//    花园：赭色夯土围墙围着的大草坪，墙边三座石柱小亭（雕花石柱、红色石板顶），石砌岸的莲池，入口处一块巨石和石板小径。正面朝 +Z（花园） ——
function createSpandaHall() {
  const g = new THREE.Group(),
    Y = 0.7,
    W = 62,
    D = 44,
    H = 5.4,
    VR = 3.2;
  const ochre = new THREE.MeshStandardMaterial({
    map: TEX.plaster,
    color: 0xc8714a,
    roughness: 0.95,
  });
  const marble = new THREE.MeshStandardMaterial({
    color: 0xf0ede6,
    roughness: 0.22,
    metalness: 0.05,
  });
  const roofM = new THREE.MeshStandardMaterial({
    color: 0xc4c9cc,
    roughness: 0.45,
    metalness: 0.45,
    side: THREE.DoubleSide,
  });
  const ceilM = new THREE.MeshStandardMaterial({
    color: 0xf4f2ee,
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  // 台基与地面
  g.add(
    tbox(W + 2 * VR + 1, Y, D + 2 * VR + 1, ochre, 0, Y / 2, 0),
    tbox(W + 2 * VR, 0.04, D + 2 * VR, marble, 0, Y + 0.02, 0),
  );
  // 外廊方石柱（柱间约 5 米）
  const cols = [],
    cw = W / 2 + VR - 0.5,
    cd = D / 2 + VR - 0.5;
  for (let i = 0; i <= 14; i++) {
    const x = -cw + (i * 2 * cw) / 14;
    cols.push([x, cd], [x, -cd]);
  }
  for (let k = 1; k < 10; k++) {
    const z = -cd + (k * 2 * cd) / 10;
    cols.push([cw, z], [-cw, z]);
  }
  g.add(stoneColumns(cols, Y, H, 0.3, MAT.sandstone, MAT.granite));
  // 墙：后墙（北，内侧画壁画）实墙；两侧墙开高窗；正面是一排木框玻璃门
  const wy = Y + H / 2;
  g.add(
    tbox(W, H, 0.4, MAT.plaster, 0, wy, -D / 2),
    tbox(0.4, H, D, MAT.plaster, W / 2, wy, 0),
    tbox(0.4, H, D, MAT.plaster, -W / 2, wy, 0),
  );
  const win = [];
  for (let k = -3; k <= 3; k++)
    win.push(
      M(W / 2 + 0.22, Y + H - 1.3, k * 5.6, 0.06, 1.2, 3.4),
      M(-W / 2 - 0.22, Y + H - 1.3, k * 5.6, 0.06, 1.2, 3.4),
    );
  const doors = [];
  for (let x = -W / 2 + 2.6; x < W / 2 - 2; x += 4.4)
    doors.push(M(x, Y + 1.5, D / 2, 2.6, 3.0, 0.1));
  g.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.window, win, false),
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.doorGlow, doors, false),
  );
  const lintel = [];
  for (let x = -W / 2 + 0.4; x <= W / 2 + 0.1; x += 4.4)
    lintel.push(M(x - 0.2, wy, D / 2, 1.8, H, 0.4));
  g.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.plaster, lintel),
    tbox(W, H - 3.1, 0.4, MAT.plaster, 0, Y + 3.1 + (H - 3.1) / 2, D / 2),
  );
  // 壁画（140×12 英尺 ≈ 42.7×3.7 米）与岩石讲座
  const mur = mesh(
    new THREE.PlaneGeometry(42.7, 3.7),
    MAT.muralM,
    0,
    Y + 2.35,
    -D / 2 + 0.22,
    false,
  );
  g.add(mur);
  const dais = new THREE.Group();
  dais.position.set(0, Y, -D / 2 + 3.2);
  dais.add(tbox(8, 0.35, 3.4, MAT.wood, 0, 0.17, 0));
  for (const [x, z, r, sy] of [
    [-1.6, -0.5, 1.0, 0.7],
    [1.5, -0.6, 1.1, 0.6],
    [0, -0.9, 1.25, 0.9],
    [-0.4, 0.4, 0.8, 0.5],
    [0.8, 0.5, 0.7, 0.45],
  ]) {
    const rk = mesh(
      new THREE.DodecahedronGeometry(r, 0),
      MAT.rock,
      x,
      0.35 + r * sy * 0.6,
      z,
    );
    rk.scale.y = sy;
    dais.add(rk);
  }
  dais.add(tbox(0.9, 1.4, 0.06, MAT.white, 0, 1.6, -0.4)); // 讲座上方的白色小像框
  g.add(dais);
  // 练习垫：一排排深灰色瑜伽垫
  const mats = [];
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 18; c++)
      mats.push(M(-25.5 + c * 3, Y + 0.05, -10 + r * 3.4, 0.62, 0.02, 1.8));
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.darkStone, mats, false));
  // 藻井天花：一圈圈白框层层抬高，框线间是深色缝，灯带沿框排开（剖视时一起掀开）
  const ceil = new THREE.Group();
  asRoof(ceil);
  ceil.add(tbox(W, 0.08, D, ceilM, 0, Y + H - 0.04, 0));
  const lights = [],
    fw = [],
    fb = [];
  const ring = (arr, w, d, t, h, y) =>
    arr.push(
      M(0, y + h / 2, d / 2 - t / 2, w, h, t),
      M(0, y + h / 2, -d / 2 + t / 2, w, h, t),
      M(w / 2 - t / 2, y + h / 2, 0, t, h, d - 2 * t),
      M(-w / 2 + t / 2, y + h / 2, 0, t, h, d - 2 * t),
    );
  for (let i = 0; i < 6; i++) {
    const w = W - 6 - i * 8.6,
      d = D - 5 - i * 6.2,
      y = Y + H + 0.1 + i * 0.32;
    if (w < 6 || d < 4) break;
    ring(fw, w, d, 1.4, 0.3, y);
    ring(fb, w + 0.25, d + 0.25, 0.12, 0.3, y - 0.02);
    for (let k = 0; k < 10; k++)
      lights.push(
        [-w / 2 + (k * w) / 9, y - 0.05, d / 2 - 0.7],
        [-w / 2 + (k * w) / 9, y - 0.05, -d / 2 + 0.7],
      );
  }
  ceil.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), ceilM, fw, false),
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.black, fb, false),
  ); // 全部框线两次 draw call
  ceil.add(glowPoints(lights, 0.9, 0xfff1d6, 0.8));
  g.add(ceil);
  const hl = new THREE.PointLight(0xfff0d8, 30, 60, 1.6);
  hl.position.set(0, Y + H - 1, 0);
  g.add(hl);
  // 屋顶：浅灰低坡四坡顶，出檐盖过外廊；屋脊中央抬高一段天窗
  const roof = new THREE.Group();
  asRoof(roof);
  const rw = W + 2 * VR + 3,
    rd = D + 2 * VR + 3,
    rise = 3.4;
  const hip = mesh(
    new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1, true).rotateY(Math.PI / 4),
    roofM,
    0,
    Y + H + 0.55 + rise / 2,
    0,
  );
  hip.scale.set(rw, rise, rd);
  roof.add(hip);
  roof.add(tbox(rw, 0.25, rd, ceilM, 0, Y + H + 0.45, 0)); // 檐下底板
  const CY = Y + H + 0.55 + rise - 0.4; // 天窗：从屋脊下方升起约 1.8 米
  roof.add(
    tbox(18, 2.2, 9, MAT.plaster, 0, CY + 1.1, 0),
    instanced(
      new THREE.BoxGeometry(1, 1, 1),
      MAT.window,
      [
        M(0, CY + 1.25, 4.52, 15, 0.9, 0.06),
        M(0, CY + 1.25, -4.52, 15, 0.9, 0.06),
      ],
      false,
    ),
  );
  const hip2 = mesh(
    new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4),
    roofM,
    0,
    CY + 2.2 + 0.7,
    0,
  );
  hip2.scale.set(22, 1.4, 13);
  roof.add(hip2);
  g.add(roof);
  g.add(
    glowPoints(
      cols.filter(([, z]) => z > 0).map(([x, z]) => [x, Y + H - 0.4, z + 0.4]),
      3.2,
    ),
  );
  // —— 花园（+Z）——
  const GZ = D / 2 + VR + 1,
    GD = 34,
    GW = 68,
    gz = GZ + GD / 2; // 第十轮由 40×74 缩小：原来西南角压在南北主路上（花园范围本来就是推测）
  const turf = tbox(GW, 0.1, GD, MAT.lawn, 0, 0.05, gz);
  turf.castShadow = false;
  g.add(turf);
  const wallH = 2.6,
    wt = 0.7;
  g.add(
    tbox(wt, wallH, GD, ochre, -GW / 2, wallH / 2, gz),
    tbox(wt, wallH, GD, ochre, GW / 2, wallH / 2, gz),
    tbox(GW / 2 - 4, wallH, wt, ochre, -(GW / 4 + 2), wallH / 2, GZ + GD),
    tbox(GW / 2 - 4, wallH, wt, ochre, GW / 4 + 2, wallH / 2, GZ + GD),
  );
  // 入口木门（敞开）与门边巨石
  for (const sx of [-1, 1]) {
    const d = tbox(3.6, 3.0, 0.15, MAT.wood, sx * 4.2, 1.5, GZ + GD + 1.6);
    d.rotation.y = sx * 1.2;
    g.add(d);
  }
  g.add(
    tbox(1.0, 3.6, 1.0, MAT.wood, -4.4, 1.8, GZ + GD),
    tbox(1.0, 3.6, 1.0, MAT.wood, 4.4, 1.8, GZ + GD),
  );
  const boulder = mesh(
    new THREE.DodecahedronGeometry(1, 1),
    MAT.rock,
    9,
    2.6,
    GZ + GD - 4.5,
  );
  boulder.scale.set(4.2, 3.0, 2.8);
  boulder.rotation.set(0.1, 0.5, 0.18);
  g.add(boulder);
  // 石板小径（入口 → 大厅）
  const slabs = [];
  for (let k = 0; k < 13; k++)
    slabs.push([
      M(
        Math.sin(k * 0.7) * 1.2,
        0.12,
        GZ + GD - 1.5 - k * 3.1,
        2.4 + rnd() * 0.8,
        0.12,
        2.2,
        rnd() * 0.5,
      ),
      0xb9a98e + ((k * 37) % 5) * 0x030303,
    ]);
  g.add(tinted(new THREE.BoxGeometry(1, 1, 1), slabs, 0.95));
  // 莲池：石砌池岸
  const PX = 15,
    PZ = GZ + GD - 9;
  g.add(
    tcyl(6.4, 6.6, 0.5, 28, MAT.granite, PX, 0.12, PZ),
    mesh(
      new THREE.CircleGeometry(5.8, 28).rotateX(-Math.PI / 2),
      MAT.pondWater,
      PX,
      0.4,
      PZ,
      false,
    ),
  );
  const pads = [];
  for (let i = 0; i < 26; i++) {
    const a = rnd() * 6.28,
      r = rnd() * 5.2;
    pads.push(
      M(
        PX + Math.cos(a) * r,
        0.43,
        PZ + Math.sin(a) * r,
        0.5 + rnd() * 0.3,
        0.02,
        0.5 + rnd() * 0.3,
      ),
    );
  }
  g.add(
    instanced(new THREE.CylinderGeometry(1, 1, 1, 10), MAT.pad, pads, false),
  );
  // 三座石柱小亭，沿西墙一字排开
  const slabRoof = new THREE.MeshStandardMaterial({
    map: TEX.stone,
    color: 0xa65f45,
    roughness: 0.9,
  });
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Group();
    m.position.set(-GW / 2 + 6, 0, GZ + 8 + i * 9.5);
    m.add(
      tbox(5.6, 0.4, 5.6, slabRoof, 0, 0.2, 0),
      stoneColumns(
        [
          [-2, -2],
          [2, -2],
          [-2, 2],
          [2, 2],
        ],
        0.4,
        3.0,
        0.24,
        MAT.sandstone,
      ),
      tbox(5.8, 0.12, 5.8, MAT.sandstone, 0, 3.46, 0),
      tbox(6.2, 0.3, 6.2, slabRoof, 0, 3.67, 0),
    );
    g.add(m);
  }
  // 草坪上的长条木凳
  const bench = [];
  for (const [x, z] of [
    [-14, GZ + 12],
    [-14, GZ + 22],
    [0, GZ + 30],
    [22, GZ + 18],
    [26, GZ + 28],
  ])
    bench.push(
      M(x, 0.42, z, 3, 0.12, 0.5),
      M(x - 1.2, 0.2, z, 0.3, 0.4, 0.4),
      M(x + 1.2, 0.2, z, 0.3, 0.4, 0.4),
    );
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.wood, bench));
  return g;
}

// —— Sarpa Vasal（蛇门）：Narasipuram Road 边的入口。灰花岗岩层层内收的门框、红砖镶边、两侧毛石墙，顶上赤陶色筒拱，门洞正中立着黑色眼镜蛇 ——
function createSarpaVasal() {
  const g = new THREE.Group(),
    endM = MAT.salmon.clone();
  endM.map = null;
  for (const sx of [-1, 1]) {
    g.add(
      tbox(2.6, 9, 4.4, MAT.granite, sx * 8.6, 4.5, 0),
      tbox(1.3, 8.4, 3.4, MAT.granite, sx * 7.0, 4.2, 0.4),
      tbox(0.7, 9, 0.5, MAT.brick, sx * 10.2, 4.5, 2.0),
      tbox(13, 5.6, 2.2, MAT.sandstone, sx * 16.6, 2.8, -0.6),
      tbox(13, 1.6, 1.4, MAT.brick, sx * 16.6, 6.4, -0.8),
      tbox(5, 3.6, 3, MAT.sandstone, sx * 12.6, 1.8, 1.4),
    );
    const gate = [];
    for (let i = 0; i < 9; i++)
      gate.push(M(sx * (2.4 + i * 0.5), 2.2, -0.4, 0.09, 4.4, 0.09));
    g.add(
      instanced(new THREE.BoxGeometry(1, 1, 1), MAT.black, gate),
      tbox(4.4, 0.12, 0.12, MAT.black, sx * 4.4, 4.4, -0.4),
    );
  }
  g.add(
    tbox(19.8, 1.5, 4.4, MAT.granite, 0, 9.75, 0),
    tbox(17, 0.9, 3.6, MAT.granite, 0, 8.6, 0.3),
    tbox(21, 0.5, 5, MAT.brick, 0, 10.75, 0),
  );
  const v = vaultRoof(8, 21.5, 2.3, MAT.salmon, endM);
  v.rotation.y = Math.PI / 2;
  v.position.set(0, 11, 0);
  g.add(v);
  // 蛇柱：自地面盘旋而上，蛇兜高过门楣
  const sp = [];
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * Math.PI * 2.2;
    sp.push(
      new V3(
        Math.sin(a) * (1.9 - i * 0.07),
        0.55 + i * 0.03,
        2.6 + Math.cos(a) * (1.3 - i * 0.05),
      ),
    );
  } // 地面上的一圈盘身
  for (let i = 1; i <= 16; i++) {
    const t = i / 16;
    sp.push(
      new V3(
        Math.sin(t * 5.2 + 1.2) * 0.95 * (1 - t * 0.75),
        1.0 + t * 6.2,
        2.6 + (1 - t) * 0.4,
      ),
    );
  } // 蛇身 S 形升起
  g.add(
    mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sp), 110, 0.6, 10),
      MAT.black,
    ),
  );
  const hood = mesh(
    new THREE.SphereGeometry(1, 16, 12),
    MAT.black,
    0,
    8.0,
    2.75,
  );
  hood.scale.set(2.1, 2.5, 0.5);
  hood.rotation.x = 0.1;
  const cobraFace = mesh(
    new THREE.SphereGeometry(1, 12, 10),
    MAT.black,
    0,
    9.3,
    3.25,
  );
  cobraFace.scale.set(0.75, 0.6, 0.85);
  g.add(hood, cobraFace, tcyl(2.6, 2.9, 0.35, 24, MAT.darkStone, 0, 0.17, 2.6));
  for (const sx of [-1, 1])
    g.add(
      mesh(
        new THREE.TorusGeometry(0.42, 0.07, 6, 16),
        MAT.goldTrim,
        sx * 0.85,
        8.3,
        3.22,
        false,
      ),
    ); // 蛇兜上的眼镜纹
  const pvm = tbox(40, 0.14, 26, MAT.paving, 0, 0.09, 6);
  pvm.castShadow = false;
  g.add(pvm);
  for (const sx of [-1, 1])
    g.add(
      tbox(3.2, 0.9, 0.08, MAT.black, sx * 5.2, 0.9, 9),
      tbox(3, 0.5, 0.06, MAT.goldTrim, sx * 5.2, 0.95, 9.05),
    ); // 路障
  // 门内左侧的 Information Center 小亭、门外的 ATM
  const info = house(7, 5, 3, { roof: 'hip', rise: 1.8, win: 2, plinth: 0.3 });
  info.position.set(-14, 0, -9);
  g.add(info);
  const ib = signBoard('Information Center', 5.6, 0.8);
  ib.position.set(-14, 3.2, -6.3);
  g.add(ib);
  g.add(
    glowPoints(
      [
        [-7, 3.4, 2.6],
        [7, 3.4, 2.6],
        [-16, 3.4, 1.2],
        [16, 3.4, 1.2],
        [0, 9.2, 3.2],
      ],
      4.5,
    ),
  );
  return g;
}

// —— 莲池：Nandi 与 Suryakund 之间的一片葫芦形水池（轮廓取自 OSM），腰部横跨一座白色拱桥；北面还有一方圆池 ——
// 本组件不旋转，轮廓点直接用 (东, 北) 实测坐标书写，原点在 (112, -14)
function createLotusPonds() {
  const g = new THREE.Group(),
    O = [112, -14],
    L = ([e, n]) => [e - O[0], -(n - O[1])];
  const south = [
    [98, -10],
    [97, -18],
    [94, -24],
    [93, -31],
    [96, -38],
    [99, -40],
    [106, -43],
    [112, -42],
    [116, -40],
    [118, -35],
    [117, -30],
    [113, -25],
    [110, -20],
    [111, -12],
    [115, -6],
    [120, -5],
    [126, -8],
    [130, -7],
    [134, -3],
    [134, 3],
    [131, 8],
    [127, 13],
    [119, 15],
    [114, 15],
    [111, 13],
    [108, 10],
    [104, 6],
    [99, 3],
    [96, 0],
    [96, -6],
  ].map(L);
  const rocks = [],
    pads = [],
    pink = [],
    white = [];
  for (const poly of [south]) {
    g.add(polyPlane(poly, MAT.pondWater, 0.14));
    for (let i = 0; i < poly.length; i++) {
      // 岸边压着大石块
      const [x1, z1] = poly[i],
        [x2, z2] = poly[(i + 1) % poly.length],
        len = Math.hypot(x2 - x1, z2 - z1),
        n = Math.ceil(len / 1.5);
      for (let k = 0; k < n; k++) {
        const t = (k + rnd() * 0.6) / n,
          s = rr(0.5, 1.15);
        rocks.push(
          M(
            lerp(x1, x2, t) + rr(-0.4, 0.4),
            0.18,
            lerp(z1, z2, t) + rr(-0.4, 0.4),
            s * rr(0.9, 1.5),
            s * 0.6,
            s,
            rnd() * 6,
          ),
        );
      }
    }
    const xs = poly.map((p) => p[0]),
      zs = poly.map((p) => p[1]);
    for (let i = 0; i < 520; i++) {
      const x = rr(Math.min(...xs), Math.max(...xs)),
        z = rr(Math.min(...zs), Math.max(...zs));
      if (!inPoly(x, z, poly) || (Math.abs(z - 0.5) < 3 && x < 2)) continue;
      pads.push(M(x, 0.17, z, rr(0.35, 0.8), 1, rr(0.35, 0.8), rnd() * 6));
      if (i % 5 === 0)
        (i % 10 ? pink : white).push(M(x + 0.3, 0.36, z, 1, 1, 1, rnd() * 6));
    }
  }
  const flower = mergeGeos([
    new THREE.ConeGeometry(0.2, 0.42, 6).rotateX(Math.PI),
    new THREE.ConeGeometry(0.34, 0.2, 8, 1, true)
      .rotateX(Math.PI)
      .translate(0, -0.08, 0),
  ]);
  g.add(
    instanced(new THREE.IcosahedronGeometry(1, 0), MAT.rock, rocks),
    instanced(
      new THREE.CylinderGeometry(1, 1, 0.03, 9, 1, false, 0, 5.6),
      MAT.pad,
      pads,
      false,
    ),
    instanced(flower, MAT.lotus, pink, false),
    instanced(flower, MAT.lotusW, white, false),
  );
  // 白色拱桥：自 Nandi 广场 (94,-13) 跨过池腰到 (114,-16)，长约 21 m、宽 3.4 m
  const a = L([93.5, -12.6]),
    b = L([114.5, -16.2]),
    BL = Math.hypot(b[0] - a[0], b[1] - a[1]),
    br = new THREE.Group();
  br.position.set((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
  br.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  const arc = (h0, hp, x0) => {
    const s = new THREE.Shape();
    s.moveTo(-BL / 2, h0);
    s.quadraticCurveTo(0, h0 + hp * 2, BL / 2, h0);
    s.lineTo(BL / 2 - x0, h0 - 0.45);
    s.quadraticCurveTo(0, h0 + hp * 2 - 0.9, -BL / 2 + x0, h0 - 0.45);
    s.closePath();
    return s;
  };
  br.add(
    mesh(
      new THREE.ExtrudeGeometry(arc(0.3, 1.15, 3), {
        depth: 3.4,
        bevelEnabled: false,
      }),
      MAT.white,
      0,
      0,
      -1.7,
    ),
  );
  for (const z of [-1.82, 1.6])
    br.add(
      mesh(
        new THREE.ExtrudeGeometry(arc(1.15, 1.15, 0.1), {
          depth: 0.22,
          bevelEnabled: false,
        }),
        MAT.white,
        0,
        0,
        z,
      ),
    );
  for (const sx of [-1, 1])
    br.add(
      tbox(2.6, 0.3, 3.6, MAT.white, sx * (BL / 2 + 1.1), 0.15, 0),
      tbox(0.5, 1.4, 0.5, MAT.white, (sx * BL) / 2, 0.7, 1.72),
      tbox(0.5, 1.4, 0.5, MAT.white, (sx * BL) / 2, 0.7, -1.72),
    );
  const bl = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6,
      x = -BL / 2 + t * BL,
      y = 1.5 + 2.3 * 2 * t * (1 - t);
    bl.push([x, y, 1.8], [x, y, -1.8]);
  }
  br.add(glowPoints(bl, 1.8));
  g.add(br);
  // 神庙区的石板地：从入口两翼一直铺到 Suryakund 西立面，莲池嵌在其中（实地没有草坪）
  const plaza = polyPlane(
    [
      [22, -52],
      [150, -60],
      [150, 20],
      [130, 26],
      [62, 28],
      [22, 24],
    ].map(L),
    MAT.paving,
    0.06,
  );
  plaza.receiveShadow = true;
  g.add(plaza);
  // 池边的石凳
  for (const [e, n] of [
    [124, 19],
    [137, 0],
    [103, -47],
    [90, 30],
  ]) {
    const [x, z] = L([e, n]);
    g.add(tbox(2.2, 0.45, 0.7, MAT.granite, x, 0.3, z));
  }
  return g;
}

// —— Naga Shrine：Suryakund 东侧台阶顶上的黑色巨石，石面上雕着相缠的眼镜蛇（一条昂首、红色蛇兜）——
function createNagaShrine() {
  const g = new THREE.Group();
  g.add(
    tbox(5.2, 0.5, 3.4, MAT.granite, 0, 0.25, 0),
    tbox(4.4, 0.3, 2.6, MAT.darkStone, 0, 0.65, 0),
  );
  const rg = new THREE.BoxGeometry(3.6, 3.2, 1.3, 6, 6, 3),
    rp = rg.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i),
      y = rp.getY(i),
      z = rp.getZ(i),
      n = (vnoise(x * 2.1 + 5, y * 2.1) - 0.5) * 0.28;
    rp.setXYZ(
      i,
      x * (1 - (0.1 * (y + 1.6)) / 3.2) + n,
      y + n * 0.6,
      z + (z > 0 ? n * 0.5 : n),
    );
  }
  rg.computeVertexNormals();
  const rockM = new THREE.MeshStandardMaterial({
    color: 0x1c1a1c,
    roughness: 0.85,
    flatShading: true,
  });
  g.add(mesh(rg, rockM, 0, 2.4, -0.2));
  // 两条蛇：贴着石面的浮雕
  const snake = (pts, r) =>
    mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(pts.map(([x, y]) => new V3(x, y, 0.52))),
        60,
        r,
        8,
      ),
      MAT.black,
    );
  g.add(
    snake(
      [
        [1.2, 1.1],
        [0.2, 1.3],
        [-0.9, 1.7],
        [-1.2, 2.5],
        [-0.6, 3.1],
        [0.1, 2.8],
        [-0.1, 2.2],
        [-0.6, 2.3],
      ],
      0.2,
    ),
    snake(
      [
        [-1.3, 1.2],
        [-0.3, 1.5],
        [0.7, 1.4],
        [1.25, 2.0],
        [1.1, 2.9],
        [0.5, 3.3],
      ],
      0.17,
    ),
  );
  const hood = mesh(
    new THREE.SphereGeometry(1, 12, 10),
    MAT.black,
    -0.62,
    3.05,
    0.55,
  );
  hood.scale.set(0.48, 0.6, 0.14);
  const hoodIn = mesh(
    new THREE.SphereGeometry(1, 10, 8),
    MAT.red,
    -0.62,
    3.0,
    0.66,
    false,
  );
  hoodIn.scale.set(0.26, 0.36, 0.05);
  const hood2 = mesh(
    new THREE.SphereGeometry(1, 12, 10),
    MAT.black,
    0.42,
    3.38,
    0.55,
  );
  hood2.scale.set(0.3, 0.36, 0.12);
  g.add(hood, hoodIn, hood2);
  // 花环、红布、铜灯与三只盛着绿叶的铜盆
  const gar = mesh(
    new THREE.TorusGeometry(1.75, 0.06, 6, 40, Math.PI),
    MAT.lotusW,
    0,
    3.7,
    0.62,
    false,
  );
  gar.rotation.z = Math.PI;
  gar.scale.y = 1.25;
  g.add(gar);
  for (const sx of [-1, 1]) {
    g.add(
      mesh(
        new THREE.PlaneGeometry(0.5, 3),
        MAT.sariRed,
        sx * 2.05,
        2.3,
        0.3,
        false,
      ),
      tcyl(0.05, 0.14, 1.3, 8, MAT.gold, sx * 1.9, 1.45, 1.0),
      tcyl(0.22, 0.1, 0.12, 10, MAT.gold, sx * 1.9, 2.15, 1.0),
    );
  }
  for (const x of [-1.1, 0, 1.1])
    g.add(
      tcyl(0.42, 0.3, 0.3, 14, MAT.gold, x, 0.95, 1.05),
      tcyl(0.38, 0.38, 0.04, 12, MAT.pad, x, 1.09, 1.05),
    );
  g.add(
    glowPoints(
      [
        [-1.9, 2.3, 1.0],
        [1.9, 2.3, 1.0],
      ],
      2.2,
    ),
    pointLight(0xffa050, 60, 18, 0, 2.2, 2.2),
  );
  g.scale.setScalar(1.25);
  return g;
}

// —— Deposit Counter：手机 / 行李寄存处（园区内不许用手机），在 Chandrakund 东北；旁边是鞋架 ——
function createDepositCounter() {
  const g = new THREE.Group();
  g.add(
    house(13, 6, 3.1, {
      win: 0,
      plinth: 0.35,
      rise: 1.9,
      veranda: 2.6,
      colMat: MAT.concrete,
    }),
  );
  g.add(
    tbox(11, 1.1, 0.7, MAT.wood, 0, 0.9, 3.2),
    tbox(11.4, 0.08, 1, MAT.darkStone, 0, 1.48, 3.2),
    tbox(11, 1.5, 0.12, MAT.black, 0, 2.3, 3.02),
  ); // 柜台与窗口
  const lock = [];
  for (let i = 0; i < 12; i++)
    for (let k = 0; k < 4; k++)
      lock.push(M(-5 + i * 0.9, 0.9 + k * 0.55, 2.4, 0.8, 0.48, 0.5));
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.metalRoof, lock, false));
  const sb = signBoard('Deposit Counter', 6.4, 1.0);
  sb.position.set(0, 3.75, 5.7);
  g.add(sb);
  // 鞋架：三排木架，上面盖一片瓦顶
  const rk = new THREE.Group();
  rk.position.set(0, 0, 10);
  const sh = [];
  for (let r = 0; r < 3; r++)
    for (let k = 0; k < 4; k++)
      sh.push(M(0, 0.35 + k * 0.4, -3 + r * 3, 7, 0.05, 0.9));
  rk.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.wood, sh),
    columns(
      [
        [-3.6, -3.8],
        [3.6, -3.8],
        [-3.6, 3.8],
        [3.6, 3.8],
      ],
      0,
      2.6,
      0.1,
      MAT.wood,
      true,
    ),
    asRoof(tbox(8.4, 0.15, 8.8, MAT.tile, 0, 2.7, 0)),
  );
  g.add(
    rk,
    glowPoints(
      [
        [-4, 2.8, 5],
        [4, 2.8, 5],
      ],
      3.5,
    ),
  );
  return g;
}

// 竹篾编的屏风墙贴图（Welcome Point 的柜台棚用）
let _bambooMat;
function bambooMat() {
  if (_bambooMat) return _bambooMat;
  const t = canvasTex(128, (g, s) => {
    for (let x = 0; x < s; x += 8) {
      g.fillStyle = `hsl(${34 + TR() * 6},${30 + TR() * 12}%,${44 + TR() * 14}%)`;
      g.fillRect(x, 0, 7, s);
      g.fillStyle = 'rgba(40,25,10,.55)';
      g.fillRect(x + 7, 0, 1, s);
    }
    g.fillStyle = 'rgba(40,25,10,.4)';
    for (let y = 0; y < s; y += 32) g.fillRect(0, y, s, 2);
  });
  _bambooMat = new THREE.MeshStandardMaterial({
    map: t,
    color: 0xd9c49c,
    roughness: 0.9,
  });
  return _bambooMat;
}
// 四坡瓦顶（深灰 Mangalore 瓦），出檐 eave 米
function hipRoof(w, d, rise, y, mat, eave = 1.2) {
  const c = mesh(
    new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4),
    mat,
    0,
    y + rise / 2,
    0,
  );
  c.scale.set(w + 2 * eave, rise, d + 2 * eave);
  return asRoof(c);
}

// —— Welcome Point：访客登记、志愿者接待、班车和牛车的起点（Google 地图上的 “Welcome Point - Isha Cottages”，访客照片可见）。
//    几座低矮的柜台棚：深灰色瓦的四坡顶、宽出檐、深色钢柱，背墙和侧墙是竹篾屏风，里面是黄墙和带编号的登记窗口；
//    后面是一栋赭橙色抹灰的两层楼；棚前一根雕着人面的石柱；路边是木条吊顶、深色金属檐口的上下客雨棚。正面朝 +Z（主路） ——
function createWelcomePoint() {
  const g = new THREE.Group();
  const tileGrey = new THREE.MeshStandardMaterial({
    color: 0x55585c,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  const orange = new THREE.MeshStandardMaterial({
    map: TEX.plaster,
    color: 0xd8793e,
    roughness: 0.92,
  });
  const yellow = new THREE.MeshStandardMaterial({
    map: TEX.plaster,
    color: 0xe0b347,
    roughness: 0.9,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: 0x2b2b2e,
    roughness: 0.5,
    metalness: 0.5,
  });
  g.add(tbox(30, 0.15, 26, MAT.paving, 0, 0.075, 0));
  // 后面的两层楼
  const B = new THREE.Group();
  B.position.set(-2, 0, -9);
  B.add(
    tbox(22, 6.6, 7, orange, 0, 3.3, 0),
    tbox(22.4, 0.25, 7.4, MAT.redPlaster, 0, 3.4, 0),
    hipRoof(22, 7, 2.2, 6.6, MAT.tile, 0.9),
  );
  const bw = [];
  for (let i = 0; i < 6; i++)
    bw.push(M(-9 + i * 3.6, 4.9, 3.53, 1.4, 1.3, 0.06));
  B.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.window, bw, false));
  g.add(B);
  // 两座柜台棚
  const nums = ['21', '22', '23', '24'];
  for (const [cx, cz, i0] of [
    [-6.5, 0, 0],
    [6.5, 1.2, 2],
  ]) {
    const P = new THREE.Group();
    P.position.set(cx, 0.15, cz);
    const w = 11,
      d = 7,
      h = 2.9;
    P.add(tbox(w, 0.25, d, MAT.granite, 0, 0.12, 0));
    P.add(
      tbox(w, h, 0.12, bambooMat(), 0, h / 2 + 0.25, -d / 2),
      tbox(0.12, h, d, bambooMat(), -w / 2, h / 2 + 0.25, 0),
      tbox(0.12, h, d, bambooMat(), w / 2, h / 2 + 0.25, 0),
    );
    // 中间一间黄墙的登记室，正面开两个窗口
    P.add(
      tbox(6.4, h, 0.2, yellow, 0, h / 2 + 0.25, -0.6),
      tbox(0.2, h, 2.6, yellow, -3.2, h / 2 + 0.25, -1.9),
      tbox(0.2, h, 2.6, yellow, 3.2, h / 2 + 0.25, -1.9),
    );
    for (const k of [0, 1]) {
      const x = -1.6 + k * 3.2;
      P.add(
        mesh(
          new THREE.PlaneGeometry(1.8, 1.1),
          MAT.window,
          x,
          1.8,
          -0.48,
          false,
        ),
        tbox(2.2, 0.08, 0.6, MAT.darkStone, x, 1.25, -0.25),
      );
      const sb = signBoard(nums[i0 + k], 0.55, 0.42, '#1d2a4a', '#e8eefc');
      sb.position.set(x, 2.75, -0.46);
      P.add(sb);
    }
    P.add(
      columns(
        [
          [-w / 2, d / 2],
          [w / 2, d / 2],
          [0, d / 2],
          [-w / 2, -d / 2],
          [w / 2, -d / 2],
        ],
        0.25,
        h,
        0.09,
        steel,
        true,
      ),
    );
    P.add(hipRoof(w, d, 1.7, h + 0.25, tileGrey, 1.4));
    // 等候的木长凳
    P.add(
      instanced(new THREE.BoxGeometry(1, 1, 1), MAT.wood, [
        M(-3, 0.7, 2.2, 3, 0.1, 0.45),
        M(3, 0.7, 2.2, 3, 0.1, 0.45),
        M(-3, 0.45, 2.2, 0.1, 0.5, 0.4),
        M(3, 0.45, 2.2, 0.1, 0.5, 0.4),
      ]),
    );
    g.add(P);
  }
  // 雕人面的石柱
  g.add(
    tbox(0.8, 1.7, 0.8, MAT.sandstone, 0.2, 0.85, 6.2),
    tbox(1.0, 0.18, 1.0, MAT.sandstone, 0.2, 1.75, 6.2),
  );
  const mask = mesh(
    new THREE.SphereGeometry(1, 12, 10),
    MAT.sandstone,
    0.2,
    1.15,
    6.62,
  );
  mask.scale.set(0.28, 0.38, 0.08);
  g.add(mask);
  g.add(
    signBoard('Welcome Point', 4.2, 0.8)
      .translateX(-6)
      .translateY(3.9)
      .translateZ(7.4),
  );
  // 路边的上下客雨棚：木条吊顶 + 深色金属檐口
  const C = new THREE.Group();
  C.position.set(4, 0, 10.5);
  C.add(
    columns(
      [
        [-6.5, -2.8],
        [6.5, -2.8],
        [-6.5, 2.8],
        [6.5, 2.8],
      ],
      0,
      3.6,
      0.13,
      steel,
      true,
    ),
  );
  C.add(
    asRoof(tbox(14.6, 0.08, 7.0, MAT.wood, 0, 3.62, 0)),
    asRoof(
      tbox(
        15,
        0.55,
        7.4,
        new THREE.MeshStandardMaterial({
          color: 0x4a2a22,
          roughness: 0.6,
          metalness: 0.4,
        }),
        0,
        3.95,
        0,
      ),
    ),
  );
  g.add(C);
  // 雨棚下：等客的电瓶班车和牛车
  const cart = new THREE.Group();
  cart.position.set(0.5, 0, 10.5);
  cart.rotation.y = Math.PI / 2;
  cart.add(
    tbox(1.4, 0.7, 3.2, MAT.white, 0, 0.75, 0),
    tbox(1.3, 0.5, 0.9, MAT.wood, 0, 1.25, 0.6),
    tbox(1.3, 0.5, 0.9, MAT.wood, 0, 1.25, -0.6),
    tbox(1.5, 0.06, 3.3, MAT.white, 0, 2.15, 0),
    columns(
      [
        [-0.65, -1.5],
        [0.65, -1.5],
        [-0.65, 1.5],
        [0.65, 1.5],
      ],
      1.1,
      1.05,
      0.03,
      steel,
    ),
  );
  for (const [x, z] of [
    [-0.72, 1.1],
    [0.72, 1.1],
    [-0.72, -1.1],
    [0.72, -1.1],
  ]) {
    const wh = mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.18, 12).rotateZ(Math.PI / 2),
      MAT.black,
      x,
      0.28,
      z,
    );
    cart.add(wh);
  }
  // 停着等客的牛车（与路上走的牛车同一个模型，只有赶车人）；车头朝西北，车尾在雨棚下
  const ox = oxCart({ horn: 0x2f7d4a, riders: 0, shadow: true });
  ox.position.set(9, 0, 10.5);
  ox.rotation.y = -Math.PI / 2;
  // 雨棚下等车的人
  const wait = [];
  for (let i = 0; i < 7; i++)
    wait.push(
      folk(pr(-2.5, 10.5), 0, pr(12.8, 13.8), pr(-0.6, 0.6) + Math.PI, 's'),
    );
  g.add(
    cart,
    ox,
    crowd(wait),
    glowPoints(
      [
        [-6.5, 2.6, 2],
        [6.5, 2.6, 3.2],
        [4, 3.3, 10.5],
      ],
      4,
    ),
  );
  return g;
}

// —— Sadhana Hall 1 / 2：Dhyanalinga 西侧一栋连体的两层长楼（约 64 × 16 m，南端紧挨 Linga Bhairavi）。
//    一楼沿东侧柱廊是一排房间：南头 Devi Office、Ritual Office（Linga Bhairavi 的登记与仪式预约），往北是楼梯与其他办公室；
//    二楼是两间修习厅：南边 Sadhana Hall 2、北边 Sadhana Hall 1（每天的 Darshan、Aumkar 启蒙、女众清晨练习），屋顶是一排横向的小筒拱。
//    航拍可见这栋楼的筒拱屋顶；一楼房间的具体排布是按用户描述推测的。局部 +X 朝北、+Z 朝东（正面） ——
function createSadhanaHalls() {
  const g = new THREE.Group(),
    L = 64,
    Wd = 15,
    H1 = 3.6,
    H2 = 4.4,
    Y = 0.5,
    F2 = Y + H1 + 0.3;
  const endM = MAT.concrete.clone();
  endM.map = null;
  endM.side = THREE.DoubleSide;
  g.add(tbox(L + 2, Y, Wd + 5, MAT.granite, 0, Y / 2, 1.8));
  // 一楼：后墙 + 房间隔墙 + 朝东的柱廊
  g.add(
    tbox(L, H1, 0.3, MAT.white, 0, Y + H1 / 2, -Wd / 2),
    tbox(0.3, H1, Wd, MAT.white, -L / 2, Y + H1 / 2, 0),
    tbox(0.3, H1, Wd, MAT.white, L / 2, Y + H1 / 2, 0),
  );
  const rooms = [
    [-28, 8, 'Devi Office', '#5a1214', '#f3d9a0'],
    [-19.5, 8, 'Ritual Office', '#5a1214', '#f3d9a0'],
    [-10.5, 7, '', 0, 0],
    [-2, 7, 'Stairs', 0, 0],
    [7, 8, '', 0, 0],
    [16, 8, '', 0, 0],
    [25, 10, '', 0, 0],
  ];
  const win = [],
    doors = [];
  for (const [cx, w, name, bg, fg] of rooms) {
    g.add(tbox(0.25, H1, Wd - 3, MAT.white, cx - w / 2, Y + H1 / 2, -1.5));
    if (name === 'Stairs') {
      g.add(
        stairs(
          3,
          12,
          0.32,
          0.32,
          MAT.granite,
          cx,
          F2 - 0.3,
          -Wd / 2 + 1.2,
          1,
          Y,
        ),
      );
      continue;
    }
    g.add(tbox(w - 0.3, H1, 0.25, MAT.white, cx, Y + H1 / 2, Wd / 2 - 3));
    doors.push(M(cx - w / 4, Y + 1.2, Wd / 2 - 2.86, 1.2, 2.3, 0.06));
    win.push(M(cx + w / 5, Y + 1.7, Wd / 2 - 2.86, 2.2, 1.3, 0.06));
    if (name) {
      const b = signBoard(name, 3.4, 0.6, bg, fg);
      b.position.set(cx, Y + 2.85, Wd / 2 - 2.7);
      g.add(b);
      g.add(tbox(2.6, 0.95, 0.8, MAT.wood, cx + 1, Y + 0.48, Wd / 2 - 4.3));
    }
  }
  g.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.window, win, false),
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.wood, doors, false),
  );
  // 二楼楼板与外廊、二楼墙、两间厅的分隔墙
  g.add(
    tbox(L + 0.6, 0.3, Wd + 0.6, MAT.concrete, 0, F2 - 0.15, 0),
    tbox(L, 0.9, 0.12, MAT.white, 0, F2 + 0.45, Wd / 2 + 0.2),
  );
  g.add(
    tbox(L, H2, 0.3, MAT.white, 0, F2 + H2 / 2, -Wd / 2),
    tbox(0.3, H2, Wd - 3, MAT.white, -L / 2, F2 + H2 / 2, -1.5),
    tbox(0.3, H2, Wd - 3, MAT.white, L / 2, F2 + H2 / 2, -1.5),
    tbox(L, H2, 0.3, MAT.white, 0, F2 + H2 / 2, Wd / 2 - 3),
    tbox(0.3, H2, Wd - 3, MAT.white, -4.5, F2 + H2 / 2, -1.5),
  );
  const hw = [];
  for (let x = -29; x <= 29; x += 5.3)
    hw.push(M(x, F2 + 2.2, Wd / 2 - 2.84, 2.6, 2.2, 0.08));
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.window, hw, false));
  const cols = [];
  for (let x = -L / 2 + 1; x <= L / 2 - 1; x += 5.25) cols.push([x, Wd / 2]);
  g.add(columns(cols, Y, H1 + 0.3 + H2 + 0.2, 0.18, MAT.concrete, true));
  // 屋顶：一排横向的小筒拱
  for (let i = 0; i < 12; i++) {
    const v = asRoof(vaultRoof(5.3, Wd + 1, 1.8, MAT.concrete, endM));
    v.position.set(-L / 2 + 2.65 + i * 5.3, F2 + H2, 0);
    g.add(v);
  }
  // 二楼厅内：1 号厅（北）有讲台和成排的练习垫，2 号厅（南）较空
  g.add(
    tbox(9, 0.5, 3, MAT.wood, 26, F2 + 0.25, -4.6),
    tbox(9.4, 0.06, 3.4, MAT.sariRed, 26, F2 + 0.53, -4.6),
  );
  const mats = [];
  for (let x = -2.5; x <= 30; x += 1.6)
    for (let z = -4.8; z <= 3; z += 1.7)
      if (!(x > 21 && z < -2)) mats.push(M(x, F2 + 0.02, z, 0.7, 0.03, 1.4));
  for (let x = -29; x <= -7; x += 4)
    mats.push(M(x, F2 + 0.02, -1, 2.6, 0.03, 7));
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.straw, mats, false));
  [
    [-18, 'Sadhana Hall 2'],
    [14, 'Sadhana Hall 1'],
  ].forEach(([x, n]) => {
    const b = signBoard(n, 5.4, 0.9);
    b.position.set(x, F2 + H2 - 0.6, Wd / 2 - 2.6);
    g.add(b);
  });
  const li = [];
  for (let x = -30; x <= 30; x += 10) li.push([x, Y + H1 - 0.3, Wd / 2 - 1.2]);
  g.add(glowPoints(li, 3.5));
  return g;
}

// —— Moondram Pirai Eatery（“初三的月牙”）：Sarpa Vasal 南侧、路对面的餐厅，约 36 × 24 m。
//    室内参照访客照片：白墙、白色钢桁架顶、浅色地砖、黑色铁艺桌椅、自助取餐台、墙上的 Devi 像；招牌的锥形 dosa。外观没找到照片，是推测 ——
function createMoondramPirai() {
  const g = new THREE.Group(),
    W = 34,
    D = 22,
    Y = 0.4,
    H = 4.6;
  const tile = new THREE.MeshStandardMaterial({
    map: TEX.paving,
    color: 0xf1ece2,
    roughness: 0.35,
  });
  tile.userData.s = 2.4;
  g.add(
    tbox(W + 2, Y, D + 10, MAT.granite, 0, Y / 2, 4),
    tbox(W - 0.4, 0.04, D - 0.4, tile, 0, Y + 0.02, 0),
  );
  // 四面白墙：正面中间是 9 m 宽的敞开门洞，墙上一条横向长窗
  g.add(tbox(W, H, 0.3, MAT.white, 0, Y + H / 2, -D / 2));
  for (const sx of [-1, 1])
    g.add(
      tbox(0.3, H, D, MAT.white, (sx * W) / 2, Y + H / 2, 0),
      tbox(
        W / 2 - 4.5,
        H,
        0.3,
        MAT.white,
        sx * (W / 4 + 2.25),
        Y + H / 2,
        D / 2,
      ),
      tbox(0.06, 0.9, D - 4, MAT.window, sx * (W / 2 + 0.17), Y + 2.9, 0),
      tbox(
        W / 2 - 7,
        0.9,
        0.06,
        MAT.window,
        sx * (W / 4 + 2.4),
        Y + 2.9,
        D / 2 + 0.17,
      ),
    );
  g.add(tbox(9, 1.0, 0.3, MAT.white, 0, Y + H - 0.5, D / 2));
  // 屋顶：白色钢桁架 + 浅色屋面板（低坡）
  const roof = new THREE.Group();
  asRoof(roof);
  roof.add(gableRoof(D + 3, W + 3, 2.6, Y + H, MAT.metalRoof, MAT.white));
  const bars = [];
  for (let x = -W / 2 + 2; x <= W / 2 - 2; x += 5) {
    bars.push(M(x, Y + H, 0, 0.1, 0.1, D));
    for (let k = -4; k <= 4; k++)
      bars.push(
        M(
          x,
          Y + H + 0.55 - Math.abs(k) * 0.02,
          k * 2.3,
          0.07,
          1.2 - Math.abs(k) * 0.12,
          0.07,
          0,
          k % 2 ? 0.6 : -0.6,
        ),
      );
  }
  roof.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.white, bars, false));
  g.add(roof);
  const fans = [];
  for (let x = -12; x <= 12; x += 8)
    for (const z of [-3, 5])
      fans.push(
        M(x, Y + H - 0.5, z, 1.5, 0.03, 0.14),
        M(x, Y + H - 0.5, z, 0.14, 0.03, 1.5),
        M(x, Y + H - 0.25, z, 0.05, 0.5, 0.05),
      );
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.metalRoof, fans, false));
  // 黑色铁艺桌椅（四人桌），桌上摆着锥形 dosa、不锈钢杯和盘子
  const iron = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.45,
      metalness: 0.5,
    }),
    sets = [],
    dosa = [],
    plates = [],
    cups = [];
  for (let x = -14; x <= 14; x += 3.5)
    for (let z = -2.6; z <= 8.2; z += 2.7) {
      if (Math.abs(x) < 2 && z > 5) continue;
      sets.push([x, z]);
      if (hash((x * 3) | 0, (z * 3) | 0) < 0.6) {
        dosa.push(M(x - 0.25, Y + 0.98, z, 1, 1, 1, 0, 0, 0));
        plates.push(M(x - 0.25, Y + 0.795, z, 1, 1, 1));
        cups.push(M(x + 0.3, Y + 0.84, z + 0.15, 1, 1, 1));
      }
    }
  g.add(
    diningSets(sets, Y + 0.04, iron),
    instanced(
      new THREE.ConeGeometry(0.13, 0.36, 12),
      new THREE.MeshStandardMaterial({ color: 0xd9a04a, roughness: 0.6 }),
      dosa,
      false,
    ),
    instanced(
      new THREE.CylinderGeometry(0.2, 0.17, 0.02, 14),
      MAT.white,
      plates,
      false,
    ),
    instanced(
      new THREE.CylinderGeometry(0.045, 0.04, 0.11, 10),
      MAT.metalRoof,
      cups,
      false,
    ),
  );
  // 摆着 dosa 的桌子坐了一到三个人，面朝桌子
  const eat = [];
  for (const [x, z] of sets)
    if (hash((x * 3) | 0, (z * 3) | 0) < 0.6) {
      const seats = [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].filter((_, k) => hash((x * 5 + k) | 0, (z * 7) | 0) < 0.55);
      for (const [sx, sz] of seats.length ? seats : [[1, 1]])
        eat.push(
          folk(
            x + sx * 0.32,
            Y + 0.06,
            z + sz * 0.64,
            sz > 0 ? Math.PI : 0,
            'h',
          ),
        );
    }
  g.add(crowd(eat));
  // 自助取餐台（靠后墙）：一排保温餐盘、果汁桶、水果；台后是厨房隔墙和传菜窗；上方吊着黑板
  const CZ = -D / 2 + 4.6;
  g.add(
    tbox(22, 0.95, 1.1, MAT.white, -2, Y + 0.48, CZ),
    tbox(22.3, 0.06, 1.3, MAT.darkStone, -2, Y + 0.98, CZ),
    tbox(W - 0.6, H, 0.2, MAT.white, 0, Y + H / 2, CZ - 2.2),
    tbox(16, 1.1, 0.1, MAT.doorGlow, -3, Y + 1.9, CZ - 2.08),
  );
  const food = [],
    fruit = [],
    jug = [];
  [
    '#c98a2e',
    '#f3ead2',
    '#8a4a1e',
    '#d8b24a',
    '#b4472a',
    '#e9dcc0',
    '#6f9a3a',
    '#d98f3a',
  ].forEach((c, i) => {
    food.push([
      M(-11.2 + i * 1.75, Y + 1.09, CZ, 1.3, 0.14, 0.7),
      new Color(c).getHex(),
    ]);
  });
  for (let i = 0; i < 26; i++)
    fruit.push([
      M(
        6.2 + (i % 6) * 0.26 + rr(-0.05, 0.05),
        Y + 1.1 + Math.floor(i / 12) * 0.2,
        CZ - 0.25 + (((i / 6) | 0) % 2) * 0.28,
        0.13,
        0.13,
        0.13,
      ),
      [0xe8a020, 0xd23a2a, 0x7fae3a, 0xf0d03a][i % 4],
    ]);
  [0xe8862a, 0xb8243a, 0xcfe07a, 0xf2e6c8].forEach((c, i) =>
    jug.push([M(8.4 + i * 0.5, Y + 1.27, CZ + 0.1, 0.19, 0.5, 0.19), c]),
  );
  g.add(
    tinted(new THREE.BoxGeometry(1, 1, 1), food),
    tinted(new THREE.SphereGeometry(1, 8, 6), fruit),
    tinted(new THREE.CylinderGeometry(1, 1, 1, 12), jug, 0.25),
    instanced(
      new THREE.BoxGeometry(1, 1, 1),
      MAT.metalRoof,
      food.map((f, i) => M(-11.2 + i * 1.75, Y + 1.03, CZ, 1.42, 0.06, 0.82)),
      false,
    ),
  );
  [
    ['Self Service', -8],
    ['Cash Counter', 3],
  ].forEach(([t, x]) => {
    const b = signBoard(t, 3.4, 0.6, '#18181b', '#f2f2f2');
    b.position.set(x, Y + 3.2, CZ + 0.7);
    g.add(
      b,
      tbox(0.03, 0.9, 0.03, MAT.black, x - 1.4, Y + 3.9, CZ + 0.7),
      tbox(0.03, 0.9, 0.03, MAT.black, x + 1.4, Y + 3.9, CZ + 0.7),
    );
  });
  const menu = signBoard(
    'Cone Dosa · Baby Corn · Juice',
    6.4,
    0.8,
    '#1d2a22',
    '#f4ecd0',
  );
  menu.position.set(-2, Y + 2.9, CZ - 2.05);
  g.add(menu);
  g.add(
    tbox(3.4, 0.9, 0.9, MAT.white, 13, Y + 0.47, CZ),
    tbox(1.2, 0.5, 0.5, MAT.metalRoof, 13, Y + 1.2, CZ),
  ); // 收银台
  // 东墙上的 Devi 像与红色供桌
  const dv = new THREE.Group();
  dv.position.set(W / 2 - 0.25, Y, 2);
  dv.rotation.y = -Math.PI / 2;
  const deviFace = mesh(
    new THREE.SphereGeometry(1, 14, 12),
    MAT.gold,
    0,
    2.55,
    0.08,
    false,
  );
  deviFace.scale.set(0.36, 0.62, 0.06);
  dv.add(
    tbox(1.9, 2.5, 0.08, MAT.black, 0, 2.6, 0),
    tbox(1.6, 2.2, 0.04, MAT.sariRed, 0, 2.6, 0.05),
    deviFace,
    tbox(2.2, 0.85, 1.0, MAT.red, 0, 0.45, 0.6),
    tbox(1.6, 0.3, 0.6, MAT.red, 0, 1.0, 0.45),
    glowPoints(
      [
        [-0.6, 1.3, 0.6],
        [0.6, 1.3, 0.6],
      ],
      1.2,
    ),
  );
  g.add(dv);
  // 洗手池、入口门廊与室外座位；招牌与月牙；旁边的 ATM
  g.add(
    tbox(5, 0.85, 0.6, MAT.white, -W / 2 + 3.2, Y + 0.43, D / 2 - 0.7),
    tbox(4.8, 0.05, 0.5, MAT.metalRoof, -W / 2 + 3.2, Y + 0.88, D / 2 - 0.7),
  );
  g.add(
    columns(
      [
        [-8, D / 2 + 7],
        [-2.7, D / 2 + 7],
        [2.7, D / 2 + 7],
        [8, D / 2 + 7],
      ],
      Y,
      3.3,
      0.14,
      MAT.white,
      true,
    ),
    asRoof(tbox(18.5, 0.16, 8, MAT.metalRoof, 0, Y + 3.5, D / 2 + 3.6)),
    stairs(12, 2, 0.2, 0.5, MAT.granite, 0, Y, D / 2 + 9, 1, 0),
    diningSets(
      [
        [-6.5, D / 2 + 3.4],
        [-3, D / 2 + 3.4],
        [3, D / 2 + 3.4],
        [6.5, D / 2 + 3.4],
      ],
      Y,
      iron,
    ),
  );
  const moon = mesh(
    new THREE.TorusGeometry(1.05, 0.22, 8, 28, Math.PI * 1.15),
    MAT.moon,
    -6.6,
    Y + 4.9,
    D / 2 + 7.7,
    false,
  );
  moon.rotation.z = Math.PI + 1.0;
  const sb = signBoard('Moondram Pirai Eatery', 9.5, 1.15);
  sb.position.set(1.2, Y + 4.7, D / 2 + 7.7);
  g.add(moon, sb, tbox(18.5, 0.3, 0.2, MAT.white, 0, Y + 3.85, D / 2 + 7.6));
  for (const x of [-10.5, 10.5])
    g.add(
      tcyl(0.55, 0.4, 0.75, 10, MAT.tile, x, Y + 0.4, D / 2 + 8),
      mesh(
        new THREE.IcosahedronGeometry(0.85, 1),
        MAT.leaf,
        x,
        Y + 1.5,
        D / 2 + 8,
      ),
    );
  const atm = house(3, 2.6, 2.6, {
    roof: 'flat',
    win: 1,
    plinth: 0.2,
    wall: MAT.white,
  });
  atm.position.set(W / 2 + 6, 0, D / 2 - 2);
  g.add(atm);
  const ab = signBoard('ATM', 1.8, 0.6, '#1d3a6b', '#ffffff');
  ab.position.set(W / 2 + 6, 3.4, D / 2 - 0.6);
  g.add(ab);
  const il = new THREE.PointLight(0xfff0dc, 70, 30, 1.1);
  il.position.set(0, Y + 3.6, 1); // 室内常亮
  g.add(
    il,
    glowPoints(
      [
        [-12, Y + 4.1, 2],
        [-4, Y + 4.1, 2],
        [4, Y + 4.1, 2],
        [12, Y + 4.1, 2],
        [0, Y + 3.1, D / 2 + 4],
      ],
      5,
      0xfff0d0,
    ),
  );
  return g;
}

// —— Velliangiri Unavagam：Suryakund 东南、Surya Vasal 内侧的餐厅（Google 地图定位；造型参照 Google 地图上的访客照片）。
//    后面是一栋芥末黄的厨房楼，正面一排不锈钢取餐窗口，墙上写着 “Velliangiri Unnavagam”；
//    前面是一座敞开的大钢棚：灰色钢门架、双坡金属屋面、深色光面石材地坪，棚下一排排木面钢腿的站食长桌，窗口前有排队的钢栏杆。
//    厨房楼东头隔出一间小 Isha Life 店（货架和一个甜点玻璃柜；位置是推测）。棚前是铺砖小广场、花坛和椰子树。正面朝 +Z ——
function createUnavagam() {
  const g = new THREE.Group(),
    W = 36,
    D = 24;
  const yellow = new THREE.MeshStandardMaterial({
    map: TEX.plaster,
    color: 0xdcae3c,
    roughness: 0.9,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: 0x6a7178,
    roughness: 0.45,
    metalness: 0.6,
  });
  const roofM = new THREE.MeshStandardMaterial({
    color: 0x8d969c,
    roughness: 0.5,
    metalness: 0.5,
    side: THREE.DoubleSide,
  });
  const floorM = new THREE.MeshStandardMaterial({
    map: TEX.stone,
    color: 0x45434a,
    roughness: 0.3,
    metalness: 0.1,
  });
  const ssteel = new THREE.MeshStandardMaterial({
    color: 0xc9cdd2,
    roughness: 0.3,
    metalness: 0.8,
  });
  g.add(tbox(W + 1, 0.3, D, floorM, 0, 0.15, 0));
  // 厨房楼
  const KD = 7,
    KZ = -D / 2 + KD / 2,
    KH = 4.4,
    fz = KZ + KD / 2,
    F = 0.3;
  g.add(
    tbox(W, KH, KD, yellow, 0, F + KH / 2, KZ),
    tbox(W + 0.6, 0.3, KD + 0.6, yellow, 0, F + KH + 0.15, KZ),
  );
  const svc = [];
  for (const x of [-13, -7, -1, 5]) {
    svc.push(M(x, F + 1.95, fz + 0.02, 4.4, 1.5, 0.05));
    g.add(
      tbox(4.8, 0.1, 0.7, ssteel, x, F + 1.15, fz + 0.32),
      tbox(4.8, 1.0, 0.15, ssteel, x, F + 0.6, fz + 0.65),
    );
  }
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.window, svc, false));
  const sign = mesh(
    new THREE.PlaneGeometry(10, 1.1),
    new THREE.MeshStandardMaterial({
      map: signTex('Velliangiri Unnavagam', '#dcae3c', '#3a2814'),
      roughness: 0.8,
    }),
    -4,
    F + 3.45,
    fz + 0.03,
    false,
  );
  g.add(sign);
  // 排队栏杆（窗口前的钢管）
  const rail = [];
  for (const x of [-13, -7, -1, 5])
    for (const sx of [-1, 1])
      rail.push(
        M(x + sx * 1.9, F + 0.95, fz + 2.6, 0.05, 0.05, 3.2),
        M(x + sx * 1.9, F + 0.5, fz + 4.1, 0.05, 0.9, 0.05),
      );
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), steel, rail, false));
  // 小 Isha Life 店：厨房楼东头，玻璃门面
  const LX = 13.5;
  g.add(
    mesh(
      new THREE.PlaneGeometry(6.8, 2.6),
      new THREE.MeshStandardMaterial({
        color: 0x9fb4b8,
        roughness: 0.1,
        metalness: 0.3,
        transparent: true,
        opacity: 0.35,
      }),
      LX,
      F + 1.35,
      fz + 0.04,
      false,
    ),
  );
  const sl = signBoard('Isha Life', 3.2, 0.6, '#2b2016', '#f3e6c8');
  sl.position.set(LX, F + 3.1, fz + 0.12);
  g.add(sl);
  g.add(tbox(6.6, 2.6, 0.1, MAT.plaster, LX, F + 1.3, fz - 0.15)); // 店内的后墙（挡住厨房）
  const goods = [];
  for (let s = 0; s < 4; s++)
    for (let i = 0; i < 9; i++)
      goods.push([
        M(LX - 2.9 + i * 0.7, F + 0.5 + s * 0.55, fz - 0.4, 0.55, 0.38, 0.3),
        [0xb5452e, 0xe6c46a, 0x2f6d5a, 0xd77e9a, 0x6a4a8a, 0xf0ece0][
          (s * 9 + i) % 6
        ],
      ]);
  g.add(tinted(new THREE.BoxGeometry(1, 1, 1), goods));
  g.add(
    tbox(2.4, 0.9, 0.7, MAT.wood, LX + 1.6, F + 0.45, fz + 1.6),
    mesh(
      new THREE.BoxGeometry(2.4, 0.6, 0.7),
      new THREE.MeshStandardMaterial({
        color: 0xdfeef0,
        transparent: true,
        opacity: 0.4,
        roughness: 0.05,
      }),
      LX + 1.6,
      F + 1.2,
      fz + 1.6,
      false,
    ),
  ); // 甜点玻璃柜
  // 大钢棚
  const SZ0 = fz + 0.4,
    SZ1 = D / 2 - 0.3,
    SD = SZ1 - SZ0,
    SZ = (SZ0 + SZ1) / 2,
    EH = 4.6,
    rise = 1.5;
  const posts = [];
  for (let x = -W / 2 + 0.3; x <= W / 2; x += 5.9)
    posts.push([x, SZ0], [x, SZ1]);
  g.add(columns(posts, F, EH, 0.14, steel, true));
  const shed = new THREE.Group();
  asRoof(shed);
  const sl2 = Math.hypot(SD / 2, rise) + 0.8,
    ang = Math.atan2(rise, SD / 2);
  const r1 = tbox(W + 1.6, 0.06, sl2, roofM, 0, F + EH + rise / 2, SZ + SD / 4);
  r1.rotation.x = ang;
  const r2 = tbox(W + 1.6, 0.06, sl2, roofM, 0, F + EH + rise / 2, SZ - SD / 4);
  r2.rotation.x = -ang;
  const truss = [];
  for (let x = -W / 2 + 0.3; x <= W / 2; x += 5.9)
    truss.push(M(x, F + EH - 0.1, SZ, 0.18, 0.22, SD));
  shed.add(r1, r2, instanced(new THREE.BoxGeometry(1, 1, 1), steel, truss));
  g.add(shed);
  // 站食长桌：木面、钢腿，一排排顺着棚子
  const tops = [],
    legs = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 5; c++) {
      const x = -14 + c * 7,
        z = SZ0 + 4.6 + r * 3.3;
      tops.push(M(x, F + 0.95, z, 5.2, 0.08, 1.0));
      for (const sx of [-1, 1])
        legs.push(M(x + sx * 2.4, F + 0.47, z, 0.06, 0.94, 0.9));
    }
  g.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.wood, tops),
    instanced(new THREE.BoxGeometry(1, 1, 1), steel, legs, false),
  );
  // 人：长桌两边站着吃，窗口前的栏杆里排着队
  const eat = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 5; c++)
      for (let k = 0; k < 6; k++)
        for (const sz of [-1, 1]) {
          const x = -14 + c * 7 - 2.0 + k * 0.8,
            z = SZ0 + 4.6 + r * 3.3 + sz * 0.78;
          if (hash(r * 31 + c * 7 + k, sz + 5) < 0.45)
            eat.push(folk(x + pr(-0.1, 0.1), F, z, sz > 0 ? Math.PI : 0, 's'));
        }
  for (const x of [-13, -7, -1, 5])
    for (let k = 0, n = 2 + ((PR() * 4) | 0); k < n; k++)
      eat.push(
        folk(
          x + pr(-0.15, 0.15),
          F,
          fz + 1.1 + k * 0.72,
          Math.PI + pr(-0.2, 0.2),
          's',
        ),
      );
  g.add(crowd(eat));
  // 吊扇
  const fans = [];
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 2; r++)
      fans.push(M(-12 + c * 8, F + EH - 0.6, SZ0 + 6 + r * 5, 1.4, 0.03, 0.12));
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.black, fans, false));
  // 棚前小广场：铺砖、两个带钢栏杆的方花坛
  g.add(tbox(W, 0.12, 6, MAT.redPaver, 0, 0.06, D / 2 + 3)); // 棚前铺砖（再往前就是 Surya Vasal 门楼）
  for (const x of [-10, 10]) {
    g.add(
      tbox(6, 0.6, 2.4, MAT.concrete, x, 0.3, D / 2 + 3.2),
      tbox(5.6, 0.1, 2.0, MAT.lawn, x, 0.62, D / 2 + 3.2),
    );
    const pr = [];
    for (const sx of [-1, 1])
      pr.push(
        M(x + sx * 3.3, 0.55, D / 2 + 3.2, 0.05, 0.05, 3.0),
        M(x, 0.55, D / 2 + 3.2 + sx * 1.5, 6.6, 0.05, 0.05),
      );
    g.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.black, pr, false));
    const sh = [];
    for (let i = 0; i < 9; i++)
      sh.push(
        M(
          x - 2.4 + (i % 5) * 1.2,
          0.95,
          D / 2 + 2.8 + Math.floor(i / 5) * 0.8,
          0.5,
          0.4,
          0.5,
        ),
      );
    g.add(instanced(new THREE.IcosahedronGeometry(1, 0), MAT.leaf, sh));
  }
  g.add(
    glowPoints(
      [
        [-12, F + EH - 0.3, SZ],
        [0, F + EH - 0.3, SZ],
        [12, F + EH - 0.3, SZ],
      ],
      6,
    ),
  );
  for (const x of [-10, 10]) {
    const pl = new THREE.PointLight(0xffe2b0, 40, 32, 1.4);
    pl.position.set(x, F + EH - 0.6, SZ);
    g.add(pl);
  } // 棚下常亮的灯
  return g;
}

// —— Metal Bridge：Bhiksha Hall 东北、通往 Velliangiri Prashala 的钢桁架步行桥，跨过一条山溪（牛车线的终点）。局部 X 为桥的走向 ——
function createMetalBridge() {
  const g = new THREE.Group(),
    L = 26,
    Wd = 3.2,
    steel = new THREE.MeshStandardMaterial({
      color: 0x5f6b72,
      roughness: 0.5,
      metalness: 0.6,
    });
  // 山溪：浅沟、溪水、乱石
  const bed = tbox(13, 0.1, 60, MAT.darkPlaster, 0, 0.1, 0);
  bed.castShadow = false;
  bed.rotation.y = 0.12;
  const wtr = mesh(
    scaleUV(new THREE.PlaneGeometry(6, 60), 1, 8).rotateX(-Math.PI / 2),
    MAT.water,
    0,
    0.18,
    0,
    false,
  );
  wtr.rotation.y = 0.12;
  const rocks = [];
  for (let i = 0; i < 70; i++) {
    const z = rr(-29, 29),
      s = rr(0.4, 1.3),
      sd = rnd() < 0.5 ? -1 : 1;
    rocks.push(
      M(sd * rr(2.6, 6.2) + z * 0.12, 0.25, z, s * 1.3, s * 0.7, s, rnd() * 6),
    );
  }
  g.add(
    bed,
    wtr,
    instanced(new THREE.IcosahedronGeometry(1, 0), MAT.rock, rocks),
  );
  // 桥面（钢格板）+ 两侧华伦式桁架
  const DY = 2.1;
  g.add(
    tbox(L, 0.16, Wd, steel, 0, DY, 0),
    tbox(L, 0.06, Wd - 0.4, MAT.metalRoof, 0, DY + 0.1, 0),
  );
  const bars = [],
    N = 8,
    seg = L / N,
    TH = 2.2,
    dl = Math.hypot(seg / 2, TH),
    da = Math.atan2(TH, seg / 2);
  for (const sz of [-1, 1]) {
    const z = (sz * Wd) / 2;
    bars.push(
      M(0, DY + 0.1, z, L, 0.2, 0.16),
      M(0, DY + TH, z, L - seg, 0.2, 0.16),
    );
    for (let i = 0; i < N; i++) {
      const x = -L / 2 + i * seg;
      bars.push(
        M(x + seg / 4, DY + TH / 2, z, dl, 0.12, 0.12, 0, 0, da),
        M(x + seg * 0.75, DY + TH / 2, z, dl, 0.12, 0.12, 0, 0, -da),
      );
    }
    for (let i = 0; i <= N; i++)
      bars.push(M(-L / 2 + i * seg, DY + 0.6, z, 0.08, 1.1, 0.08));
    bars.push(M(0, DY + 1.1, z, L, 0.07, 0.07));
  }
  for (let i = 1; i < N; i++)
    bars.push(M(-L / 2 + i * seg, DY + TH, 0, 0.12, 0.12, Wd));
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), steel, bars));
  // 桥墩与两端的坡道
  for (const sx of [-1, 1]) {
    g.add(
      tbox(2.4, DY, Wd + 1.2, MAT.sandstone, sx * (L / 2 + 0.6), DY / 2, 0),
    );
    const ramp = tbox(9, 0.2, Wd, MAT.paving, sx * (L / 2 + 6), DY / 2, 0);
    ramp.rotation.z = -sx * Math.atan2(DY, 9);
    g.add(ramp);
  }
  g.add(
    tbox(1.2, DY - 0.2, 1.2, MAT.concrete, -5, (DY - 0.2) / 2, 0),
    tbox(1.2, DY - 0.2, 1.2, MAT.concrete, 5, (DY - 0.2) / 2, 0),
  );
  const sb = signBoard('Metal Bridge', 4, 0.7);
  sb.position.set(-L / 2 - 9, 2.2, -3);
  sb.rotation.y = Math.PI / 2;
  g.add(sb, tbox(0.12, 2, 0.12, MAT.wood, -L / 2 - 9, 1, -3));
  g.add(
    glowPoints(
      [
        [-L / 2, DY + 2.6, 0],
        [L / 2, DY + 2.6, 0],
        [0, DY + 2.6, 0],
      ],
      4,
    ),
  );
  return g;
}

// —— 园区其余建筑（不单列导航）：Yoga Vasal、Surya Vasal、路边摊位、洗手间、Maatu Mane 牛棚、Nirkaya Sthanam、
//    Spanda 北侧的长屋、Nadi Cottages、诊所、百货店、银行与邮局。本组件不旋转，位置直接写实测 (东, 北) 坐标 ——
function createCampus() {
  const g = new THREE.Group();
  const put = (o, e, n, f = 0) => {
    o.position.set(e, 0, -n);
    o.rotation.y = f;
    g.add(o);
    return o;
  };
  const label = (o, text, w, y, z) => {
    const s = signBoard(text, w, 0.8);
    s.position.set(0, y, z);
    o.add(s);
    return o;
  };
  // 两道门：木梁瓦顶的门楼
  const gate = (name, w) => {
    const o = new THREE.Group();
    o.add(
      tbox(1, 4.4, 1, MAT.granite, -w / 2, 2.2, 0),
      tbox(1, 4.4, 1, MAT.granite, w / 2, 2.2, 0),
      tbox(w + 3, 0.5, 1.4, MAT.wood, 0, 4.6, 0),
      gableRoof(3.4, w + 4, 1.2, 4.85),
    );
    return label(o, name, 4.6, 3.7, 0.75);
  };
  put(gate('Yoga Vasal', 6), 66, 31, AX - Math.PI / 2 + Math.PI);
  put(gate('Surya Vasal', 9), 250, -102, face(0.68, -0.73));
  // Sarpa Vasal 与 Surya Vasal 之间沿路的一排小摊位（位置取自 OSM）
  const stall = [];
  for (let i = 0; i < 10; i++) stall.push([199 + i * 3.8, -145 + i * 4.25]);
  for (const [e, n] of stall) {
    const s = house(5.6, 5.6, 2.6, {
      roof: 'hip',
      rise: 1.7,
      win: 1,
      plinth: 0.2,
      wall: MAT.brick,
    });
    put(s, e, n, face(0.68, -0.73));
  }
  put(
    label(
      house(9, 5, 2.8, { rise: 1.6, win: 3, plinth: 0.3, wall: MAT.brick }),
      'Restroom',
      3,
      3.3,
      2.6,
    ),
    12,
    86,
    AX,
  );
  put(
    label(
      house(8, 5, 2.8, { rise: 1.6, win: 2, plinth: 0.3, wall: MAT.brick }),
      'Restroom',
      3,
      3.3,
      2.6,
    ),
    157.5,
    -78,
    face(0, 1),
  ); // 原先 e=150 压在 Sarpa Vasal → Nandi 的路上，第十轮往东挪
  // Maatu Mane（牛棚）：50 × 22 m 的敞棚 + 围栏；Nirkaya Sthanam：一排小石龛
  const mm = pavilion(48, 20, 3.4, {
    nx: 9,
    nz: 3,
    all: true,
    colMat: MAT.wood,
    r: 0.14,
    roofMat: MAT.tile,
    floor: MAT.darkPlaster,
    plinth: 0.15,
  });
  const cows = [];
  for (let i = 0; i < 10; i++)
    cows.push(M(-20 + i * 4.4, 1.1, rr(-4, 4), 0.55, 0.65, 1.2, rr(-0.4, 0.4)));
  mm.add(
    instanced(new THREE.SphereGeometry(1, 10, 8), MAT.white, cows),
    asRoof(gableRoof(23, 51, 2.6, 4.1)),
  );
  put(label(mm, 'Maatu Mane', 4.6, 3.2, 10.6), -43, 134, 0);
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Group();
    s.add(
      tbox(2.6, 0.6, 2.6, MAT.granite, 0, 0.3, 0),
      tbox(1.8, 1.6, 1.8, MAT.darkStone, 0, 1.4, 0),
      mesh(
        new THREE.ConeGeometry(1.5, 1.2, 4).rotateY(Math.PI / 4),
        MAT.granite,
        0,
        2.8,
        0,
      ),
      mesh(new THREE.CapsuleGeometry(0.22, 0.4, 4, 8), MAT.black, 0, 1.0, 1.1),
    );
    put(s, 12 + i * 9, 150 + i * 6, 0);
  }
  // Spanda Hall 北侧的长屋（73 × 26 m）
  put(
    house(68, 22, 5, {
      rise: 3.4,
      win: 14,
      veranda: 3,
      colMat: MAT.concrete,
      roofMat: MAT.salmon,
    }),
    190,
    247,
    face(-0.16, -0.99),
  ); // 第十轮由 n=250 南移：北墙原先伸进了去 Bhiksha Hall 的路
  // Nadi Cottages：五排砖墙瓦顶的小屋
  for (let r = 0; r < 5; r++)
    for (let k = 0; k < 2; k++)
      put(
        house(24, 9, 3.2, { rise: 2.2, win: 5, veranda: 2, wall: MAT.brick }),
        136 + k * 30 + r * 0.5,
        292 + r * 21,
        face(k ? 1 : -1, 0.04),
      );
  // 诊所、百货店、银行与邮局（Bhiksha Hall 一带）
  put(
    label(
      house(8, 14, 3.2, {
        roof: 'flat',
        win: 2,
        wall: MAT.white,
        roofMat: MAT.concrete,
      }),
      'Clinic',
      2.6,
      3.4,
      7.1,
    ),
    168,
    280.5,
    face(0, -1),
  ); // 原先 n=268 压在通往 Bhiksha Hall 的路上，第十轮挪到路北
  put(
    label(
      house(16, 10, 3.6, { rise: 2.2, win: 4, veranda: 2.6 }),
      'Departmental Store',
      7,
      4.1,
      7.5,
    ),
    300,
    356,
    face(0.16, -0.99),
  );
  put(
    label(
      house(10, 8, 3.2, { rise: 2, win: 3, veranda: 2 }),
      'Bank & Post Office',
      6.4,
      3.7,
      6.1,
    ),
    330,
    362,
    face(0.16, -0.99),
  );
  // Alayam Cottages：Adiyogi Alayam 东侧的一列小屋
  for (let i = 0; i < 4; i++)
    put(
      house(8, 7, 3, { roof: 'hip', rise: 1.8, win: 2, wall: MAT.brick }),
      334 + i * 2,
      16 + i * 30,
      face(1, 0),
    );
  return g;
}

// —— Malai Vasal（主入口，蛇门外）：位置取自 Google 地图（Adi Yogi Isha Rd 上，Adiyogi 以南约 1 公里），造型对照 2026 年 8 月的街景：
//    道路直接从门洞穿过；两根叠砌的巨石门柱，门楣是一块天然巨石，石顶一个金色小林伽；门洞里两扇深棕色木格大门向外敞开；
//    两侧墙下段是巨石、上段是红砖，墙头一排铁艺装饰。门内西侧是一方池塘，池边一排鸡蛋花树。局部 +Z 朝南（门外），+X 朝东 ——
function createMalaiVasal() {
  const g = new THREE.Group();
  // 门柱：三块叠砌的粗凿巨石
  for (const sx of [-1, 1]) {
    [
      [2.8, 1.8, 2.6, 0.9],
      [2.4, 1.8, 2.3, 2.7],
      [2.7, 1.6, 2.5, 4.4],
    ].forEach(([w, h, d, y]) =>
      g.add(tbox(w, h, d, MAT.granite, sx * 5.0, y, 0)),
    );
    // 两侧墙：下段巨石、上段红砖，墙头铁艺
    g.add(
      tbox(18, 3.0, 1.6, MAT.granite, sx * 15.2, 1.5, 0),
      tbox(18, 1.6, 1.0, MAT.brick, sx * 15.2, 3.8, -0.1),
    );
    const orn = [];
    for (let x = 6.8; x <= 24; x += 0.6)
      orn.push(
        M(sx * x, 5.0, -0.1, 0.05, 0.7 + (Math.round(x * 5) % 3) * 0.15, 0.05),
      );
    g.add(instanced(new THREE.BoxGeometry(1, 1, 1), MAT.black, orn, false));
    // 敞开的深棕色木格大门
    const door = new THREE.Group();
    door.position.set(sx * 3.7, 0, 1.2);
    door.rotation.y = sx * -1.2;
    door.add(
      tbox(2.9, 5.2, 0.16, MAT.wood, sx * 1.45, 2.7, 0),
      mesh(
        new THREE.PlaneGeometry(2.5, 4.7),
        MAT.jali,
        sx * 1.45,
        2.7,
        0.1,
        false,
      ),
    );
    g.add(door);
  }
  // 门楣：一块天然巨石，顶上一个金色小林伽
  const rg = new THREE.IcosahedronGeometry(1, 2),
    rp = rg.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i),
      y = rp.getY(i),
      z = rp.getZ(i),
      n = 1 + (vnoise(x * 2.3 + 3, y * 2.3 + z) - 0.5) * 0.35;
    rp.setXYZ(i, x * n, y * n, z * n);
  }
  rg.computeVertexNormals();
  const boulder = mesh(rg, MAT.rock, 0, 6.6, 0);
  boulder.scale.set(5.4, 1.5, 2.6);
  g.add(boulder);
  const lg = linga(0.32, 0.5, MAT.gold);
  lg.position.y += 8.0;
  g.add(lg);
  // 门内：灰色石块路面、红灰相间的人行道、西侧池塘与鸡蛋花树（池塘轮廓取自 OSM）
  const L = ([e, n]) => [e - 747, -(n + 1653)];
  const pond = [
    [697, -1585],
    [674, -1627],
    [675, -1664],
    [738, -1664],
    [737, -1593],
    [725, -1570],
  ].map(L);
  g.add(polyPlane(pond, MAT.pondWater, 0.12));
  const walk = [];
  for (let i = 0; i < 18; i++)
    walk.push(
      M(-6.2, 0.09, -4 - i * 3, 2.4, 0.06, 1.4),
      M(-6.2, 0.09, -5.5 - i * 3, 2.4, 0.06, 1.4),
    );
  const wk = instanced(
      new THREE.BoxGeometry(1, 1, 1),
      MAT.redPaver,
      walk.filter((_, i) => i % 2 === 0),
      false,
    ),
    wk2 = instanced(
      new THREE.BoxGeometry(1, 1, 1),
      MAT.paving,
      walk.filter((_, i) => i % 2 === 1),
      false,
    );
  g.add(wk, wk2);
  const fr = [],
    frC = [];
  for (let i = 0; i < 9; i++) {
    const z = -6 - i * 6;
    fr.push(M(-8.4, 1.2, z, 0.16, 2.4, 0.16, 0, 0.2, 0.1));
    frC.push(M(-8.4, 2.9, z, 2.0, 1.1, 2.0, i));
  }
  const flower = new THREE.MeshLambertMaterial({
    color: 0x6f8f4a,
    flatShading: true,
  });
  g.add(
    instanced(
      new THREE.CylinderGeometry(1, 1, 1, 6),
      new THREE.MeshLambertMaterial({ color: 0x8a7a68 }),
      fr,
    ),
    instanced(new THREE.IcosahedronGeometry(1, 0), flower, frC),
  );
  const sb = signBoard('Malai Vasal', 4.4, 0.8);
  sb.position.set(-11, 3.1, 1.0);
  g.add(
    sb,
    glowPoints(
      [
        [-5, 5.4, 1.5],
        [5, 5.4, 1.5],
      ],
      4,
    ),
  );
  return g;
}

// —— Kalabhairava Sthanam（蛇门外）：位置取自 Google 地图，在 Adi Yogi Isha Rd 西侧、Malai Vasal 以北约 120 米。
//    外观参照 Wikimedia Commons 照片（Isha yoga centre-2）与 2026 年 8 月的街景：灰色抹灰的方正殿身、正面一对雕花石柱门廊和铜色檐板，
//    檐上是黑色的 Kalabhairava 像，殿顶后部一座深色灯亭、亭顶黑色宝顶；前面是灰色铺石的前庭、白色栏杆围墙，路边一道黑色铁艺花栏。局部 +Z 朝东（朝路） ——
function createKalabhairava() {
  const g = new THREE.Group(),
    W = 16,
    D = 13,
    H = 8.5,
    Y = 0.5;
  const grey = MAT.concrete.clone();
  grey.color.set(0xa9a6a0);
  grey.userData = { s: 5 };
  g.add(
    tbox(W + 3, Y, D + 4, MAT.granite, 0, Y / 2, 0),
    tbox(W, H, D, grey, 0, Y + H / 2, -1),
    tbox(W + 0.4, 0.4, D + 0.4, grey, 0, Y + H + 0.2, -1),
  );
  g.add(
    tbox(0.06, H - 2.4, 0.5, MAT.black, W / 2 + 0.03, Y + H / 2, -3),
    tbox(0.5, H - 2.4, 0.06, MAT.black, W / 2 - 2, Y + H / 2, D / 2 - 0.97),
  );
  // 门廊：两根分节的雕花石柱、门洞、铜色檐板、台阶
  const P = new THREE.Group();
  P.position.set(-1.5, Y, D / 2 - 1);
  g.add(P);
  for (const sx of [-1, 1]) {
    const x = sx * 2.4;
    P.add(
      tbox(1.5, 0.6, 1.5, MAT.granite, x, 0.3, 2.2),
      tbox(1.1, 1.3, 1.1, MAT.granite, x, 1.25, 2.2),
      tbox(1.3, 0.35, 1.3, MAT.granite, x, 2.07, 2.2),
      tbox(1.0, 1.6, 1.0, MAT.granite, x, 3.05, 2.2),
      tbox(1.4, 0.5, 1.4, MAT.granite, x, 4.1, 2.2),
    );
  }
  P.add(
    tbox(3.2, 4.0, 0.1, MAT.doorGlow, 0, 2.0, 0.06),
    tbox(7.2, 0.35, 3.4, MAT.copper, 0, 4.55, 1.5),
    stairs(6.4, 3, 0.17, 0.4, MAT.granite, 0, 0, 3.4, 1, -Y),
  );
  // 檐上的黑色像：蹲坐、双臂撑在檐边
  const K = new THREE.Group();
  K.position.set(0, 4.75, 1.2);
  P.add(K);
  const B = new THREE.MeshStandardMaterial({
    color: 0x24252b,
    roughness: 0.45,
    metalness: 0.45,
  });
  const part = (sx, sy, sz, x, y, z) => {
    const m = mesh(new THREE.SphereGeometry(1, 20, 14), B, x, y, z);
    m.scale.set(sx, sy, sz);
    K.add(m);
  };
  part(1.5, 1.2, 1.0, 0, 1.2, -0.3);
  part(0.72, 0.7, 0.66, 0, 2.5, 0.15);
  part(0.6, 0.4, 0.5, 0, 3.05, -0.05);
  for (const sx of [-1, 1]) {
    part(0.7, 0.7, 0.7, sx * 1.4, 1.7, 0.05);
    K.add(
      mesh(new THREE.CapsuleGeometry(0.4, 1.1, 6, 10), B, sx * 1.7, 0.75, 0.5),
    );
    part(0.5, 0.28, 0.55, sx * 1.75, 0.12, 0.75);
  }
  const mala = mesh(
    new THREE.TorusGeometry(0.8, 0.05, 6, 28),
    MAT.goldTrim,
    0,
    1.85,
    0.5,
    false,
  );
  mala.scale.y = 1.25;
  mala.rotation.x = -0.35;
  K.add(mala);
  // 殿顶后部的深色灯亭与宝顶
  const T = new THREE.Group();
  T.position.set(1.5, Y + H + 0.4, -3);
  g.add(T);
  T.add(
    tbox(5.6, 2.6, 5.6, MAT.black, 0, 1.3, 0),
    mesh(new THREE.PlaneGeometry(5.2, 2.2), MAT.jali, 0, 1.3, 2.85, false),
    tbox(7, 0.25, 7, MAT.concrete, 0, 2.75, 0),
  );
  const top = linga(0.9, 0.9, B);
  top.position.y += 2.9;
  T.add(top);
  // 前庭、白色栏杆围墙、路边铁艺花栏、红色告示牌
  const fc = tbox(30, 0.1, 18, MAT.paving, 0, 0.05, 15);
  fc.castShadow = false;
  g.add(fc);
  const bal = [];
  for (let z = -9; z <= 23; z += 0.45)
    for (const sx of [-1, 1]) bal.push(M(sx * 15, 0.6, z, 0.16, 0.9, 0.16));
  g.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.white, bal),
    tbox(0.4, 0.16, 32.5, MAT.white, -15, 1.12, 7),
    tbox(0.4, 0.16, 32.5, MAT.white, 15, 1.12, 7),
  );
  const orn = [];
  for (let x = -14; x <= 14; x += 0.55)
    if (Math.abs(x) > 3.2)
      orn.push(M(x, 0.6, 24, 0.05, 0.9 + (Math.round(x * 4) % 3) * 0.15, 0.05));
  g.add(
    instanced(new THREE.BoxGeometry(1, 1, 1), MAT.black, orn, false),
    tbox(4.6, 2.6, 1.2, MAT.brick, -6, 1.3, 23.4),
  );
  const sb = signBoard('Kalabhairava Sthanam', 5.6, 0.9, '#7a1418', '#f6e3c0');
  sb.position.set(4.6, 1.8, 24.2);
  g.add(sb, tbox(0.12, 1.6, 0.12, MAT.black, 4.6, 0.8, 24.2));
  g.add(
    glowPoints(
      [
        [-3.9, Y + 4.4, D / 2 + 1.5],
        [0.9, Y + 4.4, D / 2 + 1.5],
      ],
      3.5,
      0xff9040,
    ),
  );
  return g;
}

// ───────────────────────────── [6] 组件注册表 ─────────────────────────────
/* at:    实测位置 (e, n)，单位米，以 Dhyanalinga 穹顶为原点向东 / 向北（来源：OpenStreetMap）
 * rotY:  朝向，用 face(东分量, 北分量) 书写；后面加的小数是建筑相对正方位的实际偏角
 * view:  导航镜头 { d: 距离, yaw: 相对正面的偏角, ph: 俯仰角, h: 目标点高度 }
 * clear: 植被避让圈 [局部x, 局部z, 半径]；pit: 地形开洞 [局部x, 局部z, 半宽, 半深] */
const COMPONENTS = [
  {
    id: 'adiyogi',
    zone: 'out',
    label: 'Adiyogi 像',
    create: createAdiyogi,
    at: [562, -629],
    rotY: face(0, -1),
    view: { d: 120, yaw: -0.35, ph: 1.42, h: 17 },
    clear: [
      [0, 0, 62],
      [0, 60, 78],
      [0, 110, 70],
    ],
    desc: '高 34 米、宽 45 米的钢制湿婆半身像，面朝正南（Dakshinamurti），位于主园区东南约 840 米处。像四周一圈黑色铁栏杆；像前的方亭里是 Yogeshwar Linga：黑色环形水盘中一座刻满经文的银色穹形林伽，地面嵌着六芒星圆盘，亭顶是赤陶色攒尖顶。',
  },
  {
    id: 'yogeshwar',
    zone: 'out',
    label: '　· Yogeshwar Linga',
    at: [562, -662],
    rotY: face(0, -1),
    view: { d: 11, yaw: 0.5, ph: 1.44, h: 1.4 },
    desc: 'Adiyogi 像前的 Yogeshwar Linga：代表五个主要脉轮，信众可以向它献水和苦楝叶，并绕行一周。',
  },
  {
    id: 'kalabhairava',
    zone: 'out',
    label: 'Kalabhairava Sthanam',
    create: createKalabhairava,
    at: [683, -1539],
    rotY: face(1, 0.12),
    view: { d: 42, yaw: 0.45, ph: 1.3, h: 4 },
    clear: [
      [0, 0, 22],
      [0, 18, 10],
    ],
    desc: '蛇门外、从 Adiyogi 继续往 Malai Vasal 走，在 Adi Yogi Isha Rd 西侧（坐标取自 Google 地图）。灰色的方正殿身，正面一对雕花石柱门廊、铜色檐板，檐上是黑色的 Kalabhairava 像，殿顶后部一座深色灯亭。前面是灰色铺石的前庭和白色栏杆围墙，路边是黑色铁艺花栏（参照 Wikimedia Commons 照片与 2026 年 8 月的街景）。',
  },
  {
    id: 'malai',
    zone: 'out',
    label: 'Malai Vasal 主入口',
    create: createMalaiVasal,
    at: [747, -1653],
    rotY: 0,
    view: { d: 36, yaw: 0.35, ph: 1.36, h: 4 },
    clear: [
      [0, 0, 16],
      [-40, -36, 34],
    ],
    desc: '园区的主入口，在 Adiyogi 以南约 1 公里的 Adi Yogi Isha Rd 上，道路直接从门洞穿过（位置取自 Google 地图，造型对照 2026 年 8 月的街景）：两侧是叠砌的巨石门柱，门楣是一块天然巨石，石顶一个金色小林伽；门洞里是两扇敞开的深棕色木格大门；两侧墙下段是巨石、上段是红砖。门内西侧是一方池塘，池边种着一排鸡蛋花树。',
  },
  {
    id: 'sarpa',
    zone: 'out',
    label: 'Sarpa Vasal 蛇门',
    create: createSarpaVasal,
    at: [190, -175],
    rotY: face(0.677, -0.736),
    view: { d: 56, yaw: 0.3, ph: 1.36, h: 5 },
    clear: [
      [0, 6, 24],
      [-14, -9, 8],
    ],
    desc: 'Narasipuram Road 边的园区入口：层层内收的花岗岩门框、红砖镶边、赤陶色筒拱，门洞正中立着黑色眼镜蛇。门内是 Information Center，沿路向东北是一排摊位和 Surya Vasal。',
  },
  {
    id: 'moondram',
    zone: 'out',
    label: 'Moondram Pirai Eatery',
    create: createMoondramPirai,
    at: [195, -228],
    rotY: face(-0.29, 0.956),
    view: { d: 58, yaw: 0.45, ph: 1.25, h: 3 },
    clear: [
      [-9, 0, 16],
      [9, 0, 16],
      [23, 8, 5],
    ],
    desc: 'Sarpa Vasal 南侧、路对面的餐厅（位置与占地取自 OpenStreetMap），旁边有 ATM。室内参照访客照片；外观没有找到照片，是推测。点「剖视」掀开屋顶看室内。',
  },
  {
    id: 'moondram-in',
    zone: 'out',
    label: '　· 餐厅室内',
    at: [195, -228],
    rotY: face(-0.29, 0.956),
    view: { d: 13, yaw: 0.35, ph: 1.32, h: 1.6, tz: -3 },
    desc: '白墙、白色钢桁架顶、浅色地砖、黑色铁艺四人桌；靠里是自助取餐台和收银台，桌上是招牌的锥形 dosa 和不锈钢杯，东墙挂着 Devi 像。照片里能确认的吃食是锥形 dosa 和 baby corn，取餐台上其余菜色是示意。',
  },
  {
    id: 'unavagam',
    label: 'Velliangiri Unavagam',
    create: createUnavagam,
    at: [241, -85],
    rotY: face(-0.14, -0.99),
    view: { d: 50, yaw: -0.45, ph: 1.22, h: 3 },
    clear: [
      [-10, 0, 17],
      [10, 0, 17],
      [0, 15, 8],
    ],
    desc: 'Suryakund 东南、Surya Vasal 内侧的南印度素食餐厅（Google 地图定位；造型参照 Google 地图上的访客照片）。后面是芥末黄的厨房楼，一排不锈钢取餐窗口；前面是敞开的大钢棚，深色石材地坪上一排排木面站食长桌，窗口前是排队栏杆。招牌是椰子面包和 dosa。厨房楼东头有一间小 Isha Life 店（位置是推测）。',
  },
  {
    id: 'unavagam-in',
    label: '　· 钢棚下',
    at: [241, -85],
    rotY: face(-0.14, -0.99),
    view: { d: 14, yaw: 0.35, ph: 1.4, h: 1.7, tz: -3 },
    desc: '取餐窗口前排队、端到长桌边站着吃：钢门架、金属屋面、吊扇，东头玻璃门面的是小 Isha Life 店。',
  },

  {
    id: 'suryakund',
    label: 'Suryakund 与 Mandapam',
    create: createSuryakund,
    at: [185, -25],
    rotY: AX + Math.PI,
    view: { d: 104, yaw: 0.55, ph: 1.02, h: 1 },
    clear: [
      [-19, -19, 30],
      [19, -19, 30],
      [-19, 19, 30],
      [19, 19, 30],
      [0, 42, 12],
    ],
    pit: [0, 0, 21, 19.5],
    desc: '男众净身池。列柱大殿 Suryakund Mandapam 环绕着沉在地下 22 英尺的池坑：东侧是 28 级又宽又深的大台阶，清晨男众坐在台阶上做 Guru Pooja 和练习；台阶尽头是 130×40 英尺的水池，三面巨石墙，砖拱下悬着 20 英尺的铜日。点「剖视」可掀开屋顶。',
  },
  {
    id: 'surya-in',
    label: '　· 大台阶与水池',
    at: [185, -25],
    rotY: AX + Math.PI,
    view: { d: 23, yaw: Math.PI - 0.45, ph: 1.37, h: -2.6, tz: -3 },
    desc: '从台阶顶上（Naga Shrine 一侧）往下看：每级近一米深的大台阶上铺着练习垫，坐着做练习的人；台阶中段两根通高石柱，最下面几级没在水里，对面石墙上挂着水幕。',
  },
  {
    id: 'naga',
    label: 'Naga Shrine',
    create: createNagaShrine,
    at: [209.8, -28.2],
    rotY: AX + Math.PI,
    view: { d: 13, yaw: 0.5, ph: 1.32, h: 2.4 },
    clear: [],
    desc: 'Suryakund 东侧台阶顶上的蛇龛：一整块黑色巨石，石面雕着相缠的眼镜蛇，前面供着铜灯和盛满绿叶的铜盆。在屋顶下面，点「剖视」看得更清楚。',
  },
  {
    id: 'ponds',
    label: '莲池与拱桥',
    create: createLotusPonds,
    at: [112, -14],
    rotY: 0,
    view: { d: 70, yaw: 0.5, ph: 1.05, h: 1 },
    clear: [
      [-6, 17, 15],
      [3, -13, 21],
      [0, -60, 22],
      [-9, 0, 9],
    ],
    desc: 'Nandi 与 Suryakund 之间的葫芦形莲池（轮廓取自 OpenStreetMap），腰部横跨一座白色拱桥，是从 Dhyanalinga 走向 Suryakund 的路。',
  },
  {
    id: 'nandi',
    label: 'Nandi',
    create: createNandi,
    at: [76, -10],
    rotY: AX + Math.PI,
    view: { d: 22, yaw: 0.75, ph: 1.38, h: 2.4 },
    clear: [[0, 0, 9.5]],
    desc: '约 15 英尺高的黑色公牛，面向 Dhyanalinga 卧着：头颈高昂、肩上有峰、一对新月形的角，一条前腿屈膝踏地，似随时准备起身；颈间一串铜铃垂到胸前。',
  },
  {
    id: 'dhyanalinga',
    label: 'Dhyanalinga',
    create: createDhyanalinga,
    at: [0, -1],
    rotY: AX,
    view: { d: 104, yaw: 0.5, ph: 1.12, h: 4, tz: 20 },
    clear: [
      [0, 0, 28],
      [0, 30, 15],
      [-21, 46, 16],
      [21, 46, 16],
      [0, 50, 10],
      [-7, -20, 6],
    ],
    desc: '1999 年落成。赭红泥灰的砖穹顶直径 76 英尺、高 33 英尺，坐在 6 英尺高的石鼓墙上，墙头一圈 28 个三角通风口。入口朝东：万教柱、石门、三级高台阶、内绕行廊（左 Patanjali、右 Vanashree、六块浮雕），最后穿过石拱隧道入殿。',
  },
  {
    id: 'dhyana-in',
    label: '　· 殿内：七脉轮林伽',
    at: [0, -1],
    rotY: AX,
    view: { d: 9.6, yaw: 0.25, ph: 1.36, h: 2.9 },
    desc: '殿内的 Dhyanalinga 高 13 英尺 9 英寸，黑色花岗岩，周身七道铜环对应七个脉轮；底座 avudaiyar 是七圈盘蛇，蛇头朝向入口。四周是方形水池 jalaseema，墙脚 28 个打坐壁龛，头顶悬着滴水的镀金铜半球。',
  },
  {
    id: 'bhairavi',
    label: 'Linga Bhairavi',
    create: createLingaBhairavi,
    at: [-43, -33],
    rotY: face(0.82, 0.57),
    view: { d: 62, yaw: -0.5, ph: 1.15, h: 4, tz: -4 },
    clear: [
      [0, -9, 17],
      [0, 8, 13],
      [0, 20, 6],
    ],
    pit: [0, -13.6, 2.8, 2.5],
    desc: '2010 年启灵的女神殿，在 Dhyanalinga 西南。殿墙围成倒三角（象征子宫），尽端的小三角是神龛；前面是平顶前殿。屋顶中央是镂空的三角天窗，点「剖视」可看殿内。',
  },
  {
    id: 'lb-in',
    label: '　· 殿内：Devi 与三叉戟',
    at: [-43, -33],
    rotY: face(0.82, 0.57),
    view: { d: 9.5, yaw: 0.12, ph: 1.36, h: 1.6, tz: -11 },
    desc: '殿中央斜立着一柄大三叉戟；Devi 前面是往下走的四级台阶和一个下沉的小坑，坑边围着黄铜立柱和红绳；约八英尺高、林伽形的 Devi 立在坑底的神龛里：三只眼、十臂，裹着红金纱丽，两侧是白色镂空雕花石柱和整面墙的油灯。左右墙上挂着红、绿纱丽幔。Devi Office 和 Ritual Office 在隔壁 Sadhana Hall 楼的一楼。',
  },
  {
    id: 'sadhana',
    label: 'Sadhana Hall 1 / 2',
    create: createSadhanaHalls,
    at: [-55, 9],
    rotY: AX,
    view: { d: 80, yaw: 0.6, ph: 1.15, h: 4 },
    clear: [
      [-20, 0, 15],
      [0, 0, 15],
      [20, 0, 15],
    ],
    desc: 'Dhyanalinga 西侧一栋连体的两层长楼。一楼沿柱廊是一排房间，南头是 Linga Bhairavi 的 Devi Office 和 Ritual Office；二楼南边是 Sadhana Hall 2、北边是 Sadhana Hall 1（每天的 Darshan、Aumkar 启蒙和女众清晨练习），屋顶是一排横向的小筒拱。一楼房间排布是推测。点「剖视」看二楼。',
  },
  {
    id: 'chandrakund',
    label: 'Chandrakund 月池',
    create: createChandrakund,
    at: [10, 44],
    rotY: AX,
    view: { d: 50, yaw: 0.55, ph: 1.12, h: 1, tz: 14 },
    clear: [
      [0, -3, 17],
      [0, 20, 16],
      [-16, 15, 8],
      [16, 15, 8],
    ],
    pit: [0, -2, 6, 15],
    desc: '女众净身池，紧邻 Dhyanalinga 北侧。入口是红砖拱丘和钢格栅平顶棚，柱脚两只石龟；沿 32 级巨石台阶下到地下 30 英尺，池上是 Kerala 风格的 Mahakumbha Mela 壁画。点下面「· 沿台阶下到池边」可以走进去。',
  },
  {
    id: 'chandra-in',
    label: '　· 沿台阶下到池边',
    at: [10, 44],
    rotY: AX,
    view: { d: 7, yaw: Math.PI - 0.1, ph: 1.45, h: -6.6, tz: -9 },
    desc: '沿 32 级巨石台阶下到地下约 9 米：两侧巨石墙，前方是水池和池中的林伽，头顶是 Mahakumbha Mela 壁画拱顶。',
  },
  {
    id: 'deposit',
    label: 'Deposit Counter 寄存处',
    create: createDepositCounter,
    at: [27, 63],
    rotY: AX,
    view: { d: 34, yaw: -0.5, ph: 1.2, h: 2 },
    clear: [[0, 2, 11]],
    desc: '园区内不许使用手机，访客在这里寄存手机和行李（官方地图上标着手机图标，在 Chandrakund 东北）。外观没有找到照片，造型是推测。',
  },
  {
    id: 'ishalife',
    label: 'Isha Life 与 Peppervine',
    create: createIshaLife,
    at: [57, 52],
    rotY: AX,
    view: { d: 62, yaw: -0.6, ph: 1.15, h: 3, tz: -6 },
    clear: [
      [-8, 2, 12],
      [8, 2, 12],
      [22, -16, 16],
    ],
    desc: 'Isha Life 商店沿主路西侧一字排开，敞开的店面里是货架、展示台和衣架（外观为推测）；它西北侧的 Peppervine Eatery 是分节雕花石柱托着钢桁架顶棚的大敞棚，棚前有养睡莲的石水槽（参照 Wikimedia Commons 的照片）。',
  },
  {
    id: 'welcome',
    label: 'Welcome Point',
    create: createWelcomePoint,
    at: [100, 125],
    rotY: face(-0.987, 0.16),
    view: { d: 40, yaw: -0.6, ph: 1.25, h: 2.5, tz: 2 },
    clear: [
      [0, 0, 18],
      [4, 11, 9],
    ],
    desc: '访客登记、志愿者接待、电话与上网，也是班车和牛车的起点（牛车开往 Bhiksha Hall 附近的 Metal Bridge）。位置取自 Google 地图上的 “Welcome Point - Isha Cottages”，在南北主路东侧；造型参照访客照片：几座深灰瓦四坡顶的低矮柜台棚，竹篾屏风墙，黄墙里是带编号的登记窗口，后面是赭橙色的两层楼，棚前一根雕人面的石柱，路边是木条吊顶的上下客雨棚。',
  },

  {
    id: 'spanda',
    label: 'Spanda Hall',
    create: createSpandaHall,
    at: [174, 205],
    rotY: face(-0.83, -0.56),
    view: { d: 105, yaw: 0.4, ph: 1.15, h: 4, tz: 18 },
    clear: [
      [-18, 0, 30],
      [18, 0, 30],
      [-22, 44, 24],
      [22, 44, 24],
      [0, 50, 18],
    ],
    desc: '约 64,000 平方英尺的课程大厅，Bhava Spandana 等进阶课程在这里进行（参照官网图库）。赭红台基、一圈方石柱外廊、浅灰色低坡四坡金属屋顶，屋脊上一座天窗。前面是赭色夯土墙围起的花园：大草坪、三座石柱小亭、石砌岸的莲池，入口一块巨石。点「剖视」看室内。',
  },
  {
    id: 'spanda-in',
    label: '　· 大厅室内',
    at: [174, 205],
    rotY: face(-0.83, -0.56),
    view: { d: 20, yaw: 0.05, ph: 1.42, h: 2.5, tz: -8 },
    desc: '白色大理石地面，白色藻井天花一圈圈内收、框线上排着灯；正对着的北墙是 140×12 英尺的 Kerala 风格壁画，画的是 Adiyogi（湿婆）的一生，只用植物染料和矿物颜料，号称同类中最大；壁画前是岩石讲座。',
  },

  {
    id: 'alayam',
    label: 'Adiyogi Alayam',
    create: createAdiyogiAlayam,
    at: [250, 62],
    rotY: face(1, 0) - 0.15,
    view: { d: 150, yaw: -0.4, ph: 1.25, h: 6 },
    clear: [
      [-26, -24, 42],
      [26, -24, 42],
      [-26, 24, 42],
      [26, 24, 42],
      [0, 58, 24],
    ],
    desc: '约 82,000 平方英尺的无柱大厅，紧挨 Suryakund 北侧。浅粉色的低拱屋顶，正面敞开，立着雕蛇纹的石柱。',
  },
  {
    id: 'nalanda',
    label: 'Nalanda',
    create: createNalanda,
    at: [3, 396],
    rotY: face(0, -1),
    view: { d: 230, yaw: 0.5, ph: 1.05, h: 4, tz: 60 },
    clear: [
      [-45, -4, 22],
      [0, -4, 22],
      [45, -4, 22],
      [-52, 16, 17],
      [-17, 16, 19],
      [17, 16, 19],
      [52, 16, 17],
      [-34, 14, 14],
      [34, 14, 14],
      [-52, 92, 42],
      [0, 92, 42],
      [44, 92, 42],
      [-52, 130, 42],
      [0, 130, 42],
      [44, 130, 42],
      [-52, 168, 42],
      [0, 168, 42],
      [44, 168, 42],
    ],
    desc: '北侧是 Nalanda Stay：白色三层住宿与会议楼，翼楼之间是弧形屋面罩着的敞厅；南面的大操场 Nalanda Grounds 傍晚用来做游戏。',
  },
  {
    id: 'bhiksha',
    label: 'Bhiksha Hall',
    create: createBhikshaHall,
    at: [222, 353],
    rotY: face(0, -1) - 0.1,
    view: { d: 110, yaw: 0.45, ph: 1.18, h: 4, tz: 8 },
    clear: [
      [-17, -8, 30],
      [17, -8, 30],
      [-17, 10, 30],
      [17, 10, 30],
      [0, 34, 12],
    ],
    desc: '斋堂，在园区北部。约两千人席地成排而坐，在静默中用餐；南面是入口门廊和洗手槽。照片只找到室内的，外观是简化建模。点「剖视」看室内。',
  },
  {
    id: 'metalbridge',
    label: 'Metal Bridge',
    create: createMetalBridge,
    at: [372, 356],
    rotY: 0.161,
    view: { d: 52, yaw: 0.6, ph: 1.2, h: 2 },
    clear: [
      [0, 0, 17],
      [0, -22, 9],
      [0, 22, 9],
    ],
    desc: 'Bhiksha Hall 东北的钢桁架步行桥，跨过山溪通向 Velliangiri Prashala，也是 Welcome Point 牛车线的终点。位置按官方地图估计，桥的样子没有找到照片。桥以外的区域暂未建模。',
  },
  {
    id: 'campus',
    nav: false,
    label: '园区其余建筑',
    create: createCampus,
    at: [0, 0],
    rotY: 0,
    view: { d: 100, yaw: 0, ph: 1, h: 0 },
    clear: [
      [66, -31, 6],
      [250, 102, 8],
      [216, 126, 26],
      [12, -86, 7],
      [150, 78, 7],
      [-43, -134, 27],
      [26, -159, 20],
      [190, -250, 36],
      [150, -300, 22],
      [151, -340, 22],
      [152, -372, 22],
      [168, -268, 9],
      [300, -356, 11],
      [330, -362, 9],
      [334, -16, 7],
      [336, -46, 7],
      [338, -76, 7],
      [340, -106, 7],
    ],
    desc: '',
  },
];
for (const c of COMPONENTS) {
  c.pos = geo(...c.at);
  const cs = Math.cos(c.rotY),
    sn = Math.sin(c.rotY);
  c.toWorld = (lx, lz) => [
    c.pos[0] + lx * cs + lz * sn,
    c.pos[2] - lx * sn + lz * cs,
  ];
  if (c.create)
    for (const [lx, lz, r] of c.clear || []) {
      const [x, z] = c.toWorld(lx, lz);
      EXCLUDE.push([x, z, r]);
    }
  if (c.pit) {
    const [x, z] = c.toWorld(c.pit[0], c.pit[1]);
    PITS.push({ x, z, hw: c.pit[2], hd: c.pit[3], rot: c.rotY });
  }
  const [tx, tz] = c.toWorld(0, c.view.tz || 0);
  c.cam = {
    t: [tx, c.view.h, tz],
    th: c.rotY + c.view.yaw,
    ph: c.view.ph,
    r: c.view.d,
  };
}
const OVERVIEW = { t: [-80, 0, -110], th: 0.62, ph: 1.12, r: 620 };

// ───────────────────────────── [7] 渲染器、相机控制、时段、主流程 ─────────────────────────────
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // 场景静态：阴影只在光照变化时重算

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xe4c5a2, 0.0005);
const camera = new THREE.PerspectiveCamera(
  48,
  innerWidth / innerHeight,
  1.5,
  14000,
);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, {
  left: -780,
  right: 780,
  top: 780,
  bottom: -780,
  near: 100,
  far: 3200,
});
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.7;
// 阴影范围跟着视点走：园区南北跨度近 2 公里，一张固定的阴影图盖不全（Malai Vasal、Kalabhairava 原先没有阴影）。
// 范围随镜头距离缩放：近看时阴影更清晰。只在视点明显移动或缩放时才重算阴影图。
const SH = { x: 1e9, z: 1e9, half: 1, t: 0 };
function fitShadow(x, z, radius, force = false) {
  const half = clamp(radius * 1.2, 110, 900);
  if (
    !force &&
    Math.hypot(x - SH.x, z - SH.z) < half * 0.22 &&
    Math.abs(half / SH.half - 1) < 0.3
  )
    return;
  SH.x = Math.round(x / 4) * 4;
  SH.z = Math.round(z / 4) * 4;
  SH.half = half;
  Object.assign(sun.shadow.camera, {
    left: -half,
    right: half,
    top: half,
    bottom: -half,
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = half / 1100; // 阴影贴图一个像素约 half/2048 米，偏移量跟着缩放
  sun.target.position.set(SH.x, 0, SH.z);
  sun.target.updateMatrixWorld();
  sun.position.copy(sunDir).multiplyScalar(1500).add(sun.target.position);
  renderer.shadowMap.needsUpdate = true;
}
scene.add(hemi, sun, sun.target);

const terrain = { groundHeight: groundH, pits: PITS };
const controls = createControls(camera, canvas, OVERVIEW, terrain);
const walker = createWalker(camera, canvas, scene, terrain);

// —— 时段切换 ——
const cloneMood = (m) => {
  const o = {};
  for (const k in m) o[k] = m[k].isColor ? m[k].clone() : m[k];
  return o;
};
const state = cloneMood(MOODS.dawn);
let moodTarget = MOODS.dawn,
  moodT = 0,
  sky;
const sunDir = new V3(),
  tmpC = new Color();
function applyMood() {
  const s = state;
  sunDir.set(
    Math.cos(s.el) * Math.cos(s.az),
    Math.sin(s.el),
    Math.cos(s.el) * Math.sin(s.az),
  );
  sun.position.copy(sunDir).multiplyScalar(1500).add(sun.target.position);
  sun.color.copy(s.sunCol);
  sun.intensity = s.sunInt;
  hemi.color.copy(s.hemiSky);
  hemi.groundColor.copy(s.hemiGnd);
  hemi.intensity = s.hemiInt;
  scene.fog.color.copy(s.fog);
  scene.fog.density = s.fogD;
  renderer.toneMappingExposure = s.exposure;
  if (sky) {
    const u = sky.userData.mat.uniforms;
    u.top.value.copy(s.top);
    u.horizon.value.copy(s.horizon);
    u.sunDir.value.copy(sunDir);
    u.sunCol.value.copy(s.sunCol).multiplyScalar(s.sunInt / 2.7);
    sky.userData.stars.material.opacity = s.stars;
  }
  for (const { mat, base } of FX.emissive)
    mat.emissiveIntensity = base * (0.3 + s.lamp);
  for (const { mat, base } of FX.glows)
    mat.opacity = base * (0.18 + 0.82 * s.lamp);
  for (const { light, base } of FX.lights)
    light.intensity = base * s.lamp * s.lamp;
  for (const { mat, kind } of FX.tint)
    mat.color.copy(
      kind === 'mist' ? s.fog : tmpC.copy(s.horizon).lerp(s.sunCol, 0.35),
    );
  renderer.shadowMap.needsUpdate = true;
}
function setMood(key) {
  moodTarget = MOODS[key];
  moodT = 4;
  document
    .querySelectorAll('#moods button[data-k]')
    .forEach((b) => b.classList.toggle('on', b.dataset.k === key));
}
function stepMood(dt) {
  if (moodT <= 0) return;
  moodT -= dt;
  const k = moodT <= 0 ? 1 : 1 - Math.exp(-dt * 2.2);
  for (const key in moodTarget) {
    const v = moodTarget[key];
    if (v.isColor) state[key].lerp(v, k);
    else if (typeof v === 'number') state[key] = lerp(state[key], v, k);
  }
  applyMood();
}
// —— 剖视：隐藏所有标记为屋顶的物体 ——
let roofsHidden = false;
function setRoofs(hidden) {
  roofsHidden = hidden;
  scene.traverse((o) => {
    if (o.userData.roof) o.visible = !hidden;
  });
  renderer.shadowMap.needsUpdate = true;
}
// —— 行人与牛车开关：所有标记 userData.npc 的人群、走动的行人和牛车 ——
let peopleOn = true;
function setPeople(on) {
  peopleOn = on;
  scene.traverse((o) => {
    if (o.userData.npc) o.visible = on;
  });
  renderer.shadowMap.needsUpdate = true;
  try {
    localStorage.setItem('isha.people', on ? '1' : '0');
  } catch {
    // Storage may be blocked by the browser.
  }
}

// —— 界面 ——
function showInfo(title, desc) {
  $('#info h2').textContent = title;
  $('#info p').textContent = desc;
}
function buildUI() {
  for (const k in MOODS) {
    const b = document.createElement('button');
    b.textContent = MOODS[k].name;
    b.dataset.k = k;
    b.onclick = () => setMood(k);
    if (k === 'dawn') b.classList.add('on');
    $('#moods').append(b);
  }
  const cut = document.createElement('button');
  cut.textContent = '剖视';
  cut.title = '隐藏屋顶，查看室内';
  cut.onclick = () => {
    setRoofs(!roofsHidden);
    cut.classList.toggle('on', roofsHidden);
  };
  $('#moods').append(cut);
  // 漫步：从当前视点前方落地，以第一人称走动
  const walk = document.createElement('button');
  walk.textContent = '漫步';
  walk.title =
    '第一人称漫步：WASD / 方向键走，拖动看四周，Shift 跑，F 飞行，Esc 退出';
  const hint0 = $('#hint').textContent;
  const walkHint = () => {
    $('#hint').textContent = walker.fly
      ? '飞行中 · WASD 移动 · Space / E 升 · Q / C 降 · F 回到地面 · Esc 退出'
      : 'WASD / 方向键 走 · 拖动看四周 · Shift 跑 · F 飞行 · Esc 退出';
  };
  const startWalk = () => {
    const back = Math.min(controls.radius * 0.5, 14),
      th = controls.theta;
    controls.enabled = false;
    walker.enter(
      controls.target.x + Math.sin(th) * back,
      controls.target.z + Math.cos(th) * back,
      th,
    );
    walk.classList.add('on');
    walkHint();
    showInfo(
      '漫步',
      '像走在园区里一样四处看看。键盘：WASD 或方向键走，Shift 跑，F 切换飞行；鼠标或手指拖动看四周；触屏用左下角的摇杆。按 Esc 或再点「漫步」回到俯瞰。',
    );
  };
  const stopWalk = () => {
    if (!walker.on) return;
    const p = walker.pos,
      sy = Math.sin(walker.yaw),
      cy = Math.cos(walker.yaw);
    walker.exit();
    controls.enabled = true;
    walk.classList.remove('on');
    $('#hint').textContent = hint0;
    controls.jump({
      t: [p.x - sy * 12, p.y + 1.5, p.z - cy * 12],
      th: walker.yaw,
      ph: 1.32,
      r: 26,
    });
    showInfo(
      '俯瞰',
      '已回到俯瞰视角。点左下角的地点可以飞过去，或者再点「漫步」走走看。',
    );
  };
  walker.onExit = stopWalk;
  walker.onMode = walkHint;
  walk.onclick = () => (walker.on ? stopWalk() : startWalk());
  $('#moods').append(walk);
  // 行人：显示 / 隐藏园区里的人群和牛车（会记住上次的选择）
  const ppl = document.createElement('button');
  ppl.textContent = '行人';
  ppl.title = '显示 / 隐藏园区里的行人、人群和牛车';
  let saved = null;
  try {
    saved = localStorage.getItem('isha.people');
  } catch {
    // Storage may be blocked by the browser.
  }
  if (saved === '0') setPeople(false);
  ppl.classList.toggle('on', peopleOn);
  ppl.onclick = () => {
    setPeople(!peopleOn);
    ppl.classList.toggle('on', peopleOn);
  };
  $('#moods').append(ppl);
  const add = (label, view, desc) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => {
      stopWalk();
      document.body.classList.remove('navOpen');
      controls.flyTo(view);
      showInfo(label, desc);
      document
        .querySelectorAll('#nav button')
        .forEach((x) => x.classList.toggle('on', x === b));
    };
    $('#nav').append(b);
    return b;
  };
  const ov =
    '位置、朝向与间距按 OpenStreetMap 实测坐标 1:1 摆放，并对照 Isha 官方 2026 园区地图核对；建筑内外参照官网与访客照片建模。Adiyogi 在东南、面朝正南；韦灵吉里群山在西侧。点右上角「剖视」可掀开屋顶看室内。';
  add('全景', OVERVIEW, ov).classList.add('on');
  // 分区：蛇门外（公开区域，资料来自公开照片与地图）/ 蛇门内（园区，只依据已公开的照片）
  const head = (t) => {
    const h = document.createElement('div');
    h.className = 'navh';
    h.textContent = t;
    $('#nav').append(h);
  };
  head('蛇门外 · 公开区域');
  for (const c of COMPONENTS)
    if (c.nav !== false && c.zone === 'out') add(c.label, c.cam, c.desc);
  head('蛇门内 · 园区');
  for (const c of COMPONENTS)
    if (c.nav !== false && c.zone !== 'out') add(c.label, c.cam, c.desc);
  const ZV = {
    out: { t: [300, 0, 820], th: 0.35, ph: 0.95, r: 1100 },
    in: { t: [-150, 0, -260], th: 0.62, ph: 1.05, r: 520 },
  };
  const zb = {};
  [
    ['all', '全部'],
    ['out', '蛇门外'],
    ['in', '蛇门内'],
  ].forEach(([k, t]) => {
    const b = document.createElement('button');
    b.textContent = t;
    b.title = k === 'all' ? '显示全部' : '只显示' + t + '的建筑';
    zb[k] = b;
    b.onclick = () => {
      for (const c of COMPONENTS)
        if (c.object && c.id !== 'campus')
          c.object.visible =
            k === 'all' || (c.zone === 'out') === (k === 'out');
      Object.values(zb).forEach((x) => x.classList.toggle('on', x === b));
      renderer.shadowMap.needsUpdate = true;
      if (ZV[k] && !walker.on) controls.flyTo(ZV[k]);
    };
    $('#moods').prepend(b);
  });
  zb.all.classList.add('on');
  $('#moods').prepend(zb.all, zb.out, zb.in);
  showInfo('全景', ov);
  $('#navBtn').onclick = () => document.body.classList.toggle('navOpen');
}

// —— 分步构建（每步之间让出一帧，进度条才能真实刷新） ——
const updaters = [];
const addToScene = (o) => {
  scene.add(o);
  if (o.userData.update) updaters.push(o.userData.update);
  return o;
};
const steps = [
  [
    '生成贴图与材质',
    () => {
      buildTextures();
      buildMaterials();
      buildExtras();
    },
  ],
  [
    '天空与雾气',
    () => {
      sky = addToScene(createSky());
      sky.add(sky.userData.mist);
      applyMood();
    },
  ],
  ['韦灵吉里群山', () => addToScene(createTerrain())],
  ['铺设道路', () => addToScene(createPaths())],
  ...COMPONENTS.filter((c) => c.create).map((c) => [
    c.label,
    () => {
      const g = c.create();
      g.name = c.id;
      g.position.set(...c.pos);
      g.rotation.y = c.rotY;
      c.object = addToScene(g);
    },
  ]),
  ['种下椰林与树木', () => addToScene(createVegetation())],
  ['行人与牛车', () => addToScene(createPeople())],
  [
    '点亮油灯',
    () => {
      addToScene(createLamps());
      addToScene(createDust());
    },
  ],
  [
    '编译着色器',
    () => {
      applyMood();
      controls.update(0);
      fitShadow(controls.target.x, controls.target.z, controls.radius, true);
      renderer.compile(scene, camera);
      renderer.render(scene, camera);
    },
  ],
];
for (let i = 0; i < steps.length; i++) {
  setProgress(0.06 + (0.94 * i) / steps.length, steps[i][0] + '…');
  await nextFrame();
  await nextFrame();
  steps[i][1]();
}
setProgress(1, '完成');
buildUI();
window.ISHA = {
  THREE,
  scene,
  camera,
  renderer,
  controls,
  walker,
  COMPONENTS,
  MOODS,
  setMood,
  setRoofs,
  setPeople,
  geo,
  fitShadow,
}; // 方便在控制台里调试 / 修改
await nextFrame();
$('#loader').classList.add('done');
document.body.classList.add('ready');

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// —— 主循环（含自适应分辨率：帧率不足时自动降低像素比） ——
const clock = new THREE.Clock();
let acc = 0,
  frames = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1),
    t = clock.elapsedTime;
  stepMood(dt);
  if (walker.on) {
    walker.update(dt);
    fitShadow(walker.pos.x, walker.pos.z, 120);
  } else {
    controls.update(dt);
    fitShadow(controls.target.x, controls.target.z, controls.radius);
  }
  sky.position.copy(camera.position);
  TEX.water.offset.set(t * 0.012, t * 0.008);
  TEX.fall.offset.y = t * 0.6;
  for (const u of updaters) u(t, dt);
  const flick = 0.9 + 0.1 * Math.sin(t * 9) * Math.sin(t * 5.3);
  for (const { light, base } of FX.lights)
    light.intensity = base * state.lamp * state.lamp * flick;
  renderer.render(scene, camera);
  acc += dt;
  frames++;
  if (frames === 90) {
    if (t > 3 && acc / frames > 1 / 34 && pixelRatio > 0.75) {
      pixelRatio = Math.max(0.75, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
    }
    acc = 0;
    frames = 0;
  }
});
