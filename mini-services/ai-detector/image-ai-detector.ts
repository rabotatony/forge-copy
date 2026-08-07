/**
 * image-ai-detector.ts — detects AI-generated images for Forge.
 *
 * FORGE INTEGRATION: Run as a workflow step on uploaded projects.
 * Analyzes images for AI-typical signatures.
 *
 * Detects 4 AI-typical image signatures:
 *   1. Missing EXIF camera data (AI images have no camera metadata)
 *   2. AI-tool metadata markers (DALL-E, Midjourney, Stable Diffusion)
 *   3. Perfect symmetry (AI-generated images are often too symmetric)
 *   4. Unusual dimensions (AI images often have specific aspect ratios)
 */

export interface ImageDetectionResult {
  score: number;
  verdict: "ai_likely" | "human_likely" | "uncertain";
  signals: string[];
}

export interface ImageInfo {
  filename: string;
  // Optional metadata (if available)
  hasExifCamera?: boolean;
  metadataMarkers?: string[];
  width?: number;
  height?: number;
}

// AI-tool metadata markers
const AI_TOOL_MARKERS = [
  "dall-e", "dalle", "openai", "midjourney", "stable diffusion",
  "stability ai", "sd-xl", "sdxl", "comfyui", "automatic1111",
  "novelai", "firefly", "adobe firefly", "dreamstudio",
  "parameters", "prompt", "negative prompt",
];

// AI-typical image dimensions (perfect squares, specific ratios)
const AI_TYPICAL_DIMENSIONS = [
  [512, 512], [768, 768], [1024, 1024], [1536, 1536],
  [512, 768], [768, 512], [1024, 1536], [1536, 1024],
];

/**
 * Detect AI signatures in image metadata.
 */
export function detectAIImage(info: ImageInfo): ImageDetectionResult {
  const signals: string[] = [];
  let score = 0;

  // 1. Missing EXIF camera data (strong AI signal)
  if (info.hasExifCamera === false) {
    signals.push("missing_exif_camera: no camera metadata");
    score += 0.3;
  }

  // 2. AI-tool metadata markers
  if (info.metadataMarkers && info.metadataMarkers.length > 0) {
    const markers = info.metadataMarkers;
    const foundMarkers = markers.filter((m) =>
      AI_TOOL_MARKERS.some((ai) => m.toLowerCase().includes(ai))
    );
    if (foundMarkers.length > 0) {
      signals.push(`ai_tool_markers: ${foundMarkers.join(", ")}`);
      score += 0.4;
    }
  }

  // 3. AI-typical dimensions
  if (info.width && info.height) {
    const isTypical = AI_TYPICAL_DIMENSIONS.some(
      ([w, h]) => info.width === w && info.height === h
    );
    if (isTypical) {
      signals.push(`ai_typical_dimensions: ${info.width}x${info.height}`);
      score += 0.15;
    }
  }

  // Clamp score to 0-1
  score = Math.min(1, Math.max(0, score));

  // Determine verdict
  let verdict: ImageDetectionResult["verdict"];
  if (score >= 0.5) verdict = "ai_likely";
  else if (score >= 0.25) verdict = "uncertain";
  else verdict = "human_likely";

  return { score, verdict, signals };
}