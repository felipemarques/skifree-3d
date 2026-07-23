import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';

// ──────────────────────────────────────────────────────────────────────────
// PostFX — bloom post-processing chain.
//   RenderPass → UnrealBloomPass → OutputPass
//
// Settings (tuned for 60fps on mid-tier hardware):
//   strength  : 0.12  - very subtle glow
//   radius    : 0.18  - tight spread
//   threshold : 1.02  - avoid blooming the snowfield
// ──────────────────────────────────────────────────────────────────────────

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene    = scene;
    this.camera   = camera;

    const w = renderer.domElement.width;
    const h = renderer.domElement.height;

    this.composer = new EffectComposer(renderer);
    this.composer.setSize(w, h);

    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      0.12,   // strength
      0.18,   // radius
      1.02,   // threshold
    );
    this.composer.addPass(this.bloomPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  /** Replace `renderer.render(...)` in the game loop. */
  render() {
    this.composer.render();
  }

  resize(w, h) {
    this.composer.setSize(w, h);
  }

  dispose() {
    this.composer.dispose();
  }
}
