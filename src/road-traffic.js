import {
  BoxGeometry,
  CircleGeometry,
  CurvePath,
  CylinderGeometry,
  EllipseCurve,
  Group,
  IcosahedronGeometry,
  LineCurve,
  Mesh,
  MeshStandardMaterial,
  QuadraticBezierCurve,
  Vector2,
} from 'three';

export function carParts(length) {
  return {
    body: [
      [0, 0.65, 0, 1.78, 0.72, length],
      [0, 1.35, -0.22, 1.38, 0.12, 1.6],
    ],
    window: [0, 1.13, -0.22, 1.5, 0.43, 1.9],
    wheels: [-1, 1].flatMap((side) =>
      [-1, 1].map((axle) => [
        side * 0.83,
        0.32,
        axle * length * 0.32,
        0.2,
        0.32,
        0.32,
      ]),
    ),
  };
}

// Offset both lanes from the same centerline and round the corners and turnarounds.
function driveLoop(points, offset) {
  const directions = points
    .slice(1)
    .map((p, i) => p.clone().sub(points[i]).normalize());
  const first = points[0];
  const last = points.at(-1);
  first.addScaledVector(
    directions[0],
    Math.min(offset + 2.4, first.distanceTo(points[1]) * 0.4),
  );
  last.addScaledVector(
    directions.at(-1),
    -Math.min(offset + 2.4, last.distanceTo(points.at(-2)) * 0.4),
  );

  const lane = (side) =>
    points.map((p, i) => {
      const before = directions[Math.max(0, i - 1)];
      const after = directions[Math.min(i, directions.length - 1)];
      const tangent = before.clone().add(after).normalize();
      const shift = (side * offset) / Math.max(0.75, tangent.dot(after));
      return new Vector2(p.x + tangent.y * shift, p.y - tangent.x * shift);
    });
  const loop = new CurvePath();
  const addLane = (knots) => {
    let previous = knots[0];
    for (let i = 1; i < knots.length - 1; i++) {
      const turn = knots[i];
      const before = knots[i - 1];
      const after = knots[i + 1];
      const margin = Math.min(
        2.2,
        turn.distanceTo(before) / 3,
        turn.distanceTo(after) / 3,
      );
      const a = turn.clone().lerp(before, margin / turn.distanceTo(before));
      const b = turn.clone().lerp(after, margin / turn.distanceTo(after));
      loop.add(new LineCurve(previous, a));
      loop.add(new QuadraticBezierCurve(a, turn, b));
      previous = b;
    }
    loop.add(new LineCurve(previous, knots.at(-1)));
  };
  const turnAround = (center, direction) => {
    const angle = Math.atan2(-direction.x, direction.y);
    loop.add(
      new EllipseCurve(
        center.x,
        center.y,
        offset,
        offset,
        angle,
        angle + Math.PI,
      ),
    );
  };

  addLane(lane(1));
  turnAround(last, directions.at(-1));
  addLane(lane(-1).reverse());
  turnAround(first, directions[0].clone().negate());
  return loop;
}

function createVehicles() {
  const box = new BoxGeometry(1, 1, 1);
  const tire = new CylinderGeometry(1, 1, 1, 12).rotateZ(Math.PI / 2);
  const helmet = new IcosahedronGeometry(1, 1);
  const material = (color, roughness = 0.8) =>
    new MeshStandardMaterial({ color, roughness });
  const rubber = material(0x292828);
  const hub = material(0xb5b9ba);
  const glass = material(0x495761, 0.29);
  const skin = material(0x93654b);
  const shirt = material(0xc3b094);
  const lamp = new MeshStandardMaterial({
    color: 0xffe0a0,
    emissive: 0x8d6b33,
    emissiveIntensity: 0.45,
  });
  const tail = new MeshStandardMaterial({
    color: 0xc7251b,
    emissive: 0x85100b,
    emissiveIntensity: 0.3,
  });
  const palette = [0xe4dfd3, 0xaaaeb0, 0x52636b, 0x8b3f39, 0x41444a].map(
    (color) => material(color, 0.48),
  );
  const green = material(0x347040, 0.52);
  const yellow = material(0xe2ac23, 0.56);
  const bikePaint = material(0xaa3331, 0.48);
  const add = (rig, mat, [x, y, z, w, h, d], geo = box) => {
    const part = new Mesh(geo, mat);
    part.position.set(x, y, z);
    part.scale.set(w, h, d);
    part.receiveShadow = true;
    rig.add(part);
    return part;
  };
  const wheels = (rig, positions) => {
    for (const [x, y, z, w, r] of positions) {
      add(rig, rubber, [x, y, z, w, r, r], tire);
      add(rig, hub, [x, y, z, w + 0.012, r * 0.55, r * 0.55], tire);
    }
  };
  return {
    Car(rig, index) {
      const length = 4.05;
      const parts = carParts(length);
      for (const part of parts.body)
        add(rig, palette[index % palette.length], part);
      add(rig, glass, parts.window);
      wheels(rig, parts.wheels);
      for (const side of [-1, 1]) {
        add(rig, lamp, [0.63 * side, 0.77, length / 2, 0.34, 0.17, 0.035]);
        add(rig, tail, [0.7 * side, 0.77, -length / 2, 0.24, 0.16, 0.035]);
      }
      return [1.17, 2.25];
    },
    Motorcycle(rig) {
      wheels(rig, [
        [0, 0.27, -0.66, 0.15, 0.27],
        [0, 0.27, 0.66, 0.15, 0.27],
      ]);
      add(rig, bikePaint, [0, 0.63, 0.23, 0.4, 0.32, 0.64]);
      add(rig, rubber, [0, 0.66, -0.37, 0.34, 0.15, 0.6]);
      add(rig, hub, [0, 0.62, 0.55, 0.13, 0.8, 0.14]).rotation.x = -0.23;
      add(rig, rubber, [0, 0.99, 0.5, 0.7, 0.06, 0.09]);
      add(rig, lamp, [0, 0.84, 0.62, 0.24, 0.2, 0.13]);
      add(rig, tail, [0, 0.66, -0.76, 0.2, 0.1, 0.05]);
      add(rig, shirt, [0, 1.1, -0.12, 0.39, 0.54, 0.25]).rotation.x = 0.22;
      add(rig, rubber, [0, 1.52, -0.04, 0.145, 0.16, 0.15], helmet);
      for (const side of [-1, 1]) {
        add(rig, rubber, [
          side * 0.17,
          0.63,
          -0.15,
          0.13,
          0.42,
          0.18,
        ]).rotation.x = 0.65;
        add(rig, shirt, [
          side * 0.235,
          1.1,
          0.16,
          0.12,
          0.13,
          0.57,
        ]).rotation.x = 0.34;
      }
      return [0.54, 1.05];
    },
    'Auto-rickshaw'(rig) {
      wheels(rig, [
        [-0.53, 0.25, -0.71, 0.16, 0.25],
        [0.53, 0.25, -0.71, 0.16, 0.25],
        [0, 0.25, 0.96, 0.16, 0.25],
      ]);
      add(rig, green, [0, 0.51, -0.25, 1.28, 0.43, 1.82]);
      add(rig, yellow, [0, 0.69, 0.71, 0.86, 0.48, 0.58]);
      add(rig, glass, [0, 1.15, 0.58, 0.92, 0.51, 0.11]).rotation.x = -0.24;
      add(rig, rubber, [0, 1.63, -0.2, 1.3, 0.15, 1.82]);
      add(rig, rubber, [0, 1.12, -1.02, 1.29, 0.88, 0.15]);
      add(rig, yellow, [0, 0.77, -1.11, 1.19, 0.13, 0.04]);
      for (const side of [-1, 1]) {
        add(rig, yellow, [
          side * 0.46,
          1.26,
          0.55,
          0.07,
          0.65,
          0.1,
        ]).rotation.x = -0.24;
        add(rig, tail, [side * 0.48, 0.56, -1.17, 0.14, 0.13, 0.04]);
      }
      add(rig, shirt, [0, 0.99, 0.21, 0.35, 0.43, 0.23]);
      add(rig, skin, [0, 1.29, 0.26, 0.11, 0.14, 0.11], helmet);
      add(rig, lamp, [0, 0.76, 1.02, 0.26, 0.17, 0.07]);
      return [0.84, 1.32];
    },
  };
}

export function createRoadTraffic(
  roads,
  { geo, terrainSurface, camera, shadow },
) {
  const group = new Group();
  group.name = 'Road traffic';
  group.userData.npc = true;
  const models = createVehicles();
  const shadowGeometry = new CircleGeometry(1, 14)
    .rotateX(-Math.PI / 2)
    .translate(0, 0.012, 0);
  const routes = roads
    .filter((road) => road.surface && road.traffic)
    .map((road) => {
      const loop = driveLoop(
        road.pts.map(([e, n]) => {
          const [x, , z] = geo(e, n);
          return new Vector2(x, z);
        }),
        road.w * 0.24,
      );
      const speed = road.surface === 'asphalt' && road.w >= 7 ? 8 : 4.2;
      // Time the turnarounds at walking speed, keeping the straight sections faster.
      let duration = 0;
      const sections = loop.curves.map((curve) => {
        const start = duration;
        duration +=
          curve.getLength() / (curve instanceof EllipseCurve ? 1.6 : speed);
        return { curve, start, end: duration };
      });
      const pointAt = (t) => {
        const seconds = ((t % duration) + duration) % duration;
        const section = sections.find(({ end }) => seconds < end);
        return section.curve.getPointAt(
          (seconds - section.start) / (section.end - section.start),
        );
      };
      const kinds =
        road.w >= 7
          ? ['Car', 'Motorcycle', 'Auto-rickshaw']
          : road.w >= 5
            ? ['Motorcycle', 'Auto-rickshaw']
            : ['Motorcycle'];
      const rigs = Array.from({ length: road.traffic }, (_, i) => {
        const rig = new Group();
        const kind = kinds[i % kinds.length];
        rig.name = kind;
        const [width, depth] = models[kind](rig, i);
        const contact = new Mesh(shadowGeometry, shadow);
        contact.scale.set(width, 1, depth);
        rig.add(contact);
        group.add(rig);
        return rig;
      });
      const elevation = road.followTerrain
        ? (p) => terrainSurface(p.x, p.y) + 0.15
        : () => 0.15;
      return { pointAt, duration, rigs, elevation, progress: 0 };
    });
  group.userData.update = (dt) => {
    for (const route of routes) {
      const { pointAt, duration, rigs, elevation } = route;
      route.progress = (route.progress + dt) % duration;
      rigs.forEach((rig, i) => {
        const t = route.progress + (duration * (i + 0.4)) / rigs.length;
        const point = pointAt(t);
        rig.visible =
          Math.hypot(point.x - camera.position.x, point.y - camera.position.z) <
          720;
        if (!rig.visible) return;
        const before = pointAt(t - 0.15);
        const after = pointAt(t + 0.15);
        rig.position.set(point.x, elevation(point), point.y);
        const dx = after.x - before.x;
        const dz = after.y - before.y;
        const pitch = -Math.atan2(
          elevation(after) - elevation(before),
          Math.hypot(dx, dz),
        );
        rig.rotation.set(pitch, Math.atan2(dx, dz), 0, 'YXZ');
      });
    }
  };
  group.userData.update(0);
  return group;
}
