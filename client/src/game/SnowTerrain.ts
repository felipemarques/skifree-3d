// @ts-nocheck
import * as THREE from 'three';

const CHUNK_SIZE = 80;
// Wide enough to cover the decorative border treeline and landmarks (out to
// ~x=108) with real ground underneath - previously 120 (+-60), which left
// everything placed past the track a visible void with nothing rendered
// beneath it.
const CHUNK_WIDTH = 240;
const SEGMENTS_X = 116;
const SEGMENTS_Z = 42;

const VERT = /* glsl */`
  uniform float uTime;
  uniform vec2 uAnchor;
  uniform float uReliefMult;
  varying vec3 vWorldPos;
  varying float vVisualY;
  varying float vRidge;
  varying float vRelZ;
  varying vec3 vSnowNormal;

  float snowRelief(vec2 p) {
    return
      sin(p.x * 0.08 + p.y * 0.045) * 1.1 +
      sin(p.x * 0.19 - p.y * 0.033) * 0.6 +
      sin(p.x * 0.48 + p.y * 0.17) * 0.22 +
      sin(p.x * 0.9 - p.y * 0.55) * 0.09 +
      sin(p.x * 0.022 + p.y * 0.014) * 2.6 * uReliefMult;
  }

  void main() {
    vec3 pos = position;
    vec4 worldBase = modelMatrix * vec4(pos, 1.0);

    float relZ = clamp(worldBase.z - uAnchor.y, -70.0, 230.0);
    float slope = -relZ * 0.026;
    float reliefBase = snowRelief(worldBase.xz);
    float relief = (reliefBase - snowRelief(uAnchor)) * 0.78;
    float micro = sin(worldBase.x * 1.35 + worldBase.z * 0.8 + uTime * 0.35) * 0.018;

    float visualY = slope + relief + micro;
    pos.y += visualY;

    float reliefX = snowRelief(worldBase.xz + vec2(1.4, 0.0)) - reliefBase;
    float reliefZ = snowRelief(worldBase.xz + vec2(0.0, 1.4)) - reliefBase;

    // Real surface normal from the height field's slope, so the fragment
    // shader can light the relief against the actual scene sun direction.
    float dHdx = (reliefX * 0.78) / 1.4;
    float dHdz = (reliefZ * 0.78) / 1.4 - 0.026;
    vSnowNormal = normalize(vec3(-dHdx, 1.0, -dHdz));

    vVisualY = visualY;
    vRidge = relief;
    vRelZ = relZ;
    vWorldPos = vec3(worldBase.x, worldBase.y + visualY, worldBase.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FRAG = /* glsl */`
  uniform vec3 uBiomeTint;
  varying vec3 vWorldPos;
  varying float vVisualY;
  varying float vRidge;
  varying float vRelZ;
  varying vec3 vSnowNormal;

  void main() {
    // Calmer, closer to MenuBackdrop.ts's clean two-tone terrain look -
    // most of the busier per-pixel detail (grain, sparkle twinkle,
    // cross-hatch shading, glints, fresnel rim) that had piled up here over
    // several passes has been dropped in favor of one real lighting term.
    vec3 shadowSnow = vec3(0.62, 0.74, 0.84);
    vec3 brightSnow = vec3(0.92, 0.97, 1.0);

    float heightMix = smoothstep(-0.6, 0.75, vRidge);
    vec3 col = mix(shadowSnow, brightSnow, heightMix);

    // Real diffuse lighting from the height-field normal against the
    // scene's actual sun direction, so the (now much bumpier) relief still
    // reads as physically dimensional despite the subtler palette.
    vec3 sunDir = normalize(vec3(-26.0, 56.0, 22.0));
    float ndotl = clamp(dot(vSnowNormal, sunDir), 0.0, 1.0);
    col *= mix(0.88, 1.08, ndotl);

    // Faint groomed-corduroy lane stripes running the full width of the
    // trail - very low color contrast (barely-there shading) but a crisp,
    // narrow transition at each line rather than a soft blurred gradient,
    // so the division between stripes still reads clearly up close.
    float laneG = fract(vWorldPos.x / 8.5);
    float laneDist = abs(laneG - 0.5) * 2.0;
    float laneLine = smoothstep(0.486, 0.5, laneDist);
    col = mix(col, col * 0.95, laneLine);

    // Groomed trail edges - a calmer, distinctly packed strip right at the
    // playable width's boundary (Obstacles.ts's TRACK_LIMIT=52) with a
    // faint corduroy groove pattern, so the run reads as a marked trail
    // rather than open, edgeless snowfield.
    float ax = abs(vWorldPos.x);
    float edgeBand = smoothstep(46.0, 50.0, ax) - smoothstep(54.0, 59.0, ax);
    float corduroy = sin(vWorldPos.z * 2.2) * 0.5 + 0.5;
    vec3 edgeColor = mix(vec3(0.74, 0.82, 0.9), vec3(0.86, 0.91, 0.96), corduroy);
    col = mix(col, edgeColor, edgeBand * 0.5);

    // Soft distance haze so far-ahead terrain washes gently toward the
    // sky/fog tone instead of staying sharply saturated at the draw limit.
    float farHaze = smoothstep(90.0, 220.0, vRelZ);
    col = mix(col, vec3(0.95, 0.97, 1.0), farHaze * 0.2);

    col *= uBiomeTint;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class SnowTerrain {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAnchor: { value: new THREE.Vector2(0, 0) },
        uBiomeTint: { value: new THREE.Color(1, 1, 1) },
        uReliefMult: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
  }

  _makeChunk(chunkIndex) {
    const group = new THREE.Group();
    const geo = new THREE.PlaneGeometry(CHUNK_WIDTH, CHUNK_SIZE, SEGMENTS_X, SEGMENTS_Z);
    geo.rotateX(-Math.PI / 2);

    const mesh = new THREE.Mesh(geo, this._material);
    mesh.position.set(0, 0, chunkIndex * CHUNK_SIZE + CHUNK_SIZE / 2);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);

    group.userData.chunkIndex = chunkIndex;
    this.scene.add(group);
    return group;
  }

  setBiomeTint(color) {
    this._material.uniforms.uBiomeTint.value.copy(color);
  }

  setReliefMult(mult) {
    this._material.uniforms.uReliefMult.value = mult;
  }

  update(playerZ, elapsed = 0, anchorX = 0) {
    this._material.uniforms.uTime.value = elapsed;
    this._material.uniforms.uAnchor.value.set(anchorX, playerZ);

    const currentChunk = Math.floor(playerZ / CHUNK_SIZE);

    for (let i = currentChunk - 1; i <= currentChunk + 4; i++) {
      if (!this.chunks.has(i)) {
        this.chunks.set(i, this._makeChunk(i));
      }
    }

    for (const [idx, group] of this.chunks.entries()) {
      if (idx < currentChunk - 3) {
        this.scene.remove(group);
        group.traverse(obj => {
          if (obj.geometry) obj.geometry.dispose();
        });
        this.chunks.delete(idx);
      }
    }
  }

  dispose() {
    for (const [, group] of this.chunks) {
      this.scene.remove(group);
      group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
      });
    }
    this.chunks.clear();
    this._material.dispose();
  }
}
