// @ts-nocheck
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
//
// Depth-of-field (BokehPass) and a speed-based radial blur were tried here
// and pulled back out - even tuned down until visually near-invisible, they
// still hurt play (BokehPass renders a full extra scene depth pass every
// frame regardless of how subtle its output is tuned to be, and the radial
// blur read as disorienting during boost). Not reintroducing either without
// being able to actually see/profile the result.
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
    // Bloom is an inherently soft/blurry effect - running its blur chain at
    // half resolution (on top of UnrealBloomPass's own internal halving, so
    // its render targets end up at quarter screen res) is imperceptible in
    // the composited output but cuts real fill-rate cost. Confirmed via
    // live profiling that this bloom pass alone was the single largest
    // per-frame cost in the game (>60% of total scripting time) - heavy
    // enough that the main thread never had an idle gap for the browser to
    // dispatch lower-priority work like incoming WebSocket messages,
    // starving debug:ping/pong (and, worse, actual game:snapshot) delivery
    // for seconds at a time under sustained load (e.g. boosting). Explicit
    // because EffectComposer.setSize() (see resize() below) would otherwise
    // reset this pass back to its own full-res-derived sizing on resize.
    this._applyBloomResolution(w, h);
    this.composer.addPass(this.bloomPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  _applyBloomResolution(w, h) {
    this.bloomPass.setSize(Math.round(w / 2), Math.round(h / 2));
  }

  /** No-op now that speed blur has been removed - kept so Game.ts's existing call sites don't need changes. */
  update() {}

  /** Replace `renderer.render(...)` in the game loop. */
  render() {
    this.composer.render();
  }

  resize(w, h) {
    this.composer.setSize(w, h);
    this._applyBloomResolution(w, h);
  }

  dispose() {
    this.composer.dispose();
  }
}
