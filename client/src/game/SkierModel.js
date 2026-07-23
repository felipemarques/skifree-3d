import * as THREE from 'three';

function shadeColor(color, amount) {
  const c = new THREE.Color(color);
  c.offsetHSL(0, 0, amount);
  return c;
}

function markShadows(group) {
  group.traverse(obj => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = false;
    }
  });
  return group;
}

function rememberRest(obj) {
  obj.userData.restPosition = obj.position.clone();
  obj.userData.restRotation = obj.rotation.clone();
  return obj;
}

function resetTransform(obj) {
  if (!obj?.userData?.restPosition || !obj?.userData?.restRotation) return;
  obj.position.copy(obj.userData.restPosition);
  obj.rotation.copy(obj.userData.restRotation);
}

function disposeLabel(label) {
  if (!label) return;
  label.material?.map?.dispose();
  label.material?.dispose();
}

export function setSkierNameLabel(mesh, name = '') {
  if (!mesh) return null;

  const text = String(name || '').trim().slice(0, 16);
  if (mesh.userData.nameLabel) {
    mesh.remove(mesh.userData.nameLabel);
    disposeLabel(mesh.userData.nameLabel);
    mesh.userData.nameLabel = null;
  }
  if (!text) return null;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const width = 256;
  const height = 72;
  canvas.width = width;
  canvas.height = height;

  ctx.clearRect(0, 0, width, height);
  ctx.font = '900 28px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const textWidth = Math.min(width - 28, ctx.measureText(text).width + 34);
  const x = (width - textWidth) * 0.5;
  const y = 10;
  const radius = 14;
  ctx.fillStyle = 'rgba(8, 18, 31, 0.72)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + textWidth - radius, y);
  ctx.quadraticCurveTo(x + textWidth, y, x + textWidth, y + radius);
  ctx.lineTo(x + textWidth, y + 42 - radius);
  ctx.quadraticCurveTo(x + textWidth, y + 42, x + textWidth - radius, y + 42);
  ctx.lineTo(x + radius, y + 42);
  ctx.quadraticCurveTo(x, y + 42, x, y + 42 - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillStyle = '#f7fbff';
  ctx.strokeText(text, width * 0.5, y + 22);
  ctx.fillText(text, width * 0.5, y + 22);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }));
  label.position.set(0, 1.55, 0);
  label.scale.set(1.55, 0.44, 1);
  label.renderOrder = 50;
  label.userData.isNameLabel = true;
  mesh.add(label);
  mesh.userData.nameLabel = label;
  return label;
}

export function buildSkierMesh(color = 0x2979ff, options = {}) {
  const group = new THREE.Group();
  const parts = {
    arms: [],
    hands: [],
    legs: [],
    skis: [],
    poles: [],
  };
  const jacketColor = options.jacketColor ?? color;
  const helmetColor = options.helmetColor ?? color;
  const scarfColor = options.scarfColor ?? 0xf9d342;
  const skinColor = options.skinColor ?? 0xffccaa;
  const scale = options.scale ?? 1;

  const jacketMat = new THREE.MeshStandardMaterial({
    color: shadeColor(jacketColor, 0.04),
    roughness: 0.68,
    metalness: 0.02,
  });
  const jacketSideMat = new THREE.MeshStandardMaterial({
    color: shadeColor(jacketColor, -0.08),
    roughness: 0.74,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1f2a, roughness: 0.82 });
  const skiMat = new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.34, metalness: 0.18 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8d96a3, roughness: 0.44, metalness: 0.35 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.78 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: helmetColor, roughness: 0.42, metalness: 0.08 });
  const goggleMat = new THREE.MeshStandardMaterial({ color: 0x101824, roughness: 0.18, metalness: 0.05 });
  const scarfMat = new THREE.MeshStandardMaterial({ color: scarfColor, roughness: 0.62 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.58, 6), jacketMat);
  body.position.y = 0.66;
  body.rotation.z = 0.04;
  group.add(body);
  parts.body = rememberRest(body);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.08), jacketSideMat);
  chest.position.set(0, 0.76, 0.2);
  group.add(chest);
  parts.chest = rememberRest(chest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), skinMat);
  head.position.y = 1.08;
  group.add(head);
  parts.head = rememberRest(head);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.205, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55),
    helmetMat,
  );
  helmet.position.y = 1.13;
  group.add(helmet);
  parts.helmet = rememberRest(helmet);

  const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.075, 0.035), goggleMat);
  goggles.position.set(0, 1.1, 0.16);
  group.add(goggles);
  parts.goggles = rememberRest(goggles);

  const scarf = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.09), scarfMat);
  scarf.position.set(0, 0.93, 0.12);
  group.add(scarf);
  parts.scarf = rememberRest(scarf);

  const scarfTail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.34), scarfMat);
  scarfTail.position.set(-0.18, 0.91, -0.05);
  scarfTail.rotation.y = -0.35;
  group.add(scarfTail);
  parts.scarfTail = rememberRest(scarfTail);

  for (let side = -1; side <= 1; side += 2) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.5, 5), jacketSideMat);
    arm.position.set(side * 0.28, 0.63, 0.04);
    arm.rotation.z = side * 0.62;
    arm.rotation.x = -0.18;
    group.add(arm);
    arm.userData.side = side;
    parts.arms.push(rememberRest(arm));

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 5, 4), skinMat);
    hand.position.set(side * 0.42, 0.43, 0.12);
    group.add(hand);
    hand.userData.side = side;
    parts.hands.push(rememberRest(hand));

    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.43, 5), darkMat);
    leg.position.set(side * 0.11, 0.3, 0);
    leg.rotation.x = side * 0.04;
    group.add(leg);
    leg.userData.side = side;
    parts.legs.push(rememberRest(leg));

    const ski = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 1.22), skiMat);
    ski.position.set(side * 0.14, 0.055, 0.12);
    ski.rotation.x = -0.04;
    group.add(ski);
    ski.userData.side = side;
    parts.skis.push(rememberRest(ski));

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.82, 4), poleMat);
    pole.position.set(side * 0.37, 0.46, 0.13);
    pole.rotation.z = side * 0.42;
    pole.rotation.x = 0.35;
    group.add(pole);
    pole.userData.side = side;
    parts.poles.push(rememberRest(pole));
  }

  group.scale.setScalar(scale);
  group.userData.skierParts = parts;
  group.userData.animTime = Math.random() * Math.PI * 2;
  if (options.name) setSkierNameLabel(group, options.name);
  return markShadows(group);
}

export function updateSkierAnimation(mesh, options = {}) {
  const parts = mesh?.userData?.skierParts;
  if (!parts) return;

  const dt = Math.max(0, options.dt ?? 0.016);
  const speed = Math.max(0, options.speed ?? 0);
  const steer = THREE.MathUtils.clamp(options.steer ?? 0, -1, 1);
  const airborne = !!options.airborne;
  const airTime = options.airTime ?? 0;
  const speed01 = THREE.MathUtils.clamp(speed / 28, 0, 1);
  const turn01 = Math.abs(steer);

  mesh.userData.animTime = (mesh.userData.animTime ?? 0) + dt * (3.2 + speed01 * 8.5);
  const t = mesh.userData.animTime;
  const stride = Math.sin(t);
  const counter = Math.cos(t);
  const bob = airborne ? Math.sin(airTime * 9) * 0.012 : Math.abs(stride) * speed01 * 0.025;
  const crouch = airborne ? -0.03 : speed01 * 0.035 + turn01 * 0.035;

  for (const obj of [
    parts.body,
    parts.chest,
    parts.head,
    parts.helmet,
    parts.goggles,
    parts.scarf,
    parts.scarfTail,
    ...parts.arms,
    ...parts.hands,
    ...parts.legs,
    ...parts.skis,
    ...parts.poles,
  ]) {
    resetTransform(obj);
  }

  if (parts.body) {
    parts.body.position.y -= crouch;
    parts.body.rotation.x += -0.08 * speed01 + (airborne ? 0.16 : 0);
    parts.body.rotation.z += -steer * 0.12;
  }

  if (parts.chest) {
    parts.chest.position.y -= crouch;
    parts.chest.position.z += speed01 * 0.025;
    parts.chest.rotation.x += -0.12 * speed01 + (airborne ? 0.18 : 0);
    parts.chest.rotation.z += -steer * 0.16;
  }

  for (const obj of [parts.head, parts.helmet, parts.goggles, parts.scarf]) {
    if (!obj) continue;
    obj.position.y += bob - crouch * 0.35;
    obj.rotation.z += -steer * 0.08;
  }

  if (parts.scarfTail) {
    parts.scarfTail.position.y += bob - crouch * 0.35;
    parts.scarfTail.rotation.y += Math.sin(t * 0.7) * 0.16 - speed01 * 0.18;
    parts.scarfTail.rotation.z += counter * 0.08;
  }

  for (const arm of parts.arms) {
    const side = arm.userData.side || 1;
    const pump = Math.sin(t + (side > 0 ? Math.PI : 0)) * 0.24 * speed01;
    arm.position.y -= crouch * 0.65;
    arm.rotation.x += -0.12 - pump + (airborne ? 0.34 : 0);
    arm.rotation.z += side * turn01 * 0.08 + steer * 0.1;
  }

  for (const hand of parts.hands) {
    const side = hand.userData.side || 1;
    const pump = Math.sin(t + (side > 0 ? Math.PI : 0)) * 0.11 * speed01;
    hand.position.y -= crouch * 0.75;
    hand.position.z += pump + (airborne ? 0.08 : 0);
    hand.position.x += steer * 0.03;
  }

  for (const leg of parts.legs) {
    const side = leg.userData.side || 1;
    const kick = Math.sin(t + (side > 0 ? 0 : Math.PI)) * 0.14 * speed01;
    leg.position.y -= crouch;
    leg.rotation.x += kick - (airborne ? 0.18 : 0);
    leg.rotation.z += -steer * 0.06;
  }

  for (const ski of parts.skis) {
    const side = ski.userData.side || 1;
    ski.position.y += airborne ? 0.075 : bob * 0.3;
    ski.rotation.x += airborne ? 0.18 : -speed01 * 0.035;
    ski.rotation.y += side * steer * 0.055;
    ski.rotation.z += -side * steer * 0.035;
  }

  for (const pole of parts.poles) {
    const side = pole.userData.side || 1;
    const plant = Math.sin(t + (side > 0 ? Math.PI : 0)) * 0.18 * speed01;
    pole.position.y -= crouch * 0.5;
    pole.rotation.x += plant + (airborne ? 0.22 : 0);
    pole.rotation.z += side * turn01 * 0.08;
  }
}
