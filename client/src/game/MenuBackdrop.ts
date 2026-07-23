// @ts-nocheck
import * as THREE from 'three';
import { SkyBg } from './SkyBg';
import { HorizonMountains } from './HorizonMountains';
import { SnowParticles } from './Snow';

const TERRAIN_VERT = /* glsl */`
  uniform float uTime;
  varying vec3 vPos;
  varying float vHeight;

  void main() {
    vec3 pos = position;
    float ridge =
      sin(pos.x * 0.09 + pos.z * 0.07) * 0.52 +
      sin(pos.x * 0.22 - pos.z * 0.045) * 0.2;
    float slope = -pos.z * 0.022;
    pos.y += ridge + slope + sin(pos.x * 0.8 + pos.z * 0.3 + uTime * 0.18) * 0.025;
    vHeight = ridge;
    vPos = pos;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const TERRAIN_FRAG = /* glsl */`
  varying vec3 vPos;
  varying float vHeight;

  void main() {
    vec3 low = vec3(0.62, 0.74, 0.84);
    vec3 high = vec3(0.92, 0.97, 1.0);
    float h = smoothstep(-0.45, 0.55, vHeight);
    float stripe = sin(vPos.z * 0.18 + vPos.x * 0.035) * 0.5 + 0.5;
    vec3 col = mix(low, high, h);
    col = mix(col * 0.85, col, smoothstep(0.2, 0.8, stripe));
    gl_FragColor = vec4(col, 1.0);
  }
`;

function makeMenuTree(x, z, scale, hue) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.12, 0.7, 5),
    new THREE.MeshStandardMaterial({ color: 0x513315, roughness: 0.88 }),
  );
  trunk.position.y = 0.35;
  group.add(trunk);

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(hue, 0.52, 0.25),
    roughness: 0.84,
  });
  const snow = new THREE.MeshStandardMaterial({ color: 0xe9f5fb, roughness: 0.76 });
  for (let i = 0; i < 3; i++) {
    const r = scale * (0.52 - i * 0.11);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, r * 1.7, 6), mat);
    cone.position.y = 0.72 + i * 0.34;
    group.add(cone);

    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.58, r * 0.42, 6), snow);
    cap.position.y = cone.position.y + r * 0.45;
    group.add(cap);
  }

  group.position.set(x, 0, z);
  group.rotation.y = Math.random() * Math.PI * 2;
  group.traverse(obj => {
    if (obj.isMesh) obj.castShadow = true;
  });
  return group;
}

export class MenuBackdrop {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xaec7dc);
    this.scene.fog = new THREE.Fog(0xaec7dc, 58, 185);

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 260);
    this.camera.position.set(0, 9, 25);
    this.camera.lookAt(0, 2, 70);

    const hemi = new THREE.HemisphereLight(0xe2f3ff, 0x8ba2b6, 0.82);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff8e6, 1.1);
    sun.position.set(-28, 52, 18);
    sun.castShadow = false;
    this.scene.add(sun);

    this.sky = new SkyBg(this.scene);
    this.mountains = new HorizonMountains(this.scene, 0xaec7dc);
    this.snow = new SnowParticles(this.scene, { quality: 'low' });

    this._terrainTimeUniform = { value: 0 };
    this.terrainMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this._terrainTimeUniform,
      },
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
    });

    const terrainGeo = new THREE.PlaneGeometry(150, 150, 64, 64);
    terrainGeo.rotateX(-Math.PI / 2);
    this.terrain = new THREE.Mesh(terrainGeo, this.terrainMaterial);
    this.terrain.position.z = 55;
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);

    for (let i = 0; i < 34; i++) {
      const side = Math.random() > 0.5 ? -1 : 1;
      const x = side * (22 + Math.random() * 42);
      const z = -8 + Math.random() * 120;
      const scale = 0.75 + Math.random() * 0.78;
      this.scene.add(makeMenuTree(x, z, scale, 0.31 + Math.random() * 0.04));
    }

    this._running = false;
    this._frame = null;
    this._startTime = performance.now();
    this._lastTime = 0;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    this._loop(this._lastTime);
  }

  stop() {
    this._running = false;
    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = null;
  }

  resize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  _loop(now) {
    if (!this._running) return;

    const dt = Math.min((now - this._lastTime) / 1000, 0.05);
    this._lastTime = now;
    const elapsed = (now - this._startTime) / 1000;

    this.camera.position.x = Math.sin(elapsed * 0.18) * 2.4;
    this.camera.position.z = 25 + Math.sin(elapsed * 0.11) * 1.2;
    this.camera.lookAt(Math.sin(elapsed * 0.16) * 1.8, 2.2, 72);

    this._setTerrainTime(elapsed);
    this.sky?.update?.(this.camera.position);
    this.mountains?.update?.(this.camera.position);
    this.snow?.update?.(dt, this.camera.position, 10);

    this.renderer.render(this.scene, this.camera);
    this._frame = requestAnimationFrame(t => this._loop(t));
  }

  _setTerrainTime(elapsed) {
    if (!this._terrainTimeUniform) {
      const existingUniform = this.terrainMaterial?.uniforms?.uTime;
      this._terrainTimeUniform = existingUniform && typeof existingUniform === 'object'
        ? existingUniform
        : { value: 0 };
    }

    if (this.terrainMaterial) {
      if (!this.terrainMaterial.uniforms) this.terrainMaterial.uniforms = {};
      this.terrainMaterial.uniforms.uTime = this._terrainTimeUniform;
    }

    this._terrainTimeUniform.value = elapsed;
  }
}
