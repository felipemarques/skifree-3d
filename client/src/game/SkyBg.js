import * as THREE from 'three';

const SKY_TOP = new THREE.Color(0x426b92);
const SKY_HORIZON = new THREE.Color(0xb6cada);
const SKY_GROUND = new THREE.Color(0xd6e1e8);

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  varying vec3 vDir;

  void main() {
    float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uGround, uHorizon, smoothstep(0.0, 0.42, h));
    col = mix(col, uTop, smoothstep(0.42, 1.0, h));

    vec3 sunDir = normalize(vec3(-0.42, 0.62, 0.28));
    float sunCore = smoothstep(0.996, 1.0, dot(vDir, sunDir));
    float sunGlow = smoothstep(0.88, 1.0, dot(vDir, sunDir)) * 0.26;
    float horizonGlow = (1.0 - smoothstep(0.38, 0.58, h)) * 0.1;

    col += vec3(1.0, 0.92, 0.78) * sunCore * 0.78;
    col += vec3(0.85, 0.94, 1.0) * sunGlow;
    col += vec3(0.82, 0.92, 1.0) * horizonGlow;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class SkyBg {
  constructor(scene) {
    this.scene = scene;

    const geo = new THREE.SphereGeometry(155, 36, 18);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: SKY_TOP },
        uHorizon: { value: SKY_HORIZON },
        uGround: { value: SKY_GROUND },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  update(cameraPos) {
    this.mesh.position.copy(cameraPos);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
