import {
  Box3,
  InstancedMesh,
  Matrix3,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { clamp, lerp } from './math';

interface CameraView {
  t: readonly [number, number, number];
  th: number;
  ph: number;
  r: number;
}

interface TerrainPit {
  x: number;
  z: number;
  rot: number;
  hw: number;
  hd: number;
}

interface CameraTerrain {
  groundHeight(x: number, z: number): number;
  pits: readonly TerrainPit[];
}

interface PointerPosition {
  x: number;
  y: number;
}

interface Walker {
  on: boolean;
  fly: boolean;
  pos: Vector3;
  yaw: number;
  pitch: number;
  vy: number;
  keys: Set<string>;
  joy: { x: number; y: number; id: number | null };
  eye: number;
  enter(x: number, z: number, yaw: number): void;
  exit(): void;
  update(dt: number): void;
  onExit?: () => void;
  onMode?: () => void;
}

function isInPit(x: number, z: number, pits: readonly TerrainPit[]) {
  return pits.some((pit) => {
    const dx = x - pit.x;
    const dz = z - pit.z;
    const cos = Math.cos(pit.rot);
    const sin = Math.sin(pit.rot);
    return (
      Math.abs(cos * dx - sin * dz) < pit.hw &&
      Math.abs(sin * dx + cos * dz) < pit.hd
    );
  });
}

// —— 轨道相机（自带实现，无需额外依赖） ——
export function createControls(
  cam: PerspectiveCamera,
  el: HTMLCanvasElement,
  overview: CameraView,
  terrain: CameraTerrain,
) {
  const c = {
    target: new Vector3(...overview.t),
    theta: overview.th - 0.5,
    phi: 1.05,
    radius: 1250,
    auto: true,
    fly: 0,
    enabled: true,
    flyTo,
    jump,
    update,
  };
  const goal = {
    target: new Vector3(...overview.t),
    theta: overview.th,
    phi: overview.ph,
    radius: overview.r,
  };
  const ptrs = new Map<number, PointerPosition & { b: number }>();
  let pinch = 0;
  const pan = (dx: number, dy: number) => {
    const k = goal.radius * 0.0016,
      th = c.theta;
    goal.target.x += (-Math.cos(th) * dx - Math.sin(th) * dy) * k;
    goal.target.z += (Math.sin(th) * dx - Math.cos(th) * dy) * k;
  };
  el.addEventListener('pointerdown', (e) => {
    if (!c.enabled) return;
    el.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button });
    c.auto = false;
  });
  el.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p || !c.enabled) return;
    const dx = e.clientX - p.x,
      dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()],
        d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) goal.radius = clamp((goal.radius * pinch) / d, 6, 1800);
      pinch = d;
      pan(dx * 0.5, dy * 0.5);
      return;
    }
    if (p.b === 2 || e.shiftKey) pan(dx, dy);
    else {
      goal.theta -= dx * 0.005;
      goal.phi = clamp(goal.phi - dy * 0.005, 0.18, 1.53);
    }
  });
  const up = (e: PointerEvent) => {
    ptrs.delete(e.pointerId);
    pinch = 0;
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (!c.enabled) return;
      c.auto = false;
      goal.radius = clamp(goal.radius * Math.exp(e.deltaY * 0.0012), 6, 2200);
    },
    { passive: false },
  );
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  function flyTo(v: CameraView) {
    goal.target.set(...v.t);
    goal.phi = v.ph;
    goal.radius = v.r;
    c.auto = false;
    c.fly = 2.4;
    let th = v.th;
    while (th - c.theta > Math.PI) th -= Math.PI * 2;
    while (th - c.theta < -Math.PI) th += Math.PI * 2;
    goal.theta = th;
  }
  function jump(v: CameraView) {
    c.flyTo(v);
    c.fly = 0;
    c.target.copy(goal.target);
    c.theta = goal.theta;
    c.phi = goal.phi;
    c.radius = goal.radius;
  }
  function update(dt: number) {
    if (c.auto) goal.theta += dt * 0.015;
    c.fly = Math.max(0, c.fly - dt);
    goal.target.x = clamp(goal.target.x, -800, 900);
    goal.target.z = clamp(goal.target.z, -850, 1700); // 南边要能看到 Malai Vasal 与停车场
    const k = 1 - Math.exp(-dt * (c.fly > 0 || c.auto ? 2.6 : 7));
    c.target.lerp(goal.target, k);
    c.theta = lerp(c.theta, goal.theta, k);
    c.phi = lerp(c.phi, goal.phi, k);
    c.radius = lerp(c.radius, goal.radius, k);
    const sp = Math.sin(c.phi);
    cam.position.set(
      c.target.x + c.radius * sp * Math.sin(c.theta),
      c.target.y + c.radius * Math.cos(c.phi),
      c.target.z + c.radius * sp * Math.cos(c.theta),
    );
    // 下沉的池子（PITS）里允许相机降到地面以下，这样才能沿台阶走进 Chandrakund、Suryakund
    if (!isInPit(cam.position.x, cam.position.z, terrain.pits))
      cam.position.y = Math.max(
        cam.position.y,
        terrain.groundHeight(cam.position.x, cam.position.z) + 2,
      );
    cam.lookAt(c.target);
  }
  return c;
}
// —— 漫步模式（第一人称）——
// WASD / 方向键走，拖动看四周，Shift 跑，F 切换飞行（不受地面和墙阻挡，Space / E 升、Q / C 降），Esc 退出。
// 触屏：左下角摇杆走，其余地方拖动看。脚下高度用向下的射线找“最高的地面”（台阶、桥、楼板都算），
// 墙用水平射线挡住；只在玩家附近 16 米格子里的物体上做射线，草木、路灯、人群、半透明物体不参与。
export function createWalker(
  cam: PerspectiveCamera,
  el: HTMLCanvasElement,
  scene: Scene,
  terrain: CameraTerrain,
): Walker {
  const w: Walker = {
    on: false,
    fly: false,
    pos: new Vector3(),
    yaw: 0,
    pitch: 0,
    vy: 0,
    keys: new Set(),
    joy: { x: 0, y: 0, id: null },
    eye: 1.62,
    enter,
    exit,
    update,
  };
  const ray = new Raycaster(),
    down = new Vector3(0, -1, 0),
    tmp = new Vector3(),
    o = new Vector3(),
    nrm = new Matrix3();
  const CELL = 16,
    grid = new Map<number, Mesh[]>();
  let built = false;
  const key = (i: number, k: number) => i * 100003 + k;
  const SKIP = new Set([
    'Sky',
    'Terrain',
    'Vegetation',
    'Lamps',
    'Dust',
    'People',
  ]);
  function build() {
    built = true;
    const box = new Box3();
    scene.updateMatrixWorld(true);
    for (const top of scene.children) {
      if (SKIP.has(top.name)) continue;
      top.traverse((m) => {
        if (!(m instanceof Mesh)) return;
        for (let q: Object3D | null = m; q; q = q.parent)
          if (q.userData.npc) return; // 人群、牛车不挡路
        const mat = Array.isArray(m.material) ? m.material[0] : m.material;
        if (!mat || mat.transparent || mat instanceof MeshBasicMaterial) return;
        if (m instanceof InstancedMesh && m.count > 150) return; // 成群的人、成排的小物件：太多实例，射线代价高，也不挡路
        box.setFromObject(m);
        if (box.isEmpty()) return;
        const i0 = Math.floor(box.min.x / CELL),
          i1 = Math.floor(box.max.x / CELL),
          k0 = Math.floor(box.min.z / CELL),
          k1 = Math.floor(box.max.z / CELL);
        if ((i1 - i0 + 1) * (k1 - k0 + 1) > 400) return; // 特别大的面（远处的草场）交给地形
        for (let i = i0; i <= i1; i++)
          for (let k = k0; k <= k1; k++) {
            const kk = key(i, k);
            const meshes = grid.get(kk);
            if (meshes) meshes.push(m);
            else grid.set(kk, [m]);
          }
      });
    }
  }
  const visible = (m: Object3D) => {
    for (let q: Object3D | null = m; q; q = q.parent)
      if (!q.visible) return false;
    return true;
  };
  function near(x: number, z: number) {
    const i = Math.floor(x / CELL),
      k = Math.floor(z / CELL),
      set = new Set<Mesh>();
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const m of grid.get(key(i + a, k + b)) || [])
          if (visible(m)) set.add(m);
    return [...set];
  }
  // 脚下的地面高度：从膝盖高度往下打射线，取第一个朝上的面；没打到就用地形（水池坑里没有地形）
  function floorAt(x: number, z: number, feet: number, objs: Mesh[]) {
    o.set(x, feet + 0.75, z);
    ray.set(o, down);
    ray.far = 40;
    for (const h of ray.intersectObjects(objs, false)) {
      if (!h.face) return h.point.y;
      nrm.getNormalMatrix(h.object.matrixWorld);
      tmp.copy(h.face.normal).applyMatrix3(nrm).normalize();
      if (tmp.y > 0.45) return h.point.y;
    }
    return isInPit(x, z, terrain.pits) ? -40 : terrain.groundHeight(x, z);
  }
  function blockedMove(
    x: number,
    z: number,
    dx: number,
    dz: number,
    feet: number,
    objs: Mesh[],
  ) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) return false;
    tmp.set(dx / len, 0, dz / len);
    for (const hgt of [0.9, 1.5]) {
      o.set(x, feet + hgt, z);
      ray.set(o, tmp);
      ray.far = len + 0.35;
      if (ray.intersectObjects(objs, false).length) return true;
    }
    return false;
  }
  function enter(x: number, z: number, yaw: number) {
    if (!built) build();
    w.on = true;
    w.fly = false;
    w.vy = 0;
    w.yaw = yaw;
    w.pitch = -0.04;
    w.pos.set(x, 0, z);
    w.pos.y = floorAt(x, z, 200, near(x, z));
    cam.near = 0.15;
    cam.far = 9000;
    cam.updateProjectionMatrix();
    document.body.classList.add('walking');
  }
  function exit() {
    w.on = false;
    w.keys.clear();
    w.joy.x = w.joy.y = 0;
    cam.near = 1.5;
    cam.far = 14000;
    cam.updateProjectionMatrix();
    document.body.classList.remove('walking');
  }
  // 输入
  addEventListener('keydown', (e) => {
    if (
      !w.on ||
      (e.target instanceof HTMLElement && e.target.closest('input, select'))
    )
      return;
    if (e.code === 'Escape') {
      w.onExit?.();
      return;
    }
    if (e.code === 'KeyF') {
      w.fly = !w.fly;
      w.vy = 0;
      w.onMode?.();
      return;
    }
    w.keys.add(e.code);
    if (/^(Arrow|Space)/.test(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => w.keys.delete(e.code));
  addEventListener('blur', () => w.keys.clear());
  const look = new Map<number, PointerPosition>();
  el.addEventListener('pointerdown', (e) => {
    if (!w.on) return;
    el.setPointerCapture(e.pointerId);
    look.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  el.addEventListener('pointermove', (e) => {
    const p = look.get(e.pointerId);
    if (!p || !w.on) return;
    const k = e.pointerType === 'touch' ? 0.006 : 0.0042;
    w.yaw += (e.clientX - p.x) * k;
    w.pitch = clamp(w.pitch + (e.clientY - p.y) * k, -1.35, 1.35);
    p.x = e.clientX;
    p.y = e.clientY;
  });
  const lookUp = (e: PointerEvent) => look.delete(e.pointerId);
  el.addEventListener('pointerup', lookUp);
  el.addEventListener('pointercancel', lookUp);
  const joy = document.getElementById('joy');
  const knob = joy?.querySelector('i');
  if (!joy || !knob) throw new Error('Missing walking joystick markup');
  addEventListener('touchstart', () => joy.classList.add('touch'), {
    once: true,
    passive: true,
  });
  const joyMove = (e: PointerEvent) => {
    const r = joy.getBoundingClientRect(),
      R = r.width / 2;
    let x = (e.clientX - r.left - R) / R,
      y = (e.clientY - r.top - R) / R;
    const d = Math.hypot(x, y);
    if (d > 1) {
      x /= d;
      y /= d;
    }
    w.joy.x = x;
    w.joy.y = y;
    knob.style.transform = `translate(${x * R * 0.6}px,${y * R * 0.6}px)`;
  };
  joy.addEventListener('pointerdown', (e) => {
    joy.setPointerCapture(e.pointerId);
    w.joy.id = e.pointerId;
    joyMove(e);
  });
  joy.addEventListener('pointermove', (e) => {
    if (e.pointerId === w.joy.id) joyMove(e);
  });
  const joyUp = (e: PointerEvent) => {
    if (e.pointerId !== w.joy.id) return;
    w.joy.id = null;
    w.joy.x = w.joy.y = 0;
    knob.style.transform = '';
  };
  joy.addEventListener('pointerup', joyUp);
  joy.addEventListener('pointercancel', joyUp);
  // 每帧
  function update(dt: number) {
    const K = w.keys,
      run = K.has('ShiftLeft') || K.has('ShiftRight');
    let f =
      (K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) -
      (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0) -
      w.joy.y;
    let r =
      (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) -
      (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0) +
      w.joy.x;
    const m = Math.hypot(f, r);
    if (m > 1) {
      f /= m;
      r /= m;
    }
    const speed = (w.fly ? 14 : 2.4) * (run ? 3 : 1),
      sy = Math.sin(w.yaw),
      cy = Math.cos(w.yaw);
    const dx = (-sy * f + cy * r) * speed * dt,
      dz = (-cy * f - sy * r) * speed * dt;
    if (w.fly) {
      w.pos.x += dx;
      w.pos.z += dz;
      w.pos.y +=
        ((K.has('Space') || K.has('KeyE') ? 1 : 0) -
          (K.has('KeyQ') || K.has('KeyC') ? 1 : 0)) *
        speed *
        dt;
      w.pos.y = Math.max(
        w.pos.y,
        isInPit(w.pos.x, w.pos.z, terrain.pits)
          ? -40
          : terrain.groundHeight(w.pos.x, w.pos.z),
      );
    } else {
      const objs = near(w.pos.x, w.pos.z);
      if (!blockedMove(w.pos.x, w.pos.z, dx, dz, w.pos.y, objs)) {
        w.pos.x += dx;
        w.pos.z += dz;
      } else if (!blockedMove(w.pos.x, w.pos.z, dx, 0, w.pos.y, objs))
        w.pos.x += dx; // 贴着墙滑行
      else if (!blockedMove(w.pos.x, w.pos.z, 0, dz, w.pos.y, objs))
        w.pos.z += dz;
      const fl = floorAt(w.pos.x, w.pos.z, w.pos.y, objs);
      if (fl >= w.pos.y - 0.05) {
        w.pos.y = lerp(w.pos.y, fl, 1 - Math.exp(-dt * 18));
        w.vy = 0;
      } // 上台阶：平滑抬升
      else {
        w.vy -= 9.8 * dt;
        w.pos.y = Math.max(fl, w.pos.y + w.vy * dt);
        if (w.pos.y === fl) w.vy = 0;
      }
    }
    w.pos.x = clamp(w.pos.x, -1200, 1300);
    w.pos.z = clamp(w.pos.z, -1300, 1900);
    cam.position.set(w.pos.x, w.pos.y + w.eye, w.pos.z);
    cam.rotation.set(w.pitch, w.yaw, 0, 'YXZ');
  }
  return w;
}
