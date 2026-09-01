import * as THREE from "three"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { VignetteShader } from "three/addons/shaders/VignetteShader.js"
import { FXAAShader } from "three/addons/shaders/FXAAShader.js"

/**
 * The pass that makes a scene look like a game rather than a viewport.
 *
 * Bloom is the one that matters: it is what makes an emissive material read as
 * something glowing rather than something painted bright, and it is why neon,
 * lasers, portals and power-ups look like themselves. Pair it with
 * `materials.glow()` and the two do the work together.
 *
 *   createPostFX(engine, { bloom: { strength: 0.8 } })
 *
 * One caveat worth knowing: post-processing costs a full-screen pass per
 * effect, so on a phone this is the first thing to turn off. The `quality`
 * option does that automatically.
 */
export function createPostFX(engine, options = {}) {
  const {
    bloom = true,
    vignette = false,
    fxaa = false,
    // Post-processing disables the renderer's own MSAA, so a low-end device
    // gets a scene that is both slower and jaggier. Skipping it there is not a
    // compromise, it is the better picture.
    quality = "auto",
  } = options

  const mobile = matchMedia?.("(pointer: coarse)").matches ?? false
  if (quality === "off" || (quality === "auto" && mobile)) {
    return { enabled: false, composer: null, passes: {}, dispose() {} }
  }

  const { renderer, scene, camera, size } = engine
  const composer = new EffectComposer(renderer)
  composer.setPixelRatio(renderer.getPixelRatio())
  composer.setSize(size.width, size.height)

  const passes = {}

  composer.addPass(new RenderPass(scene, camera))

  if (bloom) {
    const config = bloom === true ? {} : bloom
    const {
      // Restrained by default. Strong bloom washes out a whole scene, and the
      // usual mistake is a threshold low enough to make everything glow.
      strength = 0.55,
      radius = 0.5,
      threshold = 0.85,
    } = config
    passes.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      strength,
      radius,
      threshold
    )
    composer.addPass(passes.bloom)
  }

  if (vignette) {
    const config = vignette === true ? {} : vignette
    passes.vignette = new ShaderPass(VignetteShader)
    passes.vignette.uniforms.offset.value = config.offset ?? 1.1
    passes.vignette.uniforms.darkness.value = config.darkness ?? 1.1
    composer.addPass(passes.vignette)
  }

  // Tone mapping and sRGB conversion happen here rather than in the renderer
  // once a composer is in play. Without this pass the whole image comes out
  // washed out and pale — the single most common post-processing bug.
  composer.addPass(new OutputPass())

  if (fxaa) {
    passes.fxaa = new ShaderPass(FXAAShader)
    composer.addPass(passes.fxaa)
  }

  const target = {
    render: () => composer.render(),
    setSize(width, height) {
      composer.setSize(width, height)
      passes.bloom?.resolution.set(width, height)
      const ratio = renderer.getPixelRatio()
      passes.fxaa?.material.uniforms.resolution.value.set(
        1 / (width * ratio),
        1 / (height * ratio)
      )
    },
  }
  target.setSize(size.width, size.height)
  engine.setRenderTarget(target)

  return {
    enabled: true,
    composer,
    passes,
    /** Turn the whole chain off — a quality setting, or a performance panic. */
    setEnabled(value) {
      engine.setRenderTarget(value ? target : null)
    },
    dispose() {
      engine.setRenderTarget(null)
      composer.dispose()
    },
  }
}
