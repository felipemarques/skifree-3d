// @ts-nocheck
import * as THREE from 'three';

const CHUNK_SIZE = 80;
const CHUNK_WIDTH = 120;
const SEGMENTS_X = 58;
const SEGMENTS_Z = 42;

const VERT = /* glsl */`
  uniform float uTime;
  uniform vec2 uAnchor;
  varying vec3 vWorldPos;
  varying float vVisualY;
  varying float vRidge;
  varying float vLight;
  varying float vRelZ;
  varying vec3 vSnowNormal;

  float snowRelief(vec2 p) {
    return
      sin(p.x * 0.08 + p.y * 0.045) * 0.42 +
      sin(p.x * 0.19 - p.y * 0.033) * 0.22 +
      sin(p.x * 0.48 + p.y * 0.17) * 0.07;
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
    vLight = clamp(0.74 + reliefX * 0.42 - reliefZ * 0.28, 0.42, 1.08);

    // Real surface normal from the height field's slope, so the fragment
    // shader can light the relief against the actual scene sun direction
    // instead of the vLight approximation above alone.
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
  uniform float uTime;
  varying vec3 vWorldPos;
  varying float vVisualY;
  varying float vRidge;
  varying float vLight;
  varying float vRelZ;
  varying vec3 vSnowNormal;

  float sparkleHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 shadowSnow = vec3(0.58, 0.70, 0.82);
    vec3 midSnow = vec3(0.78, 0.86, 0.92);
    vec3 brightSnow = vec3(0.93, 0.96, 0.98);

    float heightMix = smoothstep(-0.6, 0.75, vRidge);
    vec3 col = mix(shadowSnow, brightSnow, heightMix);

    float cross = sin(vWorldPos.x * 0.18 + vWorldPos.z * 0.055) * 0.5 + 0.5;
    float longBands = sin(vWorldPos.z * 0.12 + vWorldPos.x * 0.025) * 0.5 + 0.5;
    float softShade = smoothstep(0.18, 0.82, cross * 0.65 + longBands * 0.35);
    col = mix(col * 0.82, mix(col, midSnow, 0.28), softShade);
    col *= vLight;

    // Real diffuse lighting from the height-field normal against the
    // scene's actual sun direction (see Game.ts's DirectionalLight), layered
    // on top of the vLight approximation above so the bumps read as
    // physically dimensional rather than painted-on.
    vec3 sunDir = normalize(vec3(-26.0, 56.0, 22.0));
    float ndotl = clamp(dot(vSnowNormal, sunDir), 0.0, 1.0);
    col *= mix(0.86, 1.14, ndotl);

    vec3 viewDir = normalize(cameraPosition - vWorldPos);

    // Fine per-pixel grain so close-up snow reads as granular/packed rather
    // than a smooth gradient.
    float grain = sparkleHash(floor(vWorldPos.xz * 46.0)) - 0.5;
    col += grain * 0.035;

    float pathLine = smoothstep(0.47, 0.5, abs(fract(vWorldPos.x / 8.5) - 0.5) * 2.0);
    col = mix(col * 0.88, col, pathLine);

    float centerTrack = 1.0 - smoothstep(10.0, 34.0, abs(vWorldPos.x));
    float sideGlint = smoothstep(0.68, 1.0, sin(vWorldPos.z * 0.24 + abs(vWorldPos.x) * 0.08) * 0.5 + 0.5);
    col = mix(col, vec3(0.86, 0.93, 0.98), centerTrack * sideGlint * 0.07);

    float slopeDistance = 1.0 - smoothstep(20.0, 210.0, vRelZ);
    col = mix(col, brightSnow, 0.03 * slopeDistance);

    // Hazy, blown-out-white horizon: far-ahead terrain washes toward bright
    // snow (distance haze), and shallow viewing angles pick up an extra rim
    // brighten (fresnel) the way sunlit snow does at a grazing look.
    float farHaze = smoothstep(80.0, 220.0, vRelZ);
    col = mix(col, vec3(0.95, 0.97, 1.0), farHaze * 0.22);
    float fresnel = pow(1.0 - clamp(abs(viewDir.y), 0.0, 1.0), 2.2);
    col = mix(col, vec3(0.92, 0.96, 1.0), fresnel * 0.06);

    // Sparse, view-angle-weighted glints mimicking sunlight catching ice
    // crystals - sparkle *positions* come from a per-cell hash so they're
    // stable in world space, but a second hash keyed off cell + slow time
    // makes them twinkle rather than sitting there as static dots.
    vec2 sparkleCell = floor(vWorldPos.xz * 3.1);
    float sparkleRnd = sparkleHash(sparkleCell);
    float sparklePresence = step(0.978, sparkleRnd);
    float grazing = pow(clamp(viewDir.y, 0.0, 1.0), 1.6);
    float twinkle = sparkleHash(sparkleCell + floor(uTime * 5.0 + sparkleRnd * 37.0));
    float sparkle = sparklePresence * grazing * smoothstep(0.15, 0.95, twinkle);
    col += vec3(1.0, 0.99, 0.95) * sparkle * 0.55;

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
