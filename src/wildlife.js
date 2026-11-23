import {
  BufferAttribute,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp } from './math';

const TAU = Math.PI * 2;
const fur = new MeshLambertMaterial({ vertexColors: true });
const shadowMaterial = new MeshBasicMaterial({
  color: 0x201914,
  opacity: 0.19,
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
});
const shadowGeometry = new CircleGeometry(1, 12).rotateX(-Math.PI / 2);

// Merge the parts of each articulated segment into one colored mesh.
function coloredMesh(parts) {
  const geometries = parts.map(([geometry, hex]) => {
    if (geometry.hasAttribute('color')) return geometry;
    const color = new Color(hex);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    return geometry;
  });
  const mesh = new Mesh(mergeGeometries(geometries), fur);
  mesh.receiveShadow = true;
  return mesh;
}

function oval(color, x, y, z, width, height, length, tilt = 0) {
  return [
    new SphereGeometry(1, 10, 7)
      .scale(width, height, length)
      .rotateX(tilt)
      .translate(x, y, z),
    color,
  ];
}

function stripedOval(base, stripe, angles, [x, y, z], [sx, sy, sz]) {
  const geometry = new SphereGeometry(1, 48, 10).rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const coat = new Color(base);
  const mark = new Color(stripe);
  const color = new Color();
  for (let i = 0; i < positions.count; i++) {
    const angle = Math.atan2(positions.getX(i), positions.getY(i));
    const nearest = Math.min(
      ...angles.map((stripe) => Math.abs(stripe - angle)),
    );
    const length = Math.abs(positions.getZ(i));
    const strength =
      clamp((0.14 - nearest) / 0.07, 0, 1) *
      clamp((0.94 - length) / 0.17, 0, 1);
    color
      .copy(coat)
      .lerp(mark, strength)
      .toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return [geometry.scale(sx, sy, sz).translate(x, y, z)];
}

function taper(color, start, end, base, tip) {
  const from = new Vector3(...start);
  const to = new Vector3(...end);
  const direction = to.clone().sub(from);
  const geometry = new CylinderGeometry(tip, base, direction.length(), 6);
  geometry.applyQuaternion(
    new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      direction.normalize(),
    ),
  );
  const midpoint = from.lerp(to, 0.5);
  return [geometry.translate(midpoint.x, midpoint.y, midpoint.z), color];
}

function curved(color, points, radius, tip = radius) {
  const path = new CatmullRomCurve3(
    points.map((point) => new Vector3(...point)),
  );
  const segments = tip === radius ? 8 : 12;
  const sides = tip === radius ? 5 : 7;
  const geometry = new TubeGeometry(path, segments, radius, sides, false);
  if (tip !== radius) {
    const position = geometry.attributes.position;
    const center = new Vector3();
    const vertex = new Vector3();
    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const scale = lerp(1, tip / radius, u);
      path.getPointAt(u, center);
      for (let j = 0; j <= sides; j++) {
        const index = i * (sides + 1) + j;
        vertex
          .fromBufferAttribute(position, index)
          .sub(center)
          .multiplyScalar(scale)
          .add(center);
        position.setXYZ(index, vertex.x, vertex.y, vertex.z);
      }
    }
    geometry.computeVertexNormals();
  }
  return [geometry, color];
}

function joint(parent, x, y, z, parts) {
  const part = coloredMesh(parts);
  part.position.set(x, y, z);
  parent.add(part);
  return part;
}

function groundedRig(name, width, length) {
  const root = new Group();
  root.name = name;
  const shadow = new Mesh(shadowGeometry, shadowMaterial);
  shadow.scale.set(width, 1, length);
  shadow.position.y = 0.018;
  const body = new Group();
  root.add(body, shadow);
  return { root, body };
}

function rigFactory(model, joints, animate) {
  const nodes = [];
  model.traverse((node) => nodes.push(node));
  const indices = joints.map((joint) => nodes.indexOf(joint));
  return () => {
    const root = model.clone();
    const copy = [];
    root.traverse((node) => copy.push(node));
    const bones = indices.map((index) => copy[index]);
    return { root, pose: (...args) => animate(bones, ...args) };
  };
}

function peacock() {
  const { root, body } = groundedRig('Peacock', 0.27, 0.72);
  const blue = 0x164995,
    teal = 0x13767a,
    bronze = 0x828144,
    leg = 0x77716a;
  joint(body, 0, 0, 0, [
    oval(teal, 0, 0.46, -0.04, 0.16, 0.17, 0.32),
    ...[-1, 1].map((side) =>
      stripedOval(
        0x514535,
        0xb29c79,
        [0.92, 1.34, 1.76, 2.18].map((angle) => angle * side),
        [side * 0.11, 0.469, -0.137],
        [0.063, 0.103, 0.224],
      ),
    ),
  ]);
  const neck = joint(body, 0, 0.48, 0.19, [
    oval(blue, 0, 0.15, 0.032, 0.067, 0.22, 0.07, 0.18),
    oval(blue, 0, 0.355, 0.082, 0.059, 0.061, 0.078),
    taper(0xaaa496, [0, 0.34, 0.14], [0, 0.335, 0.22], 0.026, 0.004),
    ...[-1, 1].flatMap((side) => [
      oval(0xd9d4bf, side * 0.046, 0.362, 0.104, 0.012, 0.017, 0.037),
      oval(0x16181b, side * 0.057, 0.376, 0.118, 0.008, 0.01, 0.012),
    ]),
    ...[-2, -1, 0, 1, 2].flatMap((i) => [
      taper(0x4b514d, [0, 0.4, 0.07], [i * 0.022, 0.49, 0.048], 0.003, 0.002),
      oval(teal, i * 0.022, 0.493, 0.047, 0.012, 0.016, 0.007),
    ]),
  ]);
  const train = [];
  for (let i = -3; i <= 3; i++) {
    const x = i * 0.036;
    const z = -0.75 + Math.abs(i) * 0.08;
    const y = -0.19 - Math.abs(i) * 0.009;
    train.push(
      oval(
        i % 2 ? 0x35633b : 0x496b39,
        x * 0.57,
        y + 0.064,
        z / 2,
        0.044,
        0.025,
        Math.abs(z) * 0.63,
        -0.19,
      ),
      oval(bronze, x, y, z, 0.029, 0.015, 0.063, -0.19),
      oval(teal, x, y + 0.01, z, 0.022, 0.009, 0.044),
      oval(blue, x, y + 0.017, z + 0.009, 0.013, 0.006, 0.023),
    );
  }
  const tail = joint(body, 0, 0.46, -0.25, train);
  const legs = [-1, 1].map((side) =>
    joint(root, side * 0.078, 0.42, 0.026, [
      taper(leg, [0, 0, 0], [0, -0.18, -0.033], 0.024, 0.016),
      taper(leg, [0, -0.18, -0.033], [0, -0.393, 0.016], 0.015, 0.012),
      ...[-1, 0, 1].map((toe) =>
        taper(
          leg,
          [0, -0.402, 0.015],
          [toe * 0.028, -0.412, 0.093],
          0.009,
          0.004,
        ),
      ),
    ]),
  );
  return rigFactory(
    root,
    [...legs, body, neck, tail],
    ([left, right, body, neck, tail], stride, idle, time) => {
      const step = Math.sin(stride) * (1 - idle);
      left.rotation.x = step * 0.54;
      right.rotation.x = -step * 0.54;
      body.position.y = Math.abs(step) * 0.025;
      neck.position.y = 0.48 - idle * 0.065;
      neck.rotation.x = step * 0.16 + idle * (1.94 + 0.2 * Math.sin(time * 9));
      tail.rotation.y = step * 0.06;
      tail.rotation.x = idle * 0.15;
    },
  );
}

function boar() {
  const { root, body } = groundedRig('Wild boar', 0.59, 1.12);
  const hide = 0x53473e,
    rump = 0x5e5045,
    bristles = 0x342c28,
    hoof = 0x2c2624;
  const mane = [];
  for (let i = 0; i < 22; i++) {
    const z = -0.56 + i * 0.051;
    const y = 0.94 + Math.sin((i / 24) * Math.PI) * 0.27 + i * 0.004;
    const x = Math.sin(i * 2.4) * 0.033;
    mane.push(
      taper(
        bristles,
        [x, y, z],
        [x * 1.5, y + 0.09 + 0.04 * Math.sin(i * 3), z - 0.083],
        0.039,
        0.002,
      ),
    );
  }
  joint(body, 0, 0, 0, [
    oval(rump, 0, 0.77, -0.49, 0.32, 0.36, 0.52),
    oval(hide, 0, 0.83, 0.06, 0.38, 0.43, 0.69, -0.14),
    oval(hide, 0, 0.88, 0.4, 0.33, 0.43, 0.38, 0.2),
    curved(
      bristles,
      [
        [0, 0.94, -0.91],
        [0, 0.88, -1.08],
        [0.07, 0.72, -1.14],
        [0.13, 0.71, -1.2],
      ],
      0.022,
    ),
    ...mane,
  ]);
  const head = joint(body, 0, 0.82, 0.52, [
    oval(hide, 0, -0.045, 0.16, 0.246, 0.278, 0.35, 0.34),
    oval(rump, 0, -0.23, 0.4, 0.153, 0.145, 0.31, 0.32),
    oval(0x6e5952, 0, -0.303, 0.615, 0.124, 0.087, 0.059),
    ...[-1, 1].flatMap((side) => [
      oval(hoof, side * 0.052, -0.292, 0.663, 0.022, 0.017, 0.011),
      oval(0x1e1918, side * 0.218, -0.01, 0.304, 0.024, 0.021, 0.023),
      oval(0x816b53, side * 0.233, -0.004, 0.314, 0.009, 0.009, 0.01),
      oval(bristles, side * 0.18, 0.236, 0.15, 0.079, 0.135, 0.045, -0.27),
      oval(0x725c50, side * 0.18, 0.244, 0.186, 0.051, 0.092, 0.018, -0.27),
      taper(
        0xe0cc9e,
        [side * 0.112, -0.299, 0.465],
        [side * 0.176, -0.254, 0.507],
        0.03,
        0.025,
      ),
      taper(
        0xe0cc9e,
        [side * 0.176, -0.254, 0.507],
        [side * 0.184, -0.141, 0.515],
        0.026,
        0.003,
      ),
    ]),
  ]);
  const legs = [];
  for (const z of [0.4, -0.59]) {
    for (const side of [-1, 1]) {
      legs.push(
        joint(root, side * 0.222, 0.6, z, [
          oval(hide, 0, -0.075, 0, 0.12, 0.204, 0.137),
          taper(bristles, [0, -0.155, 0], [0, -0.55, -0.028], 0.083, 0.041),
          oval(hoof, 0, -0.552, 0, 0.062, 0.049, 0.079),
        ]),
      );
    }
  }
  return rigFactory(
    root,
    [body, head, ...legs],
    ([body, head, ...legs], stride, time) => {
      const step = Math.sin(stride);
      for (const [i, leg] of legs.entries()) {
        leg.rotation.x = (i === 0 || i === 3 ? step : -step) * 0.37;
      }
      body.position.y = Math.abs(step) * 0.03;
      head.rotation.x = step * 0.06 + 0.065 * Math.sin(time * 2);
    },
  );
}

function elephant() {
  const { root, body } = groundedRig('Elephant', 1.18, 2.35);
  const gray = 0x736f69;
  const face = 0x827d76;
  const folds = 0x66615c;
  joint(body, 0, 0, 0, [
    oval(gray, 0, 1.84, -0.34, 0.86, 0.88, 1.56),
    oval(gray, 0, 1.95, 0.57, 0.76, 0.93, 0.88, -0.15),
    oval(gray, 0, 1.75, -1.18, 0.75, 0.82, 0.69),
  ]);
  const head = new Group();
  head.position.set(0, 2.16, 1.15);
  body.add(head);
  joint(head, 0, 0, 0, [
    oval(gray, 0, -0.04, 0.31, 0.55, 0.63, 0.61, -0.15),
    oval(face, 0, -0.42, 0.48, 0.36, 0.3, 0.42),
    ...[-1, 1].flatMap((side) => [
      oval(gray, side * 0.21, 0.33, 0.44, 0.31, 0.32, 0.4),
      oval(folds, side * 0.448, 0.021, 0.58, 0.084, 0.082, 0.11),
      oval(0x242323, side * 0.493, 0.025, 0.632, 0.028, 0.038, 0.042),
    ]),
  ]);
  const ears = [-1, 1].map((side) =>
    joint(head, side * 0.44, 0.09, 0.29, [
      oval(gray, side * 0.19, -0.12, 0, 0.35, 0.54, 0.105),
      oval(0x938079, side * 0.23, -0.09, 0.068, 0.25, 0.42, 0.063),
      oval(gray, side * 0.13, -0.38, -0.01, 0.23, 0.29, 0.086),
    ]),
  );
  const tusks = joint(
    head,
    0,
    -0.35,
    0.65,
    [-1, 1].map((side) =>
      curved(
        0xdad0b0,
        [
          [side * 0.28, 0, 0],
          [side * 0.31, -0.17, 0.29],
          [side * 0.37, -0.15, 0.58],
          [side * 0.39, -0.045, 0.78],
        ],
        0.087,
        0.006,
      ),
    ),
  );
  tusks.name = 'Tusks';
  const trunk = joint(head, 0, -0.26, 0.72, [
    curved(
      face,
      [
        [0, 0.1, -0.07],
        [0, -0.22, 0.17],
        [0, -0.68, 0.14],
        [0, -1.14, 0.19],
        [0, -1.55, 0.41],
        [0.015, -1.49, 0.62],
      ],
      0.26,
      0.085,
    ),
    oval(face, 0.015, -1.49, 0.615, 0.091, 0.09, 0.11),
    ...[-1, 1].map((side) =>
      oval(folds, side * 0.037 + 0.015, -1.463, 0.707, 0.026, 0.023, 0.016),
    ),
  ]);
  const tail = joint(body, 0, 1.83, -1.72, [
    curved(
      gray,
      [
        [0, 0.03, 0.04],
        [0, -0.19, -0.28],
        [0.022, -0.57, -0.37],
        [0.08, -0.94, -0.23],
      ],
      0.066,
      0.03,
    ),
    oval(folds, 0.08, -0.95, -0.22, 0.066, 0.16, 0.068),
  ]);
  const legs = [];
  for (const z of [0.84, -1.1]) {
    for (const side of [-1, 1]) {
      legs.push(
        joint(root, side * 0.46, 1.57, z, [
          oval(gray, 0, -0.25, 0, 0.32, 0.62, 0.38),
          taper(gray, [0, -0.48, 0.035], [0, -1.37, -0.05], 0.27, 0.22),
          oval(gray, 0, -1.39, 0, 0.258, 0.18, 0.315),
          ...[-1, 0, 1].map((toe) =>
            oval(
              0x9b9389,
              toe * 0.106,
              -1.464,
              0.259 - Math.abs(toe) * 0.027,
              0.06,
              0.063,
              0.04,
            ),
          ),
        ]),
      );
    }
  }
  return rigFactory(
    root,
    [body, head, trunk, tail, ...ears, ...legs],
    ([body, head, trunk, tail, left, right, ...legs], stride, time) => {
      for (const [i, leg] of legs.entries()) {
        const step = stride + (i * Math.PI) / 2;
        leg.rotation.x = Math.sin(step) * 0.2;
        leg.position.y = 1.57 + Math.max(0, Math.cos(step)) * 0.105;
      }
      body.position.y = Math.sin(stride * 2) * 0.035;
      head.rotation.x = Math.sin(stride) * 0.034;
      trunk.rotation.z = Math.sin(stride * 0.55) * 0.19;
      trunk.rotation.x = Math.sin(stride + 0.45) * 0.12;
      tail.rotation.z = Math.sin(stride * 0.67 + 1.4) * 0.22;
      const flap = 0.37 + Math.sin(time * 1.65) * 0.18;
      left.rotation.y = -flap;
      right.rotation.y = flap;
    },
  );
}

function squirrel() {
  const root = new Group();
  root.name = 'Palm squirrel';
  root.rotation.order = 'YXZ';
  const gray = 0x8d7761,
    dark = 0x594636,
    cream = 0xc9b590;
  joint(root, 0, 0, 0, [
    stripedOval(
      gray,
      cream,
      [-0.57, 0, 0.57],
      [0, 0.08, -0.033],
      [0.052, 0.052, 0.112],
    ),
    oval(cream, 0, 0.054, 0.013, 0.037, 0.032, 0.073),
    oval(gray, 0, 0.101, 0.096, 0.039, 0.041, 0.055),
    oval(dark, 0, 0.093, 0.146, 0.014, 0.011, 0.011),
    ...[-1, 1].flatMap((side) => [
      oval(dark, side * 0.037, 0.111, 0.112, 0.006, 0.011, 0.011),
      oval(gray, side * 0.025, 0.145, 0.079, 0.013, 0.025, 0.013),
    ]),
  ]);
  const tail = joint(root, 0, 0.079, -0.12, [
    curved(
      dark,
      [
        [0, 0, 0],
        [0, 0.048, -0.073],
        [0, 0.128, -0.135],
        [0, 0.142, -0.252],
      ],
      0.023,
    ),
    oval(gray, 0, 0.117, -0.173, 0.033, 0.036, 0.105, 0.4),
  ]);
  const legs = [];
  for (const z of [0.059, -0.096]) {
    for (const side of [-1, 1]) {
      legs.push(
        joint(root, side * 0.039, 0.064, z, [
          oval(gray, 0, -0.02, 0, 0.019, 0.037, 0.025),
          oval(dark, 0, -0.059, 0.019, 0.014, 0.008, 0.027),
        ]),
      );
    }
  }
  return rigFactory(root, [tail, ...legs], ([tail, ...legs], time, jumping) => {
    const bound = Math.sin(time * 32);
    for (const [i, leg] of legs.entries()) {
      leg.rotation.x = (i < 2 ? -1 : 1) * (jumping ? 0.65 : bound * 0.75);
    }
    tail.rotation.x = jumping ? 0.35 : 0.12 * bound;
    tail.rotation.y = 0.16 * Math.sin(time * 14);
  });
}

function groundRoute(points, closed = false) {
  const route = new CatmullRomCurve3(points, closed);
  route.arcLengthDivisions = Math.max(200, points.length * 36);
  return route;
}

function findLoop(x, z, radius, clear, random) {
  const point = new Vector3();
  for (let attempt = 0; attempt < 60; attempt++) {
    const offsetX = attempt ? (random() - 0.5) * radius * 4 : 0;
    const offsetZ = attempt ? (random() - 0.5) * radius * 4 : 0;
    const rx = radius * lerp(0.55, 1.15, random());
    const rz = radius * lerp(0.55, 1.15, random());
    const route = groundRoute(
      Array.from({ length: 8 }, (_, i) => {
        const angle = (i / 8) * TAU;
        return new Vector3(
          x + offsetX + Math.cos(angle) * rx,
          0,
          z + offsetZ + Math.sin(angle) * rz,
        );
      }),
      true,
    );
    const samples = Math.ceil(route.getLength() / 0.45);
    let safe = true;
    for (let i = 0; i < samples; i++) {
      route.getPointAt(i / samples, point);
      if (!clear(point.x, point.z)) {
        safe = false;
        break;
      }
    }
    if (safe) return route;
  }
}

function treePair(trees, x, z, used, canCross, anchor) {
  let pair;
  let closest = 46;
  for (const a of anchor ? [anchor] : trees) {
    if (used.has(a)) continue;
    const distance = Math.hypot(a[0] - x, a[1] - z);
    if (distance >= closest) continue;
    for (const b of trees) {
      if (used.has(b)) continue;
      const gap = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const score = distance + (gap > 6.8 ? 8 : 0);
      if (gap >= 2.8 && gap <= 15 && score < closest && canCross(a, b, gap)) {
        closest = score;
        pair = [a, b];
      }
    }
  }
  if (pair) pair.forEach((tree) => used.add(tree));
  return pair;
}

function squirrelTrail([a, b]) {
  const heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const climb = 2.5;
  const gap = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const jump = gap / 6.5;
  const run = gap / 3.25;
  const trunk = ([x, z, scale], angle, u, out) => {
    const radius = lerp(0.42, 0.33, u) * scale + 0.045;
    return out.set(
      x + Math.cos(angle) * radius,
      lerp(0.06, 2.25 * scale, u),
      z + Math.sin(angle) * radius,
    );
  };
  const footA = trunk(a, heading, 0, new Vector3());
  const footB = trunk(b, heading + Math.PI, 0, new Vector3());
  if (gap > 6.8) {
    // When the next trunk is too far to jump, climb back down and dash across.
    const half = 2 * climb + run;
    return {
      period: 2 * half,
      jumping: () => false,
      sample(time, out) {
        const returning = time >= half;
        const elapsed = time % half;
        if (elapsed >= 2 * climb) {
          const u = (elapsed - 2 * climb) / run;
          return out.lerpVectors(footA, footB, returning ? 1 - u : u);
        }
        const height = 1 - Math.abs(elapsed / climb - 1);
        const angle = heading + (returning ? Math.PI : 0) + height * TAU;
        return trunk(returning ? b : a, angle, height, out);
      },
    };
  }
  const topA = trunk(a, heading, 1, new Vector3());
  const topB = trunk(b, heading + Math.PI, 1, new Vector3());
  return {
    period: 2 * climb + jump + run,
    jumping: (time) => time >= climb && time < climb + jump,
    sample(time, out) {
      if (time < climb) {
        const u = time / climb;
        return trunk(a, heading + u * TAU, u, out);
      }
      if (time < climb + jump) {
        const u = (time - climb) / jump;
        out.lerpVectors(topA, topB, u);
        out.y += 0.84 * 4 * u * (1 - u);
        return out;
      }
      if (time < 2 * climb + jump) {
        const u = (time - climb - jump) / climb;
        return trunk(b, heading + Math.PI - u * TAU, 1 - u, out);
      }
      const u = (time - 2 * climb - jump) / run;
      return out.lerpVectors(footB, footA, u);
    },
  };
}

export function createWildlife({
  camera,
  geo,
  groundHeight,
  trees,
  palms,
  clear,
  openGround,
  random,
  isNight,
}) {
  const group = new Group();
  group.name = 'Wildlife';
  group.userData.npc = true;
  const peacocks = [];
  const boars = [];
  const squirrels = [];
  const elephants = [];
  const used = new Set();
  const point = new Vector3();
  const ahead = new Vector3();
  const trunks = new Map();
  const trunkCellSize = 16;
  const addTrunk = (x, z, radius) => {
    const key =
      Math.floor(x / trunkCellSize) + ',' + Math.floor(z / trunkCellSize);
    if (!trunks.has(key)) trunks.set(key, []);
    trunks.get(key).push([x, z, radius]);
  };
  for (const [x, z, scale] of trees) addTrunk(x, z, scale * 0.42);
  for (const [x, z] of palms) addTrunk(x, z, 0.4);
  const clearOfTrunks = (x, z, pad) => {
    const col = Math.floor(x / trunkCellSize);
    const row = Math.floor(z / trunkCellSize);
    for (let i = col - 1; i <= col + 1; i++) {
      for (let j = row - 1; j <= row + 1; j++) {
        const cell = trunks.get(i + ',' + j);
        if (
          cell?.some(
            ([tx, tz, radius]) => Math.hypot(tx - x, tz - z) < radius + pad,
          )
        )
          return false;
      }
    }
    return true;
  };
  const available = (x, z, pad) => clear(x, z, pad) && clearOfTrunks(x, z, pad);
  const canCross = (a, b, gap) => {
    const start = (0.42 * a[2] + 0.16) / gap;
    const end = 1 - (0.42 * b[2] + 0.16) / gap;
    for (let u = start; u <= end; u += 0.5 / gap) {
      if (!available(lerp(a[0], b[0], u), lerp(a[1], b[1], u), 0.1))
        return false;
    }
    return true;
  };
  const makePeacock = peacock();
  const makeSquirrel = squirrel();
  const makeBoar = boar();
  const addFlock = (route, count, surface = groundHeight) => {
    const length = route.getLength();
    const start = random() * length;
    const speed = lerp(0.55, 0.83, random());
    for (let bird = 0; bird < count; bird++) {
      const rig = makePeacock();
      rig.root.scale.setScalar(lerp(0.9, 1.18, random()));
      group.add(rig.root);
      peacocks.push({
        ...rig,
        route,
        length,
        speed,
        surface,
        distance: (start + (bird / count) * length) % length,
        offset: random() * 16,
        stride: random() * TAU,
      });
    }
  };

  // Flocks gather by entrances, paths, and courtyards that visitors can walk to.
  const peacockAreas = [
    [475, -692],
    [473, -734],
    [504, -789],
    [628, -786],
    [659, -738],
    [657, -690],
    [630, -610],
    [488, -603],
    [480, -533],
    [540, -467],
    [202, -191],
    [206, -154],
    [170, -119],
    [127, -80],
    [91, -54],
    [32, -72],
    [29, -27],
    [-45, -62],
    [49, 7],
    [85, 31],
    [127, 27],
    [73, 58],
    [50, 80],
    [-8, 76],
    [-37, 80],
    [-74, 116],
    [22, 112],
    [73, 124],
    [80, 135],
    [60, 155],
    [120, 137],
    [121, 155],
    [136, 151],
    [140, 165],
    [102, 190],
    [144, 227],
    [76, 234],
    [130, 258],
    [197, 279],
    [251, 307],
    [272, 338],
    [297, 331],
    [350, 363],
    [402, 365],
    [-67, 197],
    [-76, 259],
    [-58, 304],
    [20, 290],
    [44, 309],
    [-53, 348],
    [40, 348],
    [89, 362],
  ];
  for (const [i, [e, n]] of peacockAreas.entries()) {
    const [x, , z] = geo(e, n);
    const route = findLoop(
      x,
      z,
      5.5,
      (px, pz) => available(px, pz, 0.65),
      random,
    );
    if (route) addFlock(route, i % 3 === 0 && route.getLength() > 22 ? 4 : 3);
  }
  // Keep the plaza flocks between the brick bands and clear of the shrine, columns, and steps.
  for (const [west, east, south, north] of [
    [505, 512, -739, -728],
    [515, 526, -711, -698],
    [523, 529, -735, -723],
    [536, 542, -704, -697],
    [540, 551, -686, -679],
    [543, 554, -739, -726],
    [566, 580, -742, -730],
    [571, 583, -688, -679],
    [608, 617, -713, -700],
  ]) {
    const points = [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
    ];
    addFlock(
      groundRoute(
        points.map(([e, n]) => new Vector3(...geo(e, n))),
        true,
      ),
      4,
      () => 0.16,
    );
  }

  // Look for neighboring broadleaf trunks from the edges of the busiest paths.
  const squirrelAreas = [
    [-124, -72],
    [-95, -29],
    [-61, 59],
    [-35, 91],
    [28, 81],
    [66, 105],
    [58, 149],
    [111, 157],
    [128, 207],
    [96, 218],
    [106, 266],
    [84, 304],
    [92, 355],
    [101, 401],
    [47, 435],
    [-63, 418],
    [-85, 363],
    [-88, 313],
    [-91, 266],
    [-123, 236],
    [-134, 175],
    [-84, 159],
    [-39, 158],
    [26, 176],
    [255, 319],
    [293, 327],
    [324, 368],
    [356, 332],
    [385, 383],
    [346, 20],
    [383, 43],
    [342, 78],
    [389, 104],
    [287, -24],
    [276, -64],
    [359, -50],
    [373, -90],
    [192, -137],
    [140, -102],
    [492, -623],
    [522, -768],
    [632, -718],
    [654, -636],
    [-128, 341],
    [-105, 439],
    [424, 351],
    [406, 163],
    [295, -113],
    [319, -146],
    [214, 390],
    [243, 405],
  ];
  const addSquirrel = (pair) => {
    const rig = makeSquirrel();
    group.add(rig.root);
    const trail = squirrelTrail(pair);
    squirrels.push({ ...rig, trail, offset: random() * trail.period });
  };
  for (const [e, n] of squirrelAreas) {
    const [x, , z] = geo(e, n);
    const pair = treePair(trees, x, z, used, canCross);
    if (pair) addSquirrel(pair);
  }

  // Add one pair per tile on each pass so nearby groves share the population.
  const squirrelTiles = new Map();
  for (const tree of trees) {
    const [x, z] = tree;
    const key = Math.floor(x / 64) + ',' + Math.floor(z / 64);
    if (!squirrelTiles.has(key)) squirrelTiles.set(key, []);
    squirrelTiles.get(key).push(tree);
  }
  const squirrelTarget = 200;
  while (squirrels.length < squirrelTarget && squirrelTiles.size) {
    for (const [key, candidates] of squirrelTiles) {
      let pair;
      while (!pair && candidates.length) {
        const tree = candidates.pop();
        pair = treePair(trees, tree[0], tree[1], used, canCross, tree);
      }
      if (!candidates.length) squirrelTiles.delete(key);
      if (pair) addSquirrel(pair);
      if (squirrels.length >= squirrelTarget) break;
    }
  }

  // The first bend remains in the woods west of Nalanda. At night the patrol
  // continues onto the path along the north edge of Nalanda Grounds.
  const approach = [
    [-128, 337],
    [-111, 344],
    [-101, 350],
    [-85, 350],
    [-45, 350.6],
    [-18, 351],
    [8, 351.4],
  ];
  const nightRoute = groundRoute(
    approach.map(([e, n]) => new Vector3(...geo(e, n))),
  );
  const nightLength = nightRoute.getLength();
  const forestEnd = 2; // Last waypoint before the trail leaves the woods.
  const forestLimit =
    nightRoute.getLengths()[
      (forestEnd * nightRoute.arcLengthDivisions) / (approach.length - 1)
    ];
  for (const [i, size] of [0.96, 1.12].entries()) {
    const rig = makeBoar();
    group.add(rig.root);
    rig.root.scale.setScalar(size);
    boars.push({
      ...rig,
      route: nightRoute,
      length: nightLength,
      dayLimit: forestLimit,
      speed: 1.52 - i * 0.11,
      distance: forestLimit - i * 7,
      lane: i === 0 ? 0.64 : -0.64,
      dir: 1,
      stride: i * Math.PI,
    });
  }
  // In daylight, patrol grass and woodland outside the main campus paths.
  for (const [e, n] of [
    [-176, 369],
    [-118, 403],
    [-148, 263],
    [-222, 320],
    [-185, 182],
    [-290, 472],
    [-396, 540],
    [-270, 661],
    [-136, 562],
    [7, 524],
    [119, 612],
    [248, 533],
    [356, 488],
    [479, 350],
    [510, 251],
    [531, 110],
    [502, -106],
    [392, -284],
    [325, -418],
    [276, -555],
    [284, -695],
    [661, -852],
    [438, -1016],
    [434, -1306],
  ]) {
    const [x, , z] = geo(e, n);
    const route = findLoop(
      x,
      z,
      12,
      (px, pz) => openGround(px, pz, 1) && clearOfTrunks(px, pz, 1),
      random,
    );
    if (!route) continue;
    const length = route.getLength();
    const start = random() * length;
    const speed = lerp(1.08, 1.42, random());
    for (const [i, size] of [1.08, 0.95].entries()) {
      const rig = makeBoar();
      group.add(rig.root);
      rig.root.scale.setScalar(size);
      boars.push({
        ...rig,
        route,
        length,
        dayLimit: length,
        speed,
        distance: (start + i * 4.5) % length,
        dir: 1,
        stride: i * Math.PI,
      });
    }
  }

  const makeElephant = elephant();
  const modelShoulderHeight = 2.88;
  // Herds roam separate clearings around the outskirts.
  const herds = [
    { center: [-314, 384], shoulderHeights: [3.4, 3] },
    { center: [664, -785], shoulderHeights: [3.5, 3.2, 1.9] },
    { center: [-124, 620], shoulderHeights: [3.3, 3, 2] },
    { center: [426, 550], shoulderHeights: [3.45, 3.1] },
    { center: [351, -1080], shoulderHeights: [3.4, 3.15] },
  ];
  for (const { center, shoulderHeights } of herds) {
    const [x, , z] = geo(...center);
    const route = findLoop(
      x,
      z,
      23,
      (px, pz) => openGround(px, pz, 3.4) && clearOfTrunks(px, pz, 3.4),
      random,
    );
    if (!route) continue;
    const length = route.getLength();
    const start = random() * length;
    const speed = lerp(1.03, 1.32, random());
    for (const [i, height] of shoulderHeights.entries()) {
      const rig = makeElephant();
      rig.root.scale.setScalar(height / modelShoulderHeight);
      rig.root.getObjectByName('Tusks').visible = i === 0;
      group.add(rig.root);
      elephants.push({
        ...rig,
        route,
        length,
        speed,
        drawDistance: 460,
        distance: (start + i * 6.8) % length,
        stride: i * 1.8,
      });
    }
  }

  const place = (animal, progress, dir, dt) => {
    animal.route.getPointAt(progress, point);
    const {
      root,
      lane = 0,
      surface = groundHeight,
      drawDistance = 265,
    } = animal;
    if (lane) animal.route.getTangentAt(progress, ahead);
    const x = lane ? point.x + ahead.z * lane : point.x;
    const z = lane ? point.z - ahead.x * lane : point.z;
    const wasVisible = root.visible;
    root.position.x = x;
    root.position.z = z;
    root.visible =
      root.position.distanceToSquared(camera.position) <= drawDistance ** 2;
    if (!root.visible) return;
    root.position.y = surface(x, z);
    if (!lane) animal.route.getTangentAt(progress, ahead);
    const heading = Math.atan2(ahead.x * dir, ahead.z * dir);
    const turn = heading - root.rotation.y;
    root.rotation.y +=
      Math.atan2(Math.sin(turn), Math.cos(turn)) *
      (dt && wasVisible ? Math.min(1, dt * 6) : 1);
  };
  group.userData.update = (time, dt) => {
    for (const bird of peacocks) {
      const phase = (time + bird.offset) % 10;
      const peck = clamp(Math.min(phase - 7.4, 9.5 - phase) * 4, 0, 1);
      const step = bird.speed * (1 - peck) * dt;
      bird.distance = (bird.distance + step) % bird.length;
      bird.stride += step * 15;
      place(bird, bird.distance / bird.length, 1, dt);
      if (bird.root.visible) bird.pose(bird.stride, peck, time + bird.offset);
    }
    const night = isNight();
    for (const animal of boars) {
      const limit = night ? animal.length : animal.dayLimit;
      if (animal.route.closed) {
        animal.distance = (animal.distance + animal.speed * dt) % animal.length;
      } else {
        if (animal.distance >= limit) animal.dir = -1;
        if (animal.distance <= 0) animal.dir = 1;
        animal.distance = clamp(
          animal.distance + animal.dir * animal.speed * dt,
          0,
          animal.length,
        );
      }
      animal.stride += dt * animal.speed * 7;
      place(animal, animal.distance / animal.length, animal.dir, dt);
      if (animal.root.visible) animal.pose(animal.stride, time);
    }
    for (const animal of elephants) {
      const step = animal.speed * dt;
      animal.distance = (animal.distance + step) % animal.length;
      animal.stride += step * 2.1;
      place(animal, animal.distance / animal.length, 1, dt);
      if (animal.root.visible) animal.pose(animal.stride, time);
    }
    for (const animal of squirrels) {
      const { root, trail, offset } = animal;
      const phase = (time + offset) % trail.period;
      trail.sample(phase, root.position);
      root.visible =
        root.position.distanceToSquared(camera.position) <= 68 ** 2;
      if (!root.visible) continue;
      trail.sample((phase + 0.018) % trail.period, ahead).sub(root.position);
      root.rotation.y = Math.atan2(ahead.x, ahead.z);
      root.rotation.x = -Math.atan2(ahead.y, Math.hypot(ahead.x, ahead.z));
      animal.pose(time + offset, trail.jumping(phase));
    }
  };
  group.userData.update(0, 0);
  return group;
}
