import {
  type AbstractMesh,
  type Camera,
  Color3,
  Color4,
  ColorCurves,
  Constants,
  DefaultRenderingPipeline,
  DirectionalLight,
  HemisphericLight,
  ImageProcessingConfiguration,
  Light,
  PointLight,
  Scene,
  ShadowGenerator,
  SSAO2RenderingPipeline,
  UtilityLayerRenderer,
  Vector3,
} from "@babylonjs/core";
import { defineTunables } from "@/core/tuning";
import type { Vec3 } from "@/ecs/world";
import { floorOverride } from "@/render/floorMaterial";
import { type Box3, fitShadowFrustum, lightDirection, pulse } from "@/render/fogMath";
import { heightFog, registerHeightFog } from "@/render/heightFog";

// The atmosphere rig: cold moonlight with soft shadows, a dim cool fill, a warm breathing light on
// the player, distance + height fog, and the post stack (HDR, tonemapping, bloom, vignette, curves
// grading, MSAA/FXAA, grain, chromatic aberration, SSAO). Built once with the scene and shared by
// every scene; its numbers are tunables, read every frame. View-only: nothing here touches the sim.

export const LIGHT = defineTunables("light", {
  /** Moonlight color (sRGB). */
  moonColor: { value: "#9fb6e0", color: true },
  moonIntensity: { value: 2.2, min: 0, max: 10, step: 0.05 },
  /** Where the moon shines from, in degrees clockwise from north (−45 = north-west). */
  moonHeading: { value: -45, min: -180, max: 180, step: 1 },
  /** The moon's angle above the horizon, in degrees. */
  moonElevation: { value: 55, min: 5, max: 90, step: 1 },
  /** Ambient fill from above and below (sRGB). */
  skyColor: { value: "#4c5d80", color: true },
  groundColor: { value: "#0c0d12", color: true },
  ambientIntensity: { value: 0.55, min: 0, max: 3, step: 0.01 },
  /** The warm light over the player (sRGB). */
  playerColor: { value: "#ffb36b", color: true },
  playerIntensity: { value: 35, min: 0, max: 200, step: 0.5 },
  /** Meters until the player light fades to nothing. */
  playerRange: { value: 10, min: 1, max: 30, step: 0.1 },
  /** Height above the player's feet. */
  playerHeight: { value: 2.5, min: 0.2, max: 6, step: 0.05 },
  /** How far the player light's intensity breathes (fraction) and how fast (cycles per second). */
  playerPulse: { value: 0.06, min: 0, max: 0.5, step: 0.01 },
  playerPulseSpeed: { value: 0.25, min: 0, max: 2, step: 0.01 },
});

export const SHADOW = defineTunables("shadow", {
  enabled: { value: true },
  mapSize: { value: "2048", options: ["1024", "2048", "4096"] },
  /** pcf: soft edges; pcss: softer the farther from the caster; none: hard. */
  filter: { value: "pcf", options: ["pcf", "pcss", "none"] },
  quality: { value: "medium", options: ["low", "medium", "high"] },
  bias: { value: 0.002, min: 0, max: 0.05, step: 0.0005 },
  normalBias: { value: 0.02, min: 0, max: 0.2, step: 0.005 },
  /** Light left in the shadows (0 = none of the moon's). */
  darkness: { value: 0, min: 0, max: 1, step: 0.01 },
});

export const FOG = defineTunables("fog", {
  enabled: { value: true },
  /** Fog and background color (sRGB). */
  color: { value: "#141c2c", color: true },
  /** Distance fog (exp2) density. */
  density: { value: 0.02, min: 0, max: 0.1, step: 0.001 },
  /** Height fog density per meter at and below `heightBase`. */
  heightDensity: { value: 0.4, min: 0, max: 2, step: 0.01 },
  heightBase: { value: 0, min: -2, max: 3, step: 0.05 },
  /** Meters over which the height fog thins by e above its base. */
  heightFalloff: { value: 0.6, min: 0.05, max: 5, step: 0.05 },
});

export const POST = defineTunables("post", {
  enabled: { value: true },
  exposure: { value: 2.2, min: 0.1, max: 4, step: 0.01 },
  contrast: { value: 1.1, min: 0.5, max: 2, step: 0.01 },
  toneMapping: { value: "aces", options: ["aces", "neutral", "standard", "none"] },
  bloom: { value: true },
  bloomThreshold: { value: 0.8, min: 0, max: 2, step: 0.01 },
  bloomWeight: { value: 0.35, min: 0, max: 2, step: 0.01 },
  bloomKernel: { value: 64, min: 8, max: 256, step: 1 },
  bloomScale: { value: 0.5, min: 0.1, max: 1, step: 0.05 },
  vignette: { value: true },
  vignetteWeight: { value: 2, min: 0, max: 10, step: 0.1 },
  vignetteColor: { value: "#000000", color: true },
  msaa: { value: "4", options: ["1", "4"] },
  fxaa: { value: false },
  grain: { value: true },
  grainIntensity: { value: 6, min: 0, max: 50, step: 0.5 },
  chromatic: { value: true },
  chromaticAmount: { value: 6, min: 0, max: 100, step: 0.5 },
  ssao: { value: true },
  ssaoRadius: { value: 1, min: 0.1, max: 5, step: 0.05 },
  ssaoStrength: { value: 1.2, min: 0, max: 5, step: 0.05 },
});

/** Color curves (Babylon's `ColorCurves`): hue in degrees, the rest −100..100 (density 0..100). */
export const GRADE = defineTunables("grade", {
  enabled: { value: true },
  saturation: { value: 0, min: -100, max: 100, step: 1 },
  shadowsHue: { value: 215, min: 0, max: 360, step: 1 },
  shadowsDensity: { value: 35, min: 0, max: 100, step: 1 },
  shadowsSaturation: { value: 0, min: -100, max: 100, step: 1 },
  shadowsExposure: { value: 0, min: -100, max: 100, step: 1 },
  midtonesHue: { value: 210, min: 0, max: 360, step: 1 },
  midtonesDensity: { value: 10, min: 0, max: 100, step: 1 },
  midtonesSaturation: { value: 0, min: -100, max: 100, step: 1 },
  midtonesExposure: { value: 0, min: -100, max: 100, step: 1 },
  highlightsHue: { value: 35, min: 0, max: 360, step: 1 },
  highlightsDensity: { value: 15, min: 0, max: 100, step: 1 },
  highlightsSaturation: { value: 0, min: -100, max: 100, step: 1 },
  highlightsExposure: { value: 0, min: -100, max: 100, step: 1 },
});

/** The clear color while the atmosphere is off (the old grey-box background). */
const FLAT_CLEAR = new Color4(0.03, 0.03, 0.04, 1);
/** Padding around the shadow casters' bounds, in meters. */
const SHADOW_PAD = 1;
const FALLBACK_BOX: Box3 = { min: { x: -10, y: 0, z: -10 }, max: { x: 10, y: 3, z: 10 } };

const TONE_MAPPING = {
  aces: ImageProcessingConfiguration.TONEMAPPING_ACES,
  neutral: ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL,
  standard: ImageProcessingConfiguration.TONEMAPPING_STANDARD,
} as const;

const FILTER_QUALITY = {
  low: ShadowGenerator.QUALITY_LOW,
  medium: ShadowGenerator.QUALITY_MEDIUM,
  high: ShadowGenerator.QUALITY_HIGH,
} as const;

/** sRGB hex → Color3, cached (the tunables are read every frame). */
const colors = new Map<string, Color3>();
const srgb = (hex: string): Color3 => {
  let color = colors.get(hex);
  if (!color) {
    color = Color3.FromHexString(hex);
    colors.set(hex, color);
  }
  return color;
};

/** Sets `target[key]` only when it differs (many Babylon setters rebuild or recompile). */
function assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
  if (target[key] !== value) target[key] = value;
}

export type AtmosphereView = {
  /** Off: flat grey-box lighting, no fog, shadows or post effects, the full grid (A/B, debugging). */
  enabled: boolean;
  /** The final image in greyscale, to check values (debug). */
  valueView: boolean;
};

export type Atmosphere = ReturnType<typeof createAtmosphere>;

/**
 * Builds the rig on `scene`, rendering through `camera` (and any camera made active later, such as
 * the debug free camera). Call `reset()` on every scene load and `update(seconds)` every frame
 * after the camera is placed.
 */
export function createAtmosphere(scene: Scene, camera: Camera) {
  // Before any PBR material is built, so they all get it.
  registerHeightFog();
  const view: AtmosphereView = { enabled: true, valueView: false };
  let time = 0;

  // --- Lights ----------------------------------------------------------------------------------

  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  const moon = new DirectionalLight("moon", new Vector3(0, -1, 0), scene);
  moon.autoUpdateExtends = false;
  moon.autoCalcShadowZBounds = false;
  moon.shadowOrthoScale = 0;
  const playerLight = new PointLight("playerLight", Vector3.Zero(), scene);
  playerLight.falloffType = Light.FALLOFF_GLTF;
  playerLight.specular = Color3.Black();
  let lightTarget: (() => Vec3) | null = null;

  // --- Shadows ---------------------------------------------------------------------------------

  let casters: readonly AbstractMesh[] = [];
  let casterBox: Box3 = FALLBACK_BOX;
  let shadowSize = "";
  let shadows: ShadowGenerator | null = null;
  /** The heading/elevation the frustum was fit for, so it refits when they change. */
  let fitFor = "";

  const buildShadows = () => {
    shadows?.dispose();
    shadowSize = SHADOW.mapSize;
    shadows = new ShadowGenerator(Number(shadowSize), moon);
    for (const mesh of casters) shadows.addShadowCaster(mesh, true);
  };

  const fitShadows = () => {
    const direction = lightDirection(LIGHT.moonHeading, LIGHT.moonElevation);
    moon.direction.set(direction.x, direction.y, direction.z);
    const frustum = fitShadowFrustum(casterBox, direction);
    moon.position.set(frustum.position.x, frustum.position.y, frustum.position.z);
    moon.orthoLeft = frustum.left;
    moon.orthoRight = frustum.right;
    moon.orthoBottom = frustum.bottom;
    moon.orthoTop = frustum.top;
    moon.shadowMinZ = frustum.near;
    moon.shadowMaxZ = frustum.far;
    fitFor = `${LIGHT.moonHeading}/${LIGHT.moonElevation}`;
  };

  /** The union of the casters' world bounds (with their children), padded. */
  const boundsOf = (meshes: readonly AbstractMesh[]): Box3 => {
    if (!meshes.length) return FALLBACK_BOX;
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getHierarchyBoundingVectors(true);
      min.minimizeInPlace(bounds.min);
      max.maximizeInPlace(bounds.max);
    }
    return {
      min: { x: min.x - SHADOW_PAD, y: Math.min(min.y, 0), z: min.z - SHADOW_PAD },
      max: { x: max.x + SHADOW_PAD, y: max.y + SHADOW_PAD, z: max.z + SHADOW_PAD },
    };
  };

  // --- Post ------------------------------------------------------------------------------------

  // SSAO first, so its passes run before the default pipeline's (which rebuilds at the end). Its
  // copy of the scene color must be half float: the default 8 bits band badly in the dark.
  const ssao = new SSAO2RenderingPipeline(
    "ssao",
    scene,
    { ssaoRatio: 0.5, blurRatio: 1 },
    [camera],
    false,
    Constants.TEXTURETYPE_HALF_FLOAT,
  );
  ssao.samples = 16;
  ssao.maxZ = 100;
  const pipeline = new DefaultRenderingPipeline("atmosphere", true, scene, [camera]);
  pipeline.imageProcessingEnabled = true;
  pipeline.grain.animated = true;
  const imageProcessing = pipeline.imageProcessing;
  // Dark, smooth gradients (fog, the player light's falloff) band in 8 bits without it.
  imageProcessing.ditheringEnabled = true;
  imageProcessing.ditheringIntensity = 1 / 255;
  const grade = new ColorCurves();
  const greyscale = new ColorCurves();
  greyscale.globalSaturation = -100;
  const pipelines = scene.postProcessRenderPipelineManager;

  // The cameras the post stack renders through: the game camera and whichever is active (the
  // debug free camera). Whenever they or SSAO change, everything is detached and attached again
  // in order, SSAO's passes first.
  let attached: Camera[] = [camera];
  let ssaoOn = true;
  const syncPost = () => {
    const active = scene.activeCamera;
    const wanted = active && active !== camera ? [camera, active] : [camera];
    const ssaoWanted = view.enabled && POST.enabled && POST.ssao;
    const same = wanted.length === attached.length && wanted.every((cam, i) => cam === attached[i]);
    if (same && ssaoWanted === ssaoOn) return;
    for (const cam of attached) pipeline.removeCamera(cam);
    if (ssaoOn) pipelines.detachCamerasFromRenderPipeline("ssao", attached.slice());
    if (ssaoWanted) pipelines.attachCamerasToRenderPipeline("ssao", wanted.slice());
    for (const cam of wanted) pipeline.addCamera(cam);
    attached = wanted;
    ssaoOn = ssaoWanted;
  };
  const cameraObserver = scene.onActiveCameraChanged.add(syncPost);

  const applyPost = (on: boolean) => {
    assign(pipeline, "samples", on || !view.enabled ? Number(POST.msaa) : 1);
    assign(pipeline, "fxaaEnabled", on && POST.fxaa);
    assign(pipeline, "bloomEnabled", on && POST.bloom);
    if (on && POST.bloom) {
      assign(pipeline, "bloomThreshold", POST.bloomThreshold);
      assign(pipeline, "bloomWeight", POST.bloomWeight);
      assign(pipeline, "bloomKernel", POST.bloomKernel);
      assign(pipeline, "bloomScale", POST.bloomScale);
    }
    assign(pipeline, "grainEnabled", on && POST.grain);
    assign(pipeline.grain, "intensity", POST.grainIntensity);
    assign(pipeline, "chromaticAberrationEnabled", on && POST.chromatic);
    assign(pipeline.chromaticAberration, "aberrationAmount", POST.chromaticAmount);

    const toneMapping = POST.toneMapping;
    assign(imageProcessing, "toneMappingEnabled", on && toneMapping !== "none");
    if (toneMapping !== "none")
      assign(
        imageProcessing,
        "toneMappingType",
        TONE_MAPPING[toneMapping as keyof typeof TONE_MAPPING],
      );
    assign(imageProcessing, "exposure", on ? POST.exposure : 1);
    assign(imageProcessing, "contrast", on ? POST.contrast : 1);
    assign(imageProcessing, "vignetteEnabled", on && POST.vignette);
    if (on && POST.vignette) {
      assign(imageProcessing, "vignetteWeight", POST.vignetteWeight);
      const { r, g, b } = srgb(POST.vignetteColor);
      const color = imageProcessing.vignetteColor;
      if (color.r !== r || color.g !== g || color.b !== b) {
        imageProcessing.vignetteColor = new Color4(r, g, b, 0);
      }
    }

    // Grading, or the greyscale value view (which wins).
    const graded = on && GRADE.enabled;
    assign(imageProcessing, "colorCurvesEnabled", view.valueView || graded);
    assign(imageProcessing, "colorCurves", view.valueView ? greyscale : grade);
    if (graded) {
      assign(grade, "globalSaturation", GRADE.saturation);
      assign(grade, "shadowsHue", GRADE.shadowsHue);
      assign(grade, "shadowsDensity", GRADE.shadowsDensity);
      assign(grade, "shadowsSaturation", GRADE.shadowsSaturation);
      assign(grade, "shadowsExposure", GRADE.shadowsExposure);
      assign(grade, "midtonesHue", GRADE.midtonesHue);
      assign(grade, "midtonesDensity", GRADE.midtonesDensity);
      assign(grade, "midtonesSaturation", GRADE.midtonesSaturation);
      assign(grade, "midtonesExposure", GRADE.midtonesExposure);
      assign(grade, "highlightsHue", GRADE.highlightsHue);
      assign(grade, "highlightsDensity", GRADE.highlightsDensity);
      assign(grade, "highlightsSaturation", GRADE.highlightsSaturation);
      assign(grade, "highlightsExposure", GRADE.highlightsExposure);
    }

    syncPost();
    if (ssaoOn) {
      assign(ssao, "radius", POST.ssaoRadius);
      assign(ssao, "totalStrength", POST.ssaoStrength);
    }
  };

  // --- Overlay ---------------------------------------------------------------------------------

  // Drawn after the scene's post-processing, through the same camera: markers and debug gizmos
  // keep their true colors (no fog, grading, bloom or grain) and sit on top.
  const overlayLayer = new UtilityLayerRenderer(scene, false);
  const overlay = overlayLayer.utilityLayerScene;

  const flatDirection = new Vector3(-1, -2, 1).normalize();

  return {
    view,
    /** A scene drawn on top of the game after post-processing, unlit and unfogged. */
    overlay,

    /** What casts moon shadows (children included). The frustum is fit to their bounds. */
    setShadowCasters(meshes: readonly AbstractMesh[]): void {
      casters = meshes.slice();
      casterBox = boundsOf(casters);
      buildShadows();
      fitShadows();
    },

    /**
     * What the player light hangs over (read every frame), or null for no player light. It skips
     * `exclude` (children included): the body it hangs over would be blown out this close to it.
     */
    setLightTarget(
      target: (() => Vec3) | null,
      { exclude = [] }: { exclude?: readonly AbstractMesh[] } = {},
    ): void {
      lightTarget = target;
      playerLight.excludedMeshes = exclude.flatMap((mesh) => [mesh, ...mesh.getChildMeshes()]);
    },

    /** Forgets the last scene's casters and light target. Call on every load, before setup. */
    reset(): void {
      casters = [];
      casterBox = FALLBACK_BOX;
      shadows?.getShadowMap()?.renderList?.splice(0);
      lightTarget = null;
      playerLight.excludedMeshes = [];
      fitShadows();
    },

    update(seconds: number): void {
      time += seconds;
      const on = view.enabled;
      floorOverride.fullGrid = !on;

      // Lights: the flat grey-box rig while off.
      if (on) {
        ambient.diffuse.copyFrom(srgb(LIGHT.skyColor));
        ambient.groundColor.copyFrom(srgb(LIGHT.groundColor));
        ambient.intensity = LIGHT.ambientIntensity;
        moon.diffuse.copyFrom(srgb(LIGHT.moonColor));
        moon.intensity = LIGHT.moonIntensity;
        if (fitFor !== `${LIGHT.moonHeading}/${LIGHT.moonElevation}`) fitShadows();
      } else {
        ambient.diffuse.set(1, 1, 1);
        ambient.groundColor.set(0.3, 0.3, 0.3);
        ambient.intensity = 0.5;
        moon.diffuse.set(1, 1, 1);
        moon.intensity = 1.2;
        moon.direction.copyFrom(flatDirection);
        fitFor = "";
      }
      const target = on ? lightTarget?.() : undefined;
      playerLight.setEnabled(target !== undefined);
      if (target) {
        playerLight.position.set(target.x, target.y + LIGHT.playerHeight, target.z);
        playerLight.diffuse.copyFrom(srgb(LIGHT.playerColor));
        playerLight.range = LIGHT.playerRange;
        playerLight.intensity =
          LIGHT.playerIntensity * pulse(time, LIGHT.playerPulse, LIGHT.playerPulseSpeed);
      }

      // Shadows.
      if (SHADOW.mapSize !== shadowSize) buildShadows();
      assign(moon, "shadowEnabled", on && SHADOW.enabled);
      if (shadows) {
        assign(shadows, "usePercentageCloserFiltering", SHADOW.filter === "pcf");
        assign(shadows, "useContactHardeningShadow", SHADOW.filter === "pcss");
        assign(
          shadows,
          "filteringQuality",
          FILTER_QUALITY[SHADOW.quality as keyof typeof FILTER_QUALITY],
        );
        assign(shadows, "bias", SHADOW.bias);
        assign(shadows, "normalBias", SHADOW.normalBias);
        shadows.setDarkness(SHADOW.darkness);
      }

      // Fog. The background is the fog color (in the linear space PBR fogs in), so the floor's
      // far edge has no seam.
      const fogOn = on && FOG.enabled;
      assign(scene, "fogEnabled", fogOn);
      if (fogOn) {
        scene.fogMode = Scene.FOGMODE_EXP2;
        scene.fogDensity = FOG.density;
        scene.fogColor.copyFrom(srgb(FOG.color));
        const linear = scene.fogColor.toLinearSpace();
        scene.clearColor.set(linear.r, linear.g, linear.b, 1);
      } else {
        scene.clearColor.copyFrom(FLAT_CLEAR);
      }
      heightFog.density = FOG.heightDensity;
      heightFog.base = FOG.heightBase;
      heightFog.falloff = FOG.heightFalloff;

      applyPost(on && POST.enabled);
    },

    dispose(): void {
      scene.onActiveCameraChanged.remove(cameraObserver);
      pipeline.dispose();
      ssao.dispose();
      shadows?.dispose();
      overlayLayer.dispose();
      for (const light of [ambient, moon, playerLight]) light.dispose();
    },
  };
}
