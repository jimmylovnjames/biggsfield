import type { VideoMode } from "./types";

// Prices from https://docs.x.ai/developers/models (Imagine Pricing). Used for
// estimates only; the real charge comes back in `usage.cost_in_usd_ticks`.

export interface ImageModel {
  id: string;
  label: string;
  note: string;
  pricePerImage: number;
  supportsQuality: boolean;
}

export const IMAGE_MODELS: ImageModel[] = [
  { id: "grok-imagine-image-2.0", label: "Imagine Image 2.0", note: "Latest · best prompt following", pricePerImage: 0.04, supportsQuality: true },
  { id: "grok-imagine-image-quality", label: "Imagine Image Quality", note: "Highest fidelity", pricePerImage: 0.05, supportsQuality: false },
  { id: "grok-imagine-image", label: "Imagine Image", note: "Classic · cheapest", pricePerImage: 0.02, supportsQuality: false },
];

export const IMAGE_ASPECTS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "21:9", "5:2", "19.5:9", "9:19.5", "20:9", "9:20"];
export const IMAGE_RESOLUTIONS = ["1k", "2k"];
export const IMAGE_QUALITIES = ["auto", "low", "medium"];
export const MAX_IMAGE_INPUTS = 5;

export interface VideoModel {
  id: string;
  label: string;
  note: string;
  pricePerSecond: number;
  modes: VideoMode[];
  resolutions: string[];
  maxReferenceImages: number;
  /** Reference-to-video duration/resolution caps differ from plain generation. */
  referenceMaxDuration: number;
  referenceResolutions: string[];
  voices: boolean;
}

// Capability matrix from https://docs.x.ai/developers/model-capabilities/video/overview
export const VIDEO_MODELS: VideoModel[] = [
  {
    id: "grok-imagine-video-1.5",
    label: "Imagine Video 1.5",
    note: "Native 1080p · lip-synced speech",
    pricePerSecond: 0.08,
    modes: ["text", "image", "frames", "reference"],
    resolutions: ["480p", "720p", "1080p"],
    maxReferenceImages: 14,
    referenceMaxDuration: 15,
    referenceResolutions: ["480p", "720p"],
    voices: true,
  },
  {
    id: "grok-imagine-video-1.5-lite",
    label: "Imagine Video 1.5 Lite",
    note: "Cheapest · 1080p upscaled",
    pricePerSecond: 0.02,
    modes: ["text", "image"],
    resolutions: ["480p", "720p", "1080p"],
    maxReferenceImages: 0,
    referenceMaxDuration: 0,
    referenceResolutions: [],
    voices: false,
  },
  {
    id: "grok-imagine-video",
    label: "Imagine Video",
    note: "Classic · edit & extend",
    pricePerSecond: 0.05,
    modes: ["text", "image", "reference", "edit", "extend"],
    resolutions: ["480p", "720p"],
    maxReferenceImages: 7,
    referenceMaxDuration: 10,
    referenceResolutions: ["480p", "720p"],
    voices: false,
  },
];

export const VIDEO_ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9", "5:2"];

export const VIDEO_MODES: { id: VideoMode; label: string; hint: string }[] = [
  { id: "text", label: "Text", hint: "Prompt to video" },
  { id: "image", label: "Image", hint: "Animate a still as the first frame" },
  { id: "frames", label: "Frames", hint: "Pin start, end and key frames" },
  { id: "reference", label: "References", hint: "Characters, products, voices" },
  { id: "edit", label: "Edit", hint: "Change an existing clip (≤ 8.7s)" },
  { id: "extend", label: "Extend", hint: "Continue a clip from its last frame" },
];

export const VIDEO_LIMITS = {
  minDuration: 1,
  maxDuration: 15,
  defaultDuration: 8,
  editMaxSource: 8.7,
  extendMinSource: 2,
  extendMaxSource: 15,
  extendMin: 2,
  extendMax: 10,
  extendDefault: 6,
  maxKeyframes: 4,
  maxVoices: 3,
};

// Preset voices share the TTS roster; unknown ids come back as a 400 listing valid ones.
export const VOICES = ["eve", "ara", "leo", "rex", "sal"];

export interface Preset {
  id: string;
  label: string;
  prompt: string;
  /** CSS animation class used for the preview tile. */
  anim?: string;
  hue?: number;
}

export const CAMERA_MOTIONS: Preset[] = [
  { id: "dolly-in", label: "Dolly In", anim: "a-zoom-in", hue: 200, prompt: "Camera: smooth slow dolly in toward the subject, stabilized, steadily tightening the frame." },
  { id: "dolly-out", label: "Dolly Out", anim: "a-zoom-out", hue: 210, prompt: "Camera: smooth dolly out away from the subject, revealing the wider environment." },
  { id: "crash-zoom-in", label: "Crash Zoom In", anim: "a-crash-in", hue: 0, prompt: "Camera: sudden fast crash zoom in onto the subject's face, punchy and dramatic." },
  { id: "crash-zoom-out", label: "Crash Zoom Out", anim: "a-crash-out", hue: 15, prompt: "Camera: sudden fast crash zoom out from close-up to an extreme wide shot." },
  { id: "dolly-zoom", label: "Dolly Zoom", anim: "a-vertigo", hue: 280, prompt: "Camera: vertigo dolly zoom; the subject stays the same size while the background stretches and warps." },
  { id: "orbit", label: "360 Orbit", anim: "a-orbit", hue: 160, prompt: "Camera: continuous 360-degree orbit around the subject at eye level, subject stays centered." },
  { id: "arc-left", label: "Arc Left", anim: "a-arc-left", hue: 140, prompt: "Camera: smooth arcing move to the left around the subject." },
  { id: "arc-right", label: "Arc Right", anim: "a-arc-right", hue: 120, prompt: "Camera: smooth arcing move to the right around the subject." },
  { id: "crane-up", label: "Crane Up", anim: "a-rise", hue: 45, prompt: "Camera: crane shot rising up and over the subject, revealing the scene from above." },
  { id: "crane-down", label: "Crane Down", anim: "a-fall", hue: 35, prompt: "Camera: crane shot descending from high above down to eye level with the subject." },
  { id: "fpv-drone", label: "FPV Drone", anim: "a-fpv", hue: 190, prompt: "Camera: fast FPV drone flight, swooping and banking through the scene with fluid momentum." },
  { id: "bullet-time", label: "Bullet Time", anim: "a-orbit", hue: 300, prompt: "Camera: bullet-time effect; action frozen in extreme slow motion while the camera sweeps around the subject." },
  { id: "whip-pan", label: "Whip Pan", anim: "a-whip", hue: 330, prompt: "Camera: fast whip pan with motion blur, snapping to the subject." },
  { id: "handheld", label: "Handheld", anim: "a-shake", hue: 25, prompt: "Camera: handheld documentary style, natural subtle shake, following the action." },
  { id: "tracking", label: "Tracking Shot", anim: "a-pan-left", hue: 90, prompt: "Camera: lateral tracking shot moving alongside the subject at matching speed." },
  { id: "pan-left", label: "Pan Left", anim: "a-pan-left", hue: 230, prompt: "Camera: slow steady pan to the left." },
  { id: "pan-right", label: "Pan Right", anim: "a-pan-right", hue: 240, prompt: "Camera: slow steady pan to the right." },
  { id: "tilt-up", label: "Tilt Up", anim: "a-rise", hue: 60, prompt: "Camera: slow tilt up from the ground to the subject's face." },
  { id: "tilt-down", label: "Tilt Down", anim: "a-fall", hue: 70, prompt: "Camera: slow tilt down from the sky to the subject." },
  { id: "snorricam", label: "Snorricam", anim: "a-shake", hue: 350, prompt: "Camera: snorricam rig fixed to the subject's body; the subject stays locked in frame while the world moves around them." },
  { id: "overhead", label: "Top Down", anim: "a-spin", hue: 260, prompt: "Camera: overhead top-down bird's-eye shot, slowly rotating." },
  { id: "low-angle", label: "Low Angle Hero", anim: "a-rise", hue: 20, prompt: "Camera: low-angle hero shot looking up at the subject, slowly pushing in." },
  { id: "through", label: "Through Object", anim: "a-crash-in", hue: 175, prompt: "Camera: pushes forward through a gap in a foreground object to reveal the subject." },
  { id: "hyperlapse", label: "Hyperlapse", anim: "a-fpv", hue: 210, prompt: "Camera: hyperlapse moving forward through the scene, time accelerated, light trails streaking." },
  { id: "static", label: "Locked Off", anim: "", hue: 0, prompt: "Camera: static locked-off tripod shot, no camera movement." },
];

export const VIDEO_EFFECTS: Preset[] = [
  { id: "slow-mo", label: "Slow Motion", hue: 200, prompt: "Dramatic high-frame-rate slow motion." },
  { id: "disintegrate", label: "Disintegrate", hue: 20, prompt: "The subject disintegrates into drifting particles of dust and embers." },
  { id: "levitate", label: "Levitate", hue: 260, prompt: "The subject slowly levitates off the ground, weightless." },
  { id: "on-fire", label: "Set on Fire", hue: 10, prompt: "Flames erupt and engulf the scene, realistic fire and heat haze." },
  { id: "freeze", label: "Freeze", hue: 190, prompt: "Frost spreads rapidly and the subject freezes into ice." },
  { id: "melt", label: "Melt", hue: 40, prompt: "The subject melts like liquid wax, dripping downward." },
  { id: "glitch", label: "Glitch", hue: 300, prompt: "Digital glitch distortion, RGB split and datamosh artifacts." },
  { id: "paparazzi", label: "Paparazzi", hue: 55, prompt: "Bursts of paparazzi camera flashes strobe across the subject." },
  { id: "explosion", label: "Explosion", hue: 25, prompt: "A cinematic explosion bursts behind the subject, debris flying." },
  { id: "rain", label: "Heavy Rain", hue: 215, prompt: "Heavy rain pours down, wet reflective surfaces, droplets on the lens." },
  { id: "neon", label: "Neon Glow", hue: 320, prompt: "Neon lights flicker on, saturated magenta and cyan glow." },
  { id: "morph", label: "Morph", hue: 150, prompt: "The subject smoothly morphs and transforms into a new form." },
  { id: "turn-metal", label: "Turn to Metal", hue: 220, prompt: "The subject's surface turns into polished liquid chrome." },
  { id: "petals", label: "Petals", hue: 340, prompt: "A swirl of flower petals blows through the frame." },
];

export const IMAGE_STYLES: Preset[] = [
  { id: "cinematic", label: "Cinematic", hue: 30, prompt: "cinematic film still, anamorphic lens, dramatic lighting, shallow depth of field, color graded" },
  { id: "photoreal", label: "Photoreal", hue: 200, prompt: "ultra-realistic photograph, natural lighting, sharp detail, 50mm lens" },
  { id: "editorial", label: "Fashion Editorial", hue: 330, prompt: "high-fashion editorial photo, studio strobe lighting, magazine cover quality" },
  { id: "film-35mm", label: "35mm Film", hue: 40, prompt: "shot on 35mm film, Kodak Portra 400, grain, soft highlights" },
  { id: "noir", label: "Film Noir", hue: 0, prompt: "black and white film noir, hard shadows, venetian blind light, smoky atmosphere" },
  { id: "product", label: "Product Shot", hue: 180, prompt: "premium product photography, seamless backdrop, softbox lighting, crisp reflections" },
  { id: "portrait", label: "Studio Portrait", hue: 20, prompt: "studio portrait, Rembrandt lighting, 85mm lens, detailed skin texture" },
  { id: "anime", label: "Anime", hue: 280, prompt: "anime key visual, cel shading, vibrant colors, detailed background" },
  { id: "3d", label: "3D Render", hue: 260, prompt: "3D render, octane, global illumination, subsurface scattering, clean materials" },
  { id: "cyberpunk", label: "Cyberpunk", hue: 300, prompt: "cyberpunk, neon-lit rainy streets, magenta and cyan, volumetric haze" },
  { id: "watercolor", label: "Watercolor", hue: 150, prompt: "delicate watercolor painting, soft washes, paper texture" },
  { id: "oil", label: "Oil Painting", hue: 35, prompt: "classical oil painting, visible brush strokes, rich chiaroscuro" },
  { id: "polaroid", label: "Polaroid", hue: 50, prompt: "vintage polaroid photo, faded colors, light leaks, white border" },
  { id: "pixel", label: "Pixel Art", hue: 110, prompt: "16-bit pixel art, limited palette, crisp pixels" },
  { id: "claymation", label: "Claymation", hue: 15, prompt: "claymation stop-motion style, handmade clay textures, miniature set" },
];

export function findPreset(list: Preset[], id?: string): Preset | undefined {
  return id ? list.find((p) => p.id === id) : undefined;
}

export function composeImagePrompt(prompt: string, styleId?: string): string {
  const style = findPreset(IMAGE_STYLES, styleId);
  const base = prompt.trim();
  if (!style) return base;
  return base ? `${base.replace(/[.\s]+$/, "")}. Style: ${style.prompt}` : style.prompt;
}

export function composeVideoPrompt(prompt: string, cameraId?: string, effectId?: string): string {
  const parts = [prompt.trim()];
  const camera = findPreset(CAMERA_MOTIONS, cameraId);
  const effect = findPreset(VIDEO_EFFECTS, effectId);
  if (effect) parts.push(effect.prompt);
  if (camera) parts.push(camera.prompt);
  return parts.filter(Boolean).join(" ").trim();
}

export function videoModel(id: string): VideoModel | undefined {
  return VIDEO_MODELS.find((m) => m.id === id);
}

export function imageModel(id: string): ImageModel | undefined {
  return IMAGE_MODELS.find((m) => m.id === id);
}
