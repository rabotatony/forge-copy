/**
 * ai-detector.ts — self-contained AI-content detector for Forge.
 *
 * FORGE INTEGRATION: Run this as a workflow step on uploaded projects.
 * It analyzes text files (.ts, .tsx, .md, etc.) and reports whether
 * the content looks AI-generated.
 *
 * This is a unique capability for a CI/CD platform: detecting
 * AI-generated content as part of the build pipeline.
 */

export interface AIDetectionResult {
  score: number;          // 0-1, higher = more AI-like
  verdict: "ai_likely" | "human_likely" | "uncertain";
  signals: string[];      // what triggered the detection
}

// AI lexical cliches (English)
const EN_CLICHES = [
  "delve", "tapestry", "navigate the", "unlock", "unleash", "elevate",
  "seamless", "robust", "leverage", "foster", "underscore", "pivotal",
  "realm", "landscape", "in today's fast-paced", "it's worth noting",
  "furthermore", "moreover", "additionally", "a testament to",
  "sheds light", "embark on a journey", "harness", "cutting-edge",
  "game-changer", "streamline", "holistic", "paradigm",
];

// AI contrast constructions ("not just X, but Y")
const CONTRAST_PATTERN = /not\s+(?:just|only|merely|simply)\s+[^,.]{2,40}?\s+but/gi;

/**
 * Detect AI patterns in text content.
 */
export function detectAIText(text: string): AIDetectionResult {
  if (!text || text.length < 50) {
    return { score: 0, verdict: "uncertain", signals: [] };
  }

  const signals: string[] = [];
  let score = 0;

  // Check for lexical cliches
  const lowerText = text.toLowerCase();
  const clicheCount = EN_CLICHES.filter((c) => lowerText.includes(c)).length;
  if (clicheCount >= 3) {
    signals.push(`lexical_cliches: ${clicheCount} AI-typical phrases`);
    score += Math.min(0.4, clicheCount * 0.08);
  }

  // Check for contrast constructions
  const contrastMatches = text.match(CONTRAST_PATTERN);
  const contrastCount = contrastMatches ? contrastMatches.length : 0;
  if (contrastCount >= 2) {
    signals.push(`contrast_constructions: ${contrastCount} "not just X but Y"`);
    score += Math.min(0.3, contrastCount * 0.1);
  }

  // Check for excessive em-dashes (AI signature)
  const emDashCount = (text.match(/—/g) || []).length;
  const words = text.split(/\s+/).length;
  if (words > 0 && emDashCount / words > 0.02) {
    signals.push(`em_dash_density: ${(emDashCount / words * 100).toFixed(1)}%`);
    score += 0.2;
  }

  // Clamp score to 0-1
  score = Math.min(1, Math.max(0, score));

  // Determine verdict
  let verdict: AIDetectionResult["verdict"];
  if (score >= 0.5) verdict = "ai_likely";
  else if (score >= 0.25) verdict = "uncertain";
  else verdict = "human_likely";

  return { score, verdict, signals };
}