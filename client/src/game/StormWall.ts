// @ts-nocheck
import * as THREE from 'three';

const WALL_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const WALL_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uPhase;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    // Soft radial falloff - no hard rectangular edge, so it reads as a
    // hazy mass looming ahead rather than a floating billboard.
    float edgeX = 1.0 - smoothstep(0.3, 0.5, abs(vUv.x - 0.5));
    float edgeY = 1.0 - smoothstep(0.26, 0.5, abs(vUv.y - 0.5));
    float envelope = edgeX * edgeY;

    // uPhase offsets this layer's turbulence independently of the other
    // stacked layers (see StormWall's LAYER_CONFIGS), so the stack doesn't
    // read as one repeated card - each slice roils differently.
    float n = noise(vUv * vec2(6.0, 3.0) + vec2(uTime * 0.05 + uPhase, uTime * 0.02 + uPhase * 0.4));
    n += noise(vUv * vec2(14.0, 7.0) - vec2(uTime * 0.08 - uPhase * 0.6, 0.01)) * 0.5;
    n = clamp(n / 1.5, 0.0, 1.0);

    float alpha = envelope * (0.45 + n * 0.55) * uOpacity;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

// A handful of planes staggered in Z (with independent turbulence phase and
// size/opacity falloff) rather than one flat card - depth testing is left
// on (unlike Sky/Aurora/Mountains) specifically so nearer terrain/trees
// correctly occlude parts of the stack as the player approaches, which is
// what actually reads as "a real 3D mass out there" instead of a flat
// overlay that just switches on.
const LAYER_CONFIGS = [
  { zOffset: -26, scale: 0.86, opacityMult: 0.5, phase: 0 },
  { zOffset: -8, scale: 0.95, opacityMult: 0.8, phase: 2.4 },
  { zOffset: 10, scale: 1.0, opacityMult: 1.0, phase: 5.1 },
  { zOffset: 30, scale: 0.9, opacityMult: 0.6, phase: 7.8 },
];

/**
 * A hazy, roiling wall of "storm" parked at the world-Z boundary of an
 * upcoming blizzard weather zone (see Game.ts's _updateStormWall, driven by
 * the shared, deterministic getWeatherAtZ/WEATHER_ZONE_LENGTH) so the
 * player can see the blizzard coming from a distance and brace for it,
 * instead of fog/snow only ever ramping in once already inside the zone.
 * Not camera-relative like Sky/Mountains/Aurora - it sits at a fixed world
 * Z and the player skis toward (and eventually through) it.
 */
export class StormWall {
  constructor(scene) {
    this.scene = scene;
    this._elapsed = 0;
    this._layers = [];

    for (const cfg of LAYER_CONFIGS) {
      // Tall and centered low: the chase camera (Camera.ts) sits behind and
      // above the player looking down at a fairly steep angle, which pushes
      // its boresight well below ground at range - a modest plane centered
      // much above ground height ended up entirely above the visible
      // frustum before it ever got close enough to matter.
      const geo = new THREE.PlaneGeometry(900 * cfg.scale, 320 * cfg.scale, 1, 1);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPhase: { value: cfg.phase },
          uOpacity: { value: 0 },
          uColor: { value: new THREE.Color(0xeef2f5) },
        },
        vertexShader: WALL_VERT,
        fragmentShader: WALL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = -2;
      mesh.frustumCulled = false;
      scene.add(mesh);

      this._layers.push({ mesh, mat, zOffset: cfg.zOffset, opacityMult: cfg.opacityMult });
    }
  }

  update(dt) {
    this._elapsed += dt;
    for (const layer of this._layers) layer.mat.uniforms.uTime.value = this._elapsed;
  }

  /** worldZ: the zone boundary to park the wall at. baseY: current player/camera height, so it stays roughly ground-anchored. */
  setPosition(worldZ, baseY = 0) {
    for (const layer of this._layers) {
      layer.mesh.position.set(0, baseY + 10, worldZ + layer.zOffset);
    }
  }

  setOpacity(t) {
    for (const layer of this._layers) {
      layer.mat.uniforms.uOpacity.value = t * layer.opacityMult;
      layer.mesh.visible = t > 0.01;
    }
  }

  dispose() {
    for (const layer of this._layers) {
      this.scene.remove(layer.mesh);
      layer.mesh.geometry.dispose();
      layer.mat.dispose();
    }
    this._layers.length = 0;
  }
}
