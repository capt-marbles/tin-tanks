// Render pipeline: scene -> N8AO ambient occlusion -> bloom + colour punch +
// vignette + SMAA. Toggle with the G key; "low" renders the scene directly.
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect,
  SMAAEffect, SMAAPreset, HueSaturationEffect, BrightnessContrastEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export function createPipeline(renderer, scene, camera) {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));

  // Contact shadows under tanks, walls and trees. Radius is in world units;
  // a tank is ~2.6 m long so 2.5 m grounds objects without smearing the map.
  const ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
  ao.configuration.aoRadius = 2.2;
  ao.configuration.distanceFalloff = 1.0;
  ao.configuration.intensity = 2.3;
  ao.configuration.halfRes = true;
  ao.configuration.gammaCorrection = false; // the composer converts to sRGB at the end
  ao.setQualityMode('Medium');
  composer.addPass(ao);

  // Bloom only catches the brightest things: muzzle flashes, shells, explosions, sun-lit whites.
  const bloom = new BloomEffect({
    luminanceThreshold: 0.82, luminanceSmoothing: 0.25, intensity: 0.9, mipmapBlur: true, radius: 0.7,
  });
  const punch = new HueSaturationEffect({ saturation: 0.15 });
  const contrast = new BrightnessContrastEffect({ contrast: 0.08 });
  const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.45 });
  const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
  composer.addPass(new EffectPass(camera, bloom, punch, contrast, vignette, smaa));

  return {
    composer,
    ao,
    setSize(w, h) { composer.setSize(w, h); },
    render(dt) { composer.render(dt); },
  };
}
