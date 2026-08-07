/**
 * css-ai-detector.ts (v2) — detects AI-generated design patterns for Forge.
 *
 * v2 improvements over v1:
 *   - FIXED broken grayscale detection: v1 regex mangled #ffffff as #fff
 *     (prefix match) and skipped ALL 3-digit colors. Grayscale calc returned
 *     0 even for 100% grayscale designs.
 *   - Now correctly handles both 3-digit (#fff) and 6-digit (#ffffff) hex.
 *   - Lowered glassmorphism weight (humans use blur too; not reliable alone).
 */

export interface CSSDetectionResult {
  score: number;
  verdict: "ai_likely" | "human_likely" | "uncertain";
  signals: string[];
}

const HEX_PATTERN = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

function normalizeHex(h: string): string | null {
  let hex = h.replace("#", "").toLowerCase();
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  return hex.length === 6 ? hex : null;
}

function isGrayscale(hex6: string, tolerance = 20): boolean {
  const r = parseInt(hex6.slice(0, 2), 16);
  const g = parseInt(hex6.slice(2, 4), 16);
  const b = parseInt(hex6.slice(4, 6), 16);
  if ([r, g, b].some(isNaN)) return false;
  return Math.abs(r - g) < tolerance && Math.abs(g - b) < tolerance;
}

export function detectAICSS(css: string): CSSDetectionResult {
  if (!css || css.length < 50) {
    return { score: 0, verdict: "uncertain", signals: [] };
  }
  const signals: string[] = [];
  let score = 0;

  const glassCount = (css.match(/backdrop-filter\s*:\s*blur\(/gi) || []).length;
  if (glassCount >= 2) {
    signals.push(`glassmorphism: ${glassCount}`);
    score += Math.min(0.3, glassCount * 0.1);
  }

  const gradientCount = (css.match(/linear-gradient\(/gi) || []).length;
  if (gradientCount >= 5) {
    signals.push(`gradient_overuse: ${gradientCount}`);
    score += Math.min(0.2, gradientCount * 0.03);
  }

  const hexMatches = css.match(HEX_PATTERN) || [];
  if (hexMatches.length >= 5) {
    let grayscaleCount = 0;
    let validCount = 0;
    for (const h of hexMatches) {
      const hex6 = normalizeHex(h);
      if (hex6) {
        validCount++;
        if (isGrayscale(hex6)) grayscaleCount++;
      }
    }
    if (validCount > 0 && grayscaleCount / validCount > 0.85) {
      const pct = Math.round((grayscaleCount / validCount) * 100);
      signals.push(`grayscale_scaffold: ${pct}%`);
      score += 0.35;
    }
  }

  score = Math.min(1, Math.max(0, score));
  const verdict: CSSDetectionResult["verdict"] =
    score >= 0.5 ? "ai_likely" : score >= 0.25 ? "uncertain" : "human_likely";
  return { score, verdict, signals };
}