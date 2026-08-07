/**
 * image-ai-detector.ts (v2) — detects AI-generated images from ACTUAL bytes.
 *
 * v2 improvement: v1 required pre-parsed metadata (ImageInfo). v2 analyzes
 * the actual image bytes, so it works on raw uploaded files.
 *
 * Detects 4 AI signatures from bytes:
 *   1. Missing EXIF camera data (AI images have no camera metadata)
 *   2. AI-tool markers in file metadata (DALL-E, Midjourney, Stable Diffusion)
 *   3. PNG tEXt chunks with prompt/parameters (common in AI outputs)
 *   4. AI-typical dimensions (512/768/1024 squares)
 */

export interface ImageDetectionResult {
  score: number;
  verdict: "ai_likely" | "human_likely" | "uncertain";
  signals: string[];
}

// AI-tool markers to search for in file bytes
const AI_MARKERS = [
  "dall-e", "dalle", "openai", "midjourney", "stable diffusion",
  "stability", "sdxl", "comfyui", "automatic1111", "novelai",
  "firefly", "dreamstudio", "prompt", "parameters", "negative prompt",
  "cfg scale", "sampler", "checkpoint",
];

const AI_DIMENSIONS = [
  [512, 512], [768, 768], [1024, 1024],
  [512, 768], [768, 512], [1024, 1536], [1536, 1024],
];

/** Convert bytes to a lowercase string for marker scanning (latin1-safe). */
function bytesToString(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    // Keep printable ASCII, replace others with space
    out += b >= 32 && b < 127 ? String.fromCharCode(b) : " ";
  }
  return out.toLowerCase();
}

/** Check for EXIF marker in JPEG (APP1 segment with "Exif" header). */
function hasExif(bytes: Uint8Array): boolean {
  // JPEG starts with FFD8. APP1 marker is FFE1, followed by "Exif".
  if (bytes.length < 4) return false;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false; // not JPEG
  const str = bytesToString(bytes.slice(0, Math.min(bytes.length, 65536)));
  return str.includes("exif");
}

/** Read PNG dimensions (IHDR chunk). */
function readPngDimensions(bytes: Uint8Array): { w: number; h: number } | null {
  // PNG signature + IHDR: width at bytes 16-19, height at 20-23 (big-endian)
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  return { w, h };
}

/**
 * Detect AI signatures in image bytes.
 */
export function detectAIImageBytes(bytes: Uint8Array): ImageDetectionResult {
  if (!bytes || bytes.length < 64) {
    return { score: 0, verdict: "uncertain", signals: [] };
  }

  const signals: string[] = [];
  let score = 0;

  // 1. Scan for AI-tool markers
  const content = bytesToString(bytes);
  const foundMarkers = AI_MARKERS.filter((m) => content.includes(m));
  if (foundMarkers.length > 0) {
    signals.push(`ai_markers: ${foundMarkers.slice(0, 3).join(", ")}`);
    score += 0.5;
  }

  // 2. Missing EXIF (JPEG without camera data)
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (isJpeg && !hasExif(bytes)) {
    signals.push("missing_exif_camera");
    score += 0.25;
  }

  // 3. AI-typical dimensions (PNG)
  const dims = readPngDimensions(bytes);
  if (dims) {
    const isTypical = AI_DIMENSIONS.some(([w, h]) => dims.w === w && dims.h === h);
    if (isTypical) {
      signals.push(`ai_dimensions: ${dims.w}x${dims.h}`);
      score += 0.15;
    }
  }

  score = Math.min(1, Math.max(0, score));
  const verdict: ImageDetectionResult["verdict"] =
    score >= 0.5 ? "ai_likely" : score >= 0.25 ? "uncertain" : "human_likely";
  return { score, verdict, signals };
}