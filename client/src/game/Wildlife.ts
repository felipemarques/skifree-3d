// @ts-nocheck
import * as THREE from 'three';

const POOL_SIZE = 6;
const FLAP_SPEED = 9;

function buildBird() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a, fog: true });

  const body = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 4), mat);
  body.rotation.x = Math.PI / 2;
  group.add(body);

  const wingGeo = new THREE.PlaneGeometry(0.3, 0.09);
  const wingL = new THREE.Mesh(wingGeo, mat);
  wingL.position.x = -0.03;
  group.add(wingL);
  const wingR = new THREE.Mesh(wingGeo, mat);
  wingR.position.x = 0.03;
  group.add(wingR);

  group.userData.mat = mat;
  group.userData.wingL = wingL;
  group.userData.wingR = wingR;
  group.visible = false;
  return group;
}

/** Purely decorative, camera-relative distant wildlife - never touches
 * collision/obstacle systems, same pattern as HorizonMountains. */
export class Wildlife {
  constructor(scene) {
    this.scene = scene;
    this._pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = buildBird();
      scene.add(mesh);
      this._pool.push({ mesh, life: 0, vx: 0, vy: 0, vz: 0, phase: Math.random() * 10 });
    }
    this._cursor = 0;
  }

  _spawn(cameraPos, { scale = 1, color = 0x2a2a2a, speed = 6, life = 5 } = {}) {
    const slot = this._pool[this._cursor];
    this._cursor = (this._cursor + 1) % this._pool.length;

    slot.mesh.scale.setScalar(scale);
    slot.mesh.userData.mat.color.set(color);
    const side = Math.random() < 0.5 ? -1 : 1;
    slot.mesh.position.set(
      cameraPos.x + side * 40,
      cameraPos.y + 14 + Math.random() * 8,
      cameraPos.z + 30 + Math.random() * 40,
    );
    slot.vx = -side * speed;
    slot.vy = 0;
    slot.vz = -speed * 0.15;
    slot.life = life;
    slot.mesh.visible = true;
  }

  spawnForestBird(cameraPos) {
    this._spawn(cameraPos, { scale: 0.8, color: 0x3a3226, speed: 7, life: 4 });
  }

  spawnEagle(cameraPos) {
    this._spawn(cameraPos, { scale: 2.2, color: 0x24211d, speed: 4, life: 7 });
  }

  update(dt, cameraPos) {
    for (const slot of this._pool) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      slot.phase += dt * FLAP_SPEED;
      const flap = Math.sin(slot.phase) * 0.5;
      slot.mesh.userData.wingL.rotation.z = flap;
      slot.mesh.userData.wingR.rotation.z = -flap;

      slot.mesh.position.x += slot.vx * dt;
      slot.mesh.position.y += Math.sin(slot.phase * 0.3) * 0.3 * dt;
      slot.mesh.position.z += slot.vz * dt;
      slot.mesh.rotation.y = Math.atan2(slot.vx, slot.vz);

      if (slot.life <= 0) slot.mesh.visible = false;
    }
  }

  dispose() {
    for (const slot of this._pool) {
      this.scene.remove(slot.mesh);
      slot.mesh.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }
    this._pool.length = 0;
  }
}
