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

// Orbit camera, implemented without additional dependencies.
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
  const ptrs = new Map<
    number,
    PointerPosition & { b: number; touch: boolean }
  >();
  let pinch = 0;
  let doubleClickDrag = false;
  const pan = (dx: number, dy: number) => {
    const k = goal.radius * 0.0016,
      th = c.theta;
    goal.target.x += (-Math.cos(th) * dx - Math.sin(th) * dy) * k;
    goal.target.z += (Math.sin(th) * dx - Math.cos(th) * dy) * k;
  };
  el.addEventListener('pointerdown', (e) => {
    if (!c.enabled) return;
    el.setPointerCapture(e.pointerId);
    const touch = e.pointerType === 'touch';
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, touch });
    if (touch) pinch = 0;
    if (e.pointerType === 'mouse') doubleClickDrag = false;
    c.auto = false;
  });
  el.addEventListener('mousedown', (e) => {
    // Touchpad tap-and-drag holds the primary button on the second press.
    if (e.button === 0) doubleClickDrag = e.detail === 2;
  });
  el.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p || !c.enabled) return;
    const dx = e.clientX - p.x,
      dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (p.touch && ptrs.size > 1) {
      const touches = [...ptrs.values()].filter((pointer) => pointer.touch);
      if (touches.length >= 3) {
        // Each move contributes its share of the touch centroid's movement.
        pan(dx / touches.length, dy / touches.length);
        return;
      }
      if (touches.length === 2) {
        const [a, b] = touches;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch && d) goal.radius = clamp((goal.radius * pinch) / d, 6, 1800);
        pinch = d;
        pan(dx * 0.5, dy * 0.5);
        return;
      }
    }
    if (
      p.b === 2 ||
      e.shiftKey ||
      (p.b === 0 && e.pointerType === 'mouse' && doubleClickDrag)
    )
      pan(dx, dy);
    else {
      goal.theta -= dx * 0.005;
      goal.phi = clamp(goal.phi - dy * 0.005, 0.18, 1.53);
    }
  });
  const up = (e: PointerEvent) => {
    if (ptrs.get(e.pointerId)?.touch) pinch = 0;
    ptrs.delete(e.pointerId);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
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
    goal.target.z = clamp(goal.target.z, -850, 1700); // Include Malai Vasal and the parking area to the south.
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
    // Let the camera follow the steps below ground into Chandrakund and Suryakund.
    if (!isInPit(cam.position.x, cam.position.z, terrain.pits))
      cam.position.y = Math.max(
        cam.position.y,
        terrain.groundHeight(cam.position.x, cam.position.z) + 2,
      );
    cam.lookAt(c.target);
  }
  return c;
}
// First-person movement. The joystick handles walking on touchscreens.
// Downward rays find floors, stairs, and bridges. Horizontal rays handle walls.
// The collision grid uses 16-meter cells and skips vegetation, lamps, people, and translucent meshes.
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
    up = new Vector3(0, 1, 0),
    down = new Vector3(0, -1, 0),
    tmp = new Vector3(),
    o = new Vector3(),
    nrm = new Matrix3();
  const CELL = 16,
    grid = new Map<number, Mesh[]>();
  const minX = -1200,
    maxX = 1300,
    minZ = -1300,
    maxZ = 1900;
  const bodyRadius = 0.35;
  const doubleTapMs = 300;
  const touchVerticalSpeed = 6;
  const risePointers = new Set<number>();
  const descendPointers = new Map<number, number>();
  const riseButton = document.getElementById('touch-rise');
  const descendButton = document.getElementById('touch-descend');
  if (!riseButton || !descendButton) {
    throw new Error('Missing touch flight controls');
  }
  let movingFor = 0;
  let lastSpacePress = -Infinity;
  let lastDescendTap = -Infinity;
  const landingDirections = Array.from({ length: 16 }, (_, i) => {
    const angle = (i * Math.PI) / 8;
    return [Math.cos(angle), Math.sin(angle)] as const;
  });
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
          if (q.userData.npc) return; // People and bullock carts do not block movement.
        const mat = Array.isArray(m.material) ? m.material[0] : m.material;
        if (!mat || mat.transparent || mat instanceof MeshBasicMaterial) return;
        if (m instanceof InstancedMesh && m.count > 150) return; // Skip dense clusters of small objects.
        box.setFromObject(m);
        if (box.isEmpty()) return;
        const i0 = Math.floor(box.min.x / CELL),
          i1 = Math.floor(box.max.x / CELL),
          k0 = Math.floor(box.min.z / CELL),
          k1 = Math.floor(box.max.z / CELL);
        if ((i1 - i0 + 1) * (k1 - k0 + 1) > 400) return; // Terrain height covers large surfaces such as distant fields.
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
  // Use the first upward-facing surface under the ray origin. Pits have no terrain floor.
  function floorSurface(
    x: number,
    z: number,
    top: number,
    range: number,
    objs: Mesh[],
  ) {
    o.set(x, top, z);
    ray.set(o, down);
    ray.far = range;
    for (const h of ray.intersectObjects(objs, false)) {
      if (!h.face) return h.point.y;
      nrm.getNormalMatrix(h.object.matrixWorld);
      tmp.copy(h.face.normal).applyMatrix3(nrm).normalize();
      if (tmp.y > 0.45) return h.point.y;
    }
  }
  function terrainSurface(x: number, z: number) {
    return isInPit(x, z, terrain.pits) ? undefined : terrain.groundHeight(x, z);
  }
  function floorAt(x: number, z: number, feet: number, objs: Mesh[]) {
    return (
      floorSurface(x, z, feet + 0.75, 40, objs) ?? terrainSurface(x, z) ?? -40
    );
  }
  function blockedMove(
    x: number,
    z: number,
    dx: number,
    dz: number,
    feet: number,
    objs: Mesh[],
    padding = bodyRadius,
  ) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) return false;
    tmp.set(dx / len, 0, dz / len);
    for (const hgt of [0.9, 1.5]) {
      o.set(x, feet + hgt, z);
      ray.set(o, tmp);
      ray.far = len + padding;
      if (ray.intersectObjects(objs, false).length) return true;
    }
    return false;
  }
  function landingHeight(x: number, z: number, top: number) {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return;
    const objs = near(x, z);
    const feet =
      floorSurface(x, z, top, Infinity, objs) ?? terrainSurface(x, z);
    if (feet === undefined || feet > top) return;

    o.set(x, feet + 0.05, z);
    ray.set(o, up);
    ray.far = w.eye + 0.1;
    if (ray.intersectObjects(objs, false).length) return;

    // Check for room to stand and enough floor to support both feet.
    for (let i = 0; i < landingDirections.length; i += 4) {
      const [dx, dz] = landingDirections[i];
      const offsetX = dx * bodyRadius;
      const offsetZ = dz * bodyRadius;
      const sx = x + offsetX;
      const sz = z + offsetZ;
      if (blockedMove(sx, sz, -2 * offsetX, -2 * offsetZ, feet, objs, 0))
        return;
      const support =
        floorSurface(sx, sz, feet + 0.35, 0.7, objs) ?? terrainSurface(sx, sz);
      if (support === undefined || Math.abs(support - feet) > 0.35) return;
    }
    return feet;
  }
  function findLanding(x: number, z: number, top: number) {
    const direct = landingHeight(x, z, top);
    if (direct !== undefined) return new Vector3(x, direct, z);
    for (let radius = 0.5; radius <= 24; radius += radius < 4 ? 0.5 : 2) {
      for (const [dx, dz] of landingDirections) {
        const px = x + dx * radius;
        const pz = z + dz * radius;
        const feet = landingHeight(px, pz, top);
        if (feet !== undefined) return new Vector3(px, feet, pz);
      }
    }
  }
  function enter(x: number, z: number, yaw: number) {
    if (!built) build();
    x = clamp(x, minX, maxX);
    z = clamp(z, minZ, maxZ);
    const landing = findLanding(x, z, cam.position.y);
    w.on = true;
    setFlight(landing === undefined);
    w.yaw = yaw;
    w.pitch = -0.04;
    if (landing) w.pos.copy(landing);
    else w.pos.set(x, cam.position.y - w.eye, z);
    cam.near = 0.15;
    cam.far = 9000;
    cam.updateProjectionMatrix();
    document.body.classList.add('walking');
  }
  function exit() {
    w.on = false;
    w.keys.clear();
    movingFor = 0;
    lastSpacePress = -Infinity;
    lastDescendTap = -Infinity;
    risePointers.clear();
    descendPointers.clear();
    w.joy.x = w.joy.y = 0;
    cam.near = 1.5;
    cam.far = 14000;
    cam.updateProjectionMatrix();
    document.body.classList.remove('walking');
  }
  const setFlight = (flying: boolean) => {
    w.fly = flying;
    w.vy = 0;
    movingFor = 0;
    lastSpacePress = -Infinity;
    lastDescendTap = -Infinity;
    risePointers.clear();
    descendPointers.clear();
    descendButton.hidden = !flying;
    w.onMode?.();
  };

  // Input handlers.
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
      if (!e.repeat) setFlight(!w.fly);
      return;
    }
    if (e.code === 'Space' && !e.repeat) {
      if (e.timeStamp - lastSpacePress <= doubleTapMs) setFlight(!w.fly);
      else lastSpacePress = e.timeStamp;
    }
    w.keys.add(e.code);
    if (/^(Arrow|Space)/.test(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => w.keys.delete(e.code));
  addEventListener('blur', () => {
    w.keys.clear();
    movingFor = 0;
    lastSpacePress = -Infinity;
    lastDescendTap = -Infinity;
    risePointers.clear();
    descendPointers.clear();
  });
  riseButton.addEventListener('click', () => {
    if (w.on && !w.fly) setFlight(true);
  });
  riseButton.addEventListener('pointerdown', (e) => {
    if (!w.on || e.button !== 0) return;
    if (!w.fly) setFlight(true);
    lastDescendTap = -Infinity;
    riseButton.setPointerCapture(e.pointerId);
    risePointers.add(e.pointerId);
  });
  const releaseRise = (e: PointerEvent) => risePointers.delete(e.pointerId);
  riseButton.addEventListener('pointerup', releaseRise);
  riseButton.addEventListener('pointercancel', releaseRise);
  riseButton.addEventListener('lostpointercapture', releaseRise);

  descendButton.addEventListener('pointerdown', (e) => {
    if (!w.on || !w.fly || e.button !== 0) return;
    descendButton.setPointerCapture(e.pointerId);
    descendPointers.set(e.pointerId, e.timeStamp);
  });
  descendButton.addEventListener('pointerup', (e) => {
    const start = descendPointers.get(e.pointerId);
    if (!descendPointers.delete(e.pointerId) || start === undefined) return;
    if (e.timeStamp - start > 220) lastDescendTap = -Infinity;
    else if (e.timeStamp - lastDescendTap <= doubleTapMs) setFlight(false);
    else lastDescendTap = e.timeStamp;
  });
  const cancelDescend = (e: PointerEvent) => {
    if (descendPointers.delete(e.pointerId)) lastDescendTap = -Infinity;
  };
  descendButton.addEventListener('pointercancel', cancelDescend);
  descendButton.addEventListener('lostpointercapture', cancelDescend);
  descendButton.addEventListener('click', (e) => {
    if (w.on && w.fly && e.detail === 0) setFlight(false);
  });
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
  // Update first-person movement each frame.
  function update(dt: number) {
    const K = w.keys,
      shift = K.has('ShiftLeft') || K.has('ShiftRight');
    let f =
      (K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) -
      (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0) -
      w.joy.y;
    let r =
      (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) -
      (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0) +
      w.joy.x;
    // Opposite directions cancel. Diagonals and mixed inputs use the same speed limit.
    const m = Math.hypot(f, r);
    if (m > 1) {
      f /= m;
      r /= m;
    }
    movingFor = !w.fly && m > 0.05 ? Math.min(movingFor + dt, 2) : 0;
    const pace = lerp(3.6, 7.2, clamp((movingFor - 0.35) / 1.65, 0, 1));
    const speed = w.fly ? 14 : shift ? 10.8 : pace,
      sy = Math.sin(w.yaw),
      cy = Math.cos(w.yaw);
    const dx = (-sy * f + cy * r) * speed * dt,
      dz = (-cy * f - sy * r) * speed * dt;
    if (w.fly) {
      w.pos.x += dx;
      w.pos.z += dz;
      const rise = K.has('Space') || K.has('KeyE');
      const descend = shift || K.has('KeyQ') || K.has('KeyC');
      const rising = rise || risePointers.size > 0;
      const descending = descend || descendPointers.size > 0;
      const verticalSpeed = rise || descend ? speed : touchVerticalSpeed;
      w.pos.y += (Number(rising) - Number(descending)) * verticalSpeed * dt;
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
        w.pos.x += dx; // Slide along the wall.
      else if (!blockedMove(w.pos.x, w.pos.z, 0, dz, w.pos.y, objs))
        w.pos.z += dz;
      const fl = floorAt(w.pos.x, w.pos.z, w.pos.y, objs);
      if (fl >= w.pos.y - 0.05) {
        w.pos.y = lerp(w.pos.y, fl, 1 - Math.exp(-dt * 18));
        w.vy = 0;
      } // Ease upward when climbing steps.
      else {
        w.vy -= 9.8 * dt;
        w.pos.y = Math.max(fl, w.pos.y + w.vy * dt);
        if (w.pos.y === fl) w.vy = 0;
      }
    }
    w.pos.x = clamp(w.pos.x, minX, maxX);
    w.pos.z = clamp(w.pos.z, minZ, maxZ);
    cam.position.set(w.pos.x, w.pos.y + w.eye, w.pos.z);
    cam.rotation.set(w.pitch, w.yaw, 0, 'YXZ');
  }
  return w;
}
