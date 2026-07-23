// @ts-nocheck
import * as THREE from 'three';

const CHUNK_SIZE = 80;    // world units per chunk (Z axis)
const CHUNK_WIDTH = 120;  // world units wide (X axis)
const SEGMENTS = 16;

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map(); // chunkIndex -> mesh
    this.playerZ = 0;
  }

  _makeChunk(chunkIndex) {
    const group = new THREE.Group();

    // Snow ground
    const geo = new THREE.PlaneGeometry(CHUNK_WIDTH, CHUNK_SIZE, SEGMENTS, SEGMENTS);
    // Slightly perturb vertices for bumpy feel
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, pos.getZ(i) + (Math.random() - 0.5) * 0.12);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(0.93, 0.96, 1.0),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0, chunkIndex * CHUNK_SIZE + CHUNK_SIZE / 2);
    mesh.receiveShadow = true;
    group.add(mesh);

    // Subtle grid lines (ski tracks effect) - thin darker strips along Z
    for (let i = -2; i <= 2; i++) {
      const trackGeo = new THREE.PlaneGeometry(0.15, CHUNK_SIZE);
      const trackMat = new THREE.MeshBasicMaterial({
        color: 0xc8d8ee,
        transparent: true,
        opacity: 0.5,
      });
      const track = new THREE.Mesh(trackGeo, trackMat);
      track.rotation.x = -Math.PI / 2;
      track.position.set(i * 8, 0.005, chunkIndex * CHUNK_SIZE + CHUNK_SIZE / 2);
      group.add(track);
    }

    group.userData.chunkIndex = chunkIndex;
    this.scene.add(group);
    return group;
  }

  update(playerZ) {
    this.playerZ = playerZ;
    // Determine which chunks should be visible: current and ±2 ahead/behind
    const currentChunk = Math.floor(playerZ / CHUNK_SIZE);

    for (let i = currentChunk - 1; i <= currentChunk + 4; i++) {
      if (!this.chunks.has(i)) {
        this.chunks.set(i, this._makeChunk(i));
      }
    }

    // Remove chunks that are far behind
    for (const [idx, group] of this.chunks.entries()) {
      if (idx < currentChunk - 3) {
        this.scene.remove(group);
        group.traverse(obj => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
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
        if (obj.material) obj.material.dispose();
      });
    }
    this.chunks.clear();
  }
}
