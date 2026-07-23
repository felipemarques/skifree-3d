import * as THREE from 'three';
import { buildSkierMesh, setSkierNameLabel, updateSkierAnimation } from './SkierModel.js';

const PLAYER_COLORS = [0xff6b35, 0x4caf50, 0xf9c74f, 0xa855f7, 0xef476f, 0x06d6a0, 0xff9f1c];
let colorIdx = 0;

export class RemotePlayer {
  constructor(scene, id, name) {
    this.id = id;
    this.name = name;
    this.color = PLAYER_COLORS[colorIdx % PLAYER_COLORS.length];
    colorIdx++;

    this.mesh = buildSkierMesh(this.color, {
      helmetColor: this.color,
      scarfColor: PLAYER_COLORS[colorIdx % PLAYER_COLORS.length],
      scale: 0.92,
      name: this.name,
    });
    scene.add(this.mesh);

    this._prevState = null;
    this._nextState = null;
    this._interpT = 0;
    this._interpDuration = 0.05;
    this.currentSpeed = 0;

    this.scene = scene;
  }

  receiveState(state) {
    this._prevState = this._nextState || state;
    this._nextState = state;
    this._interpT = 0;
  }

  setName(name) {
    const nextName = String(name || 'Player').slice(0, 16);
    if (nextName === this.name) return;
    this.name = nextName;
    setSkierNameLabel(this.mesh, this.name);
  }

  update(dt, groundYAt = null) {
    if (!this._nextState) return;

    this._interpT += dt;
    const t = Math.min(this._interpT / this._interpDuration, 1);

    const prev = this._prevState || this._nextState;
    const next = this._nextState;

    const x = THREE.MathUtils.lerp(prev.x, next.x, t);
    const z = THREE.MathUtils.lerp(prev.z, next.z, t);
    const airborneY = THREE.MathUtils.lerp(prev.y || 0, next.y || 0, t);
    const groundY = groundYAt ? groundYAt(x, z) : 0;

    this.mesh.position.set(x, groundY + airborneY, z);
    const angle = THREE.MathUtils.lerp(prev.angle || 0, next.angle || 0, t);
    const speed = THREE.MathUtils.lerp(prev.speed || 0, next.speed || 0, t);
    this.currentSpeed = speed;
    this.mesh.rotation.y = -angle;

    updateSkierAnimation(this.mesh, {
      dt,
      speed,
      steer: THREE.MathUtils.clamp(angle / (Math.PI * 0.42), -1, 1),
      airborne: airborneY > 0.05,
      airTime: airborneY > 0.05 ? this._interpT : 0,
    });
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material?.map) obj.material.map.dispose();
      if (obj.material) obj.material.dispose();
    });
  }
}
