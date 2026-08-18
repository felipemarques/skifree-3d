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
  uniform float uIceZoneStart;
  uniform float uIceZoneEnd;
  uniform float uForkZoneStart;
  uniform float uForkZoneEnd;
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

    // Ice zone ground tint - visible well before the player reaches it
    // (uIceZoneStart/End set from shared/AuthoritativeSim.ts's
    // getIceZoneAhead), with a soft-edged band matching the same 80m
    // transition width the grip physics itself fades over, so the visual
    // boundary lines up with where handling actually starts changing.
    float iceBand = smoothstep(uIceZoneStart - 40.0, uIceZoneStart + 40.0, vWorldPos.z)
                  - smoothstep(uIceZoneEnd - 40.0, uIceZoneEnd + 40.0, vWorldPos.z);

    // Saturated, clearly-blue base color so the patch reads as ice at a
    // glance from any angle, not just where the reflection below happens to
    // catch the light - a purely angle-gated effect was too easy to miss
    // entirely depending on where the camera looked (minor list: ice not
    // spottable).
    col = mix(col, col * vec3(0.35, 0.72, 1.0) * 1.3, iceBand * 0.85);

    // Reflection on top: smooth the bumpy snow normal toward flat (real ice
    // is slick, not ridged - this also avoids moire aliasing from reflecting
    // off the high-frequency relief normal at a distance) and reflect a
    // simple two-tone sky gradient off it. Fresnel still shapes it (grazing
    // angles reflect more, like real ice), but the floor is raised well
    // above a physically "correct" value so it stays visibly shiny even
    // looking straight down at it, plus a broad (not mirror-tight) sun
    // glint. (A per-pixel time-based shimmer was tried here too but caused a
    // distracting moire ripple at distance - see M-list - so it's out.)
    if (iceBand > 0.001) {
      vec3 iceNormal = normalize(mix(vSnowNormal, vec3(0.0, 1.0, 0.0), 0.85));
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      vec3 reflectDir = reflect(-viewDir, iceNormal);

      vec3 skyHorizon = vec3(0.86, 0.93, 1.0);
      vec3 skyZenith = vec3(0.3, 0.52, 0.85);
      vec3 skyReflection = mix(skyHorizon, skyZenith, clamp(reflectDir.y * 0.5 + 0.5, 0.0, 1.0));

      float fresnel = pow(1.0 - clamp(dot(viewDir, iceNormal), 0.0, 1.0), 2.0);
      float reflectivity = mix(0.6, 1.0, fresnel);
      col = mix(col, skyReflection, iceBand * reflectivity);

      float specAngle = clamp(dot(reflectDir, sunDir), 0.0, 1.0);
      col += pow(specAngle, 10.0) * iceBand * 2.2;
    }

    // Fork zone divider - paints only the safe (negative-x) lane with an icy
    // stripe; the risky lane is left as plain snow, so there's one clear
    // "this side is safe" cue instead of two lane washes/a caution stripe
    // that read as unrelated markers. Visible well before the zone starts
    // (same 40m soft edge as the ice band) so a player can pick a lane in
    // advance. uForkZoneStart/End set from getForkZoneAhead in
    // shared/AuthoritativeSim.ts.
    float forkBand = smoothstep(uForkZoneStart - 40.0, uForkZoneStart + 40.0, vWorldPos.z)
                    - smoothstep(uForkZoneEnd - 40.0, uForkZoneEnd + 40.0, vWorldPos.z);
    if (forkBand > 0.001) {
      // One signal instead of two: a solid icy stripe painted only on the
      // safe (negative-x) side, fading out toward its outer edge. The risky
      // lane is left as plain snow - "unmarked" reads as the risk on its
      // own, no separate wash/caution-stripe pair to misread as two
      // different lane markers.
      float safeSide = step(vWorldPos.x, 0.0);
      float distFromCenter = -vWorldPos.x; // positive across the safe lane
      float iceMask = smoothstep(0.0, 4.0, distFromCenter) * (1.0 - smoothstep(30.0, 44.0, distFromCenter)) * safeSide;
      vec3 iceColor = vec3(0.66, 0.9, 1.0);
      col = mix(col, col * iceColor * 1.25 + iceColor * 0.16, forkBand * iceMask * 0.85);
      // A brighter, tighter glint along the very center of the safe lane so
      // it still pops even where iceMask's outer falloff has faded.
      float glint = (1.0 - smoothstep(0.0, 14.0, distFromCenter)) * safeSide;
      col += vec3(0.55, 0.8, 1.0) * forkBand * glint * 0.18;
    }

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
        uIceZoneStart: { value: -1e6 },
        uIceZoneEnd: { value: -1e6 },
        uForkZoneStart: { value: -1e6 },
        uForkZoneEnd: { value: -1e6 },
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

  /** zone: { start, end } world-Z bounds from getIceZoneAhead, or null to
   * clear - see shared/AuthoritativeSim.ts. */
  setIceZone(zone) {
    this._material.uniforms.uIceZoneStart.value = zone ? zone.start : -1e6;
    this._material.uniforms.uIceZoneEnd.value = zone ? zone.end : -1e6;
  }

  /** zone: { start, end } world-Z bounds from getForkZoneAhead, or null to
   * clear - see shared/AuthoritativeSim.ts. */
  setForkZone(zone) {
    this._material.uniforms.uForkZoneStart.value = zone ? zone.start : -1e6;
    this._material.uniforms.uForkZoneEnd.value = zone ? zone.end : -1e6;
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
