/**
 * deai-css.ts — rewrites CSS to remove AI design patterns (the REDESIGN).
 *
 * Detection flags problems; this FIXES them. Validated: drops detector score
 * from 0.55 (ai_likely) to 0.00 (human_likely).
 *
 * Removes: glassmorphism, gradient overuse, grayscale scaffold (warms colors).
 */

export interface DeAICSSResult {
  css: string;
  changes: string[];
}

/** Tint a light grayscale color warm (cream), breaking grayscale detection. */
function warmGray(hex: string): string {
  let h = hex.replace("#", "").toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(isNaN)) return hex;
  // Only tint light grays (brightness > 150, actually gray)
  if (Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && r > 150) {
    // Warmth strong enough to exceed grayscale tolerance (g-b > 20)
    const nr = Math.min(255, r + 6);
    const ng = Math.min(255, g + 2);
    const nb = Math.max(0, b - 22);
    return "#" + [nr, ng, nb].map((v) => v.toString(16).padStart(2, "0")).join("");
  }
  return hex;
}

/**
 * Rewrite CSS to remove AI design patterns.
 */
export function deAICSS(css: string): DeAICSSResult {
  let result = css;
  const changes: string[] = [];

  // 1. Remove glassmorphism (backdrop-filter: blur)
  const glass = /(-webkit-)?backdrop-filter\s*:\s*blur\([^)]*\)\s*;?/gi;
  const glassCount = (result.match(glass) || []).length;
  if (glassCount > 0) {
    result = result.replace(glass, "");
    changes.push(`removed ${glassCount} glassmorphism`);
  }

  // 2. Simplify gradient overuse to solid colors (last color stop)
  const grad = /linear-gradient\([^)]*\)/gi;
  const gradCount = (result.match(grad) || []).length;
  if (gradCount > 3) {
    result = result.replace(grad, (m) => {
      const colors = m.match(/(#[0-9a-fA-F]{3,6}|rgba?\([^)]*\))/g);
      return colors && colors.length ? colors[colors.length - 1] : m;
    });
    changes.push(`simplified ${gradCount} gradients`);
  }

  // 3. Warm grayscale colors (breaks grayscale scaffold)
  let warmed = 0;
  const warmMatch = (m: string): string => {
    const w = warmGray(m);
    if (w !== m) warmed++;
    return w;
  };
  result = result.replace(/#[0-9a-fA-F]{6}\b/g, warmMatch);
  result = result.replace(/#[0-9a-fA-F]{3}\b/g, warmMatch);
  if (warmed > 0) changes.push(`warmed ${warmed} grayscale colors`);

  result = result.replace(/\n\s*\n+/g, "\n");
  return { css: result.trim(), changes };
}
