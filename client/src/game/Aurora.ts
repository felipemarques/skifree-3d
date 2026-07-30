// @ts-nocheck
import * as THREE from 'three';

const AURORA_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const AURORA_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uIntensity;
  varying vec3 vDir;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5);
  }

  void main() {
    // Band range tuned to where the sky is actually visible on screen, not
    // straight up - Camera.ts's chase cam tilts steeply down to keep the
    // nearby player framed, so its boresight sits well below the horizon
    // and only a thin slice above the horizon line ever reaches the top of
    // the frame. Centering the aurora near vDir.y=0 (roughly the horizon,
    // matching SkyBg.ts's own ground/horizon/top gradient split) instead of
    // high overhead is both what actually shows on screen and more
    // realistic - auroras read as a band along the horizon, not overhead.
    if (uIntensity <= 0.001 || vDir.y < -0.2 || vDir.y > 0.35) {
      gl_FragColor = vec4(0.0);
      return;
    }

    float band = sin(vDir.x * 3.2 + vDir.y * 4.0 + uTime * 0.12) * 0.5 + 0.5;
    band += sin(vDir.x * 6.7 - uTime * 0.18) * 0.15;
    float envelope = smoothstep(-0.12, 0.0, vDir.y) * (1.0 - smoothstep(0.1, 0.3, vDir.y));

    float shimmer = hash(floor(vec2(vDir.x * 18.0, uTime * 0.6)));
    float alpha = clamp(band, 0.0, 1.0) * envelope * (0.55 + shimmer * 0.45) * uIntensity;

    vec3 col = mix(vec3(0.1, 0.9, 0.55), vec3(0.55, 0.25, 0.85), clamp(band, 0.0, 1.0) * 0.6);
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

/** Camera-relative aurora band, same pattern as SkyBg.ts - a sphere just
 * inside the sky dome, additively blended, faded in/out via setIntensity
 * (driven by Biome.ts's auroraIntensity, so it only appears in the cliffs
 * biome and fades smoothly across the existing transition band). */
export class Aurora {
  constructor(scene) {
    this.scene = scene;
    this._elapsed = 0;

    const geo = new THREE.SphereGeometry(150, 32, 16);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
      },
      vertexShader: AURORA_VERT,
      fragmentShader: AURORA_FRAG,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  update(dt, cameraPos) {
    this._elapsed += dt;
    this.mat.uniforms.uTime.value = this._elapsed;
    if (cameraPos) this.mesh.position.copy(cameraPos);
  }

  setIntensity(t) {
    this.mat.uniforms.uIntensity.value = t;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
