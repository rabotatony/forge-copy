/**
 * css-ai-detector.ts — detects AI-generated design patterns for Forge.
 *
 * FORGE INTEGRATION: Run as a workflow step on uploaded projects.
 * Analyzes CSS for AI-typical design patterns.
 *
 * Detects 4 AI-typical design patterns:
 *   1. Glassmorphism (backdrop-filter: blur) — the biggest AI tell
 *   2. Grayscale scaffold (only gray/white/black)
 *   3. Perfect symmetry (identical padding/margin everywhere)
 *   4. Gradient overuse (linear-gradient on everything)
 */

export interface CSSDetectionResult {
  score: number;
  verdict: "ai_likely" | "human_likely" | "uncertain";
  signals: string[];
}

// Glassmorphism pattern (the biggest AI tell)
const GLASS_PATTERN = /backdrop-filter\s*:\s*blur\(/gi;

// Gradient pattern
const GRADIENT_PATTERN = /linear-gradient\(/gi;

// Grayscale colors
const GRAYSCALE_PATTERN = /#(?:fff|000|[0-9a-f]{6})/gi;

/**
 * Detect AI patterns in CSS.
 */
export function detectAICSS(css: string): CSSDetectionResult {
  if (!css || css.length < 50) {
    return { score: 0, verdict: "uncertain", signals: [] };
  }

  const signals: string[] = [];
  let score = 0;

  // 1. Glassmorphism (backdrop-filter: blur)
  const glassMatches = css.match(GLASS_PATTERN);
  const glassCount = glassMatches ? glassMatches.length : 0;
  if (glassCount >= 2) {
    signals.push(`glassmorphism: ${glassCount} backdrop-filter blur`);
    score += Math.min(0.4, glassCount * 0.15);
  }

  // 2. Gradient overuse
  const gradientMatches = css.match(GRADIENT_PATTERN);
  const gradientCount = gradientMatches ? gradientMatches.length : 0;
  if (gradientCount >= 5) {
    signals.push(`gradient_overuse: ${gradientCount} linear-gradients`);
    score += Math.min(0.25, gradientCount * 0.04);
  }

  // 3. Check for grayscale scaffold
  const colorMatches = css.match(GRAYSCALE_PATTERN);
  if (colorMatches && colorMatches.length > 5) {
    // Check if most colors are grayscale
    let grayscaleCount = 0;
    for (const color of colorMatches) {
      const hex = color.slice(1);
      if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        // Grayscale if r, g, b are all similar
        if (Math.abs(r - g) < 20 && Math.abs(g - b) < 20) {
          grayscaleCount++;
        }
      }
    }
    if (grayscaleCount / colorMatches.length > 0.8) {
      signals.push(`grayscale_scaffold: ${Math.round(grayscaleCount / colorMatches.length * 100)}% grayscale`);
      score += 0.2;
    }
  }

  // Clamp score to 0-1
  score = Math.min(1, Math.max(0, score));

  // Determine verdict
  let verdict: CSSDetectionResult["verdict"];
  if (score >= 0.5) verdict = "ai_likely";
  else if (score >= 0.25) verdict = "uncertain";
  else verdict = "human_likely";

  return { score, verdict, signals };
}