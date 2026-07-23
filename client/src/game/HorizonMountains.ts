// @ts-nocheck
import * as THREE from 'three';

function createRidgeSamples({ width, baseY, height, segments, depth, phase }) {
  const samples = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = (t - 0.5) * width;
    const centerPeak = Math.pow(Math.sin(t * Math.PI), 0.52) * height;
    const jagged =
      Math.sin(t * Math.PI * 4.0 + phase) * 0.16 +
      Math.sin(t * Math.PI * 9.0 + phase * 0.53) * 0.1 +
      Math.sin(t * Math.PI * 17.0 + phase * 1.37) * 0.045;
    const y = baseY + centerPeak * (0.66 + jagged);
    const z = Math.sin(t * Math.PI * 3.0 + phase) * depth +
      Math.sin(t * Math.PI * 8.0 + phase * 0.4) * depth * 0.26;
    samples.push({ t, x, y, z });
  }
  return samples;
}

function createRidgeGeometry({ width, baseY, height, segments, depth, phase }) {
  const positions = [];
  const indices = [];
  const samples = createRidgeSamples({ width, baseY, height, segments, depth, phase });

  for (const sample of samples) {
    positions.push(sample.x, baseY - 15, sample.z);
    positions.push(sample.x, sample.y, sample.z);
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return { geo, samples };
}

function createSnowCaps({ samples, baseY, height, count, phase }) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xf3f8fb,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    fog: true,
  });

  for (let i = 0; i < count; i++) {
    const idx = Math.max(1, Math.min(samples.length - 2, Math.round(((i + 0.5) / count) * (samples.length - 1))));
    const peak = samples[idx];
    const shoulderL = samples[Math.max(0, idx - 1)];
    const shoulderR = samples[Math.min(samples.length - 1, idx + 1)];
    const capW = Math.max(4, Math.abs(shoulderR.x - shoulderL.x) * 1.9);
    const capH = height * (0.08 + (Math.sin(i * 2.1 + phase) * 0.5 + 0.5) * 0.055);
    const notch = Math.sin(i * 8.31 + phase) * capH * 0.22;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      peak.x - capW * 0.55, peak.y - capH * 0.95, peak.z - 0.26,
      peak.x - capW * 0.16, peak.y - capH * 0.2 + notch, peak.z - 0.28,
      peak.x, peak.y + capH * 0.42, peak.z - 0.3,
      peak.x + capW * 0.22, peak.y - capH * 0.12 - notch, peak.z - 0.28,
      peak.x + capW * 0.58, peak.y - capH, peak.z - 0.26,
    ], 3));
    geo.setIndex([0, 1, 2, 0, 2, 4, 2, 3, 4]);
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, mat));
  }

  return { group, material: mat };
}

function createFacetGroup({ samples, baseY, color, opacity, phase }) {
  const group = new THREE.Group();
  const shadeMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).offsetHSL(0, -0.03, -0.12),
    transparent: true,
    opacity,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
  });
  const lightMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).offsetHSL(0.015, 0.02, 0.14),
    transparent: true,
    opacity: opacity * 0.62,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
  });

  for (let i = 2; i < samples.length - 2; i += 3) {
    const peak = samples[i];
    if (peak.y < baseY + 10) continue;
    const span = 2 + ((i + Math.floor(phase)) % 3);
    const left = samples[Math.max(0, i - span)];
    const right = samples[Math.min(samples.length - 1, i + span)];
    const midY = baseY - 7 + Math.sin(i * 1.87 + phase) * 1.2;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      peak.x, peak.y - 1.1, peak.z - 0.18,
      left.x, midY, left.z + 0.1,
      right.x, midY + Math.sin(i + phase) * 1.6, right.z + 0.1,
    ], 3));
    geo.setIndex([0, 1, 2]);
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, i % 2 === 0 ? shadeMat : lightMat));
  }

  return { group, materials: [shadeMat, lightMat] };
}

function createFoothills({ width, baseY, segments, depth, phase }) {
  const positions = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = (t - 0.5) * width;
    const y = baseY + 2.8 + Math.sin(t * Math.PI * 5 + phase) * 2.2 +
      Math.sin(t * Math.PI * 13 + phase * 0.7) * 0.8;
    const z = Math.sin(t * Math.PI * 4 + phase) * depth * 0.55;
    positions.push(x, baseY - 9, z);
    positions.push(x, y, z);
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export class HorizonMountains {
  constructor(scene, fogColor = 0xc8dae8) {
    this.scene = scene;
    this.group = new THREE.Group();
    this._materials = [];

    const layers = [
      {
        width: 260,
        baseY: -6,
        height: 34,
        z: 185,
        depth: 8,
        color: 0x9bb4c9,
        opacity: 0.36,
        parallax: 0.06,
        phase: 0.8,
      },
      {
        width: 225,
        baseY: -8,
        height: 46,
        z: 150,
        depth: 11,
        color: 0x7897b3,
        opacity: 0.5,
        parallax: 0.1,
        phase: 2.35,
      },
      {
        width: 190,
        baseY: -10,
        height: 36,
        z: 118,
        depth: 9,
        color: 0x5e7f9a,
        opacity: 0.46,
        parallax: 0.15,
        phase: 4.1,
      },
    ];

    for (const layer of layers) {
      const layerGroup = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({
        color: layer.color,
        transparent: true,
        opacity: layer.opacity,
        depthWrite: false,
        fog: true,
      });
      this._materials.push(mat);

      const ridgeData = createRidgeGeometry({
        width: layer.width,
        baseY: layer.baseY,
        height: layer.height,
        segments: 42,
        depth: layer.depth,
        phase: layer.phase,
      });
      const ridge = new THREE.Mesh(ridgeData.geo, mat);
      ridge.renderOrder = -4;
      layerGroup.add(ridge);

      const facets = createFacetGroup({
        samples: ridgeData.samples,
        baseY: layer.baseY,
        color: layer.color,
        opacity: layer.opacity * 0.42,
        phase: layer.phase,
      });
      facets.group.renderOrder = -3;
      layerGroup.add(facets.group);
      this._materials.push(...facets.materials);

      const caps = createSnowCaps({
        samples: ridgeData.samples,
        baseY: layer.baseY,
        height: layer.height,
        count: 10,
        phase: layer.phase,
      });
      caps.group.renderOrder = -2;
      layerGroup.add(caps.group);
      this._materials.push(caps.material);

      const footMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(layer.color).offsetHSL(0.01, -0.02, 0.08),
        transparent: true,
        opacity: layer.opacity * 0.48,
        depthWrite: false,
        fog: true,
      });
      const foothills = new THREE.Mesh(
        createFoothills({
          width: layer.width * 1.08,
          baseY: layer.baseY - 2,
          segments: 26,
          depth: layer.depth,
          phase: layer.phase * 1.7,
        }),
        footMat,
      );
      foothills.position.z = -2.6;
      foothills.renderOrder = -1;
      layerGroup.add(foothills);
      this._materials.push(footMat);

      layerGroup.position.z = layer.z;
      layerGroup.userData.parallax = layer.parallax;
      this.group.add(layerGroup);
    }

    this.group.position.y = 0;
    this.scene.add(this.group);
  }

  update(cameraPos) {
    if (!cameraPos) return;
    this.group.position.z = cameraPos.z;
    for (const child of this.group.children) {
      child.position.x = cameraPos.x * child.userData.parallax;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
    });
    for (const mat of this._materials) mat.dispose();
  }
}
