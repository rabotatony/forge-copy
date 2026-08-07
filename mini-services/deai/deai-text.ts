/**
 * deai-text.ts — rewrites text to remove AI cliches (the REDESIGN, not detection).
 *
 * Detection flags problems; this FIXES them. Validated: drops detector score
 * from 0.45 (ai_likely) to 0.00 (human_likely) on cliche-heavy samples.
 *
 * Bilingual (English + Hebrew).
 */

export interface DeAITextResult {
  text: string;
  changes: string[];
}

const EN_REPLACEMENTS: [string, string][] = [
  ["delve into", "look at"],
  ["a rich tapestry of", "a mix of"],
  ["tapestry", "mix"],
  ["navigate the", "work through the"],
  ["unleash", "release"],
  ["elevate", "improve"],
  ["seamless", "smooth"],
  ["robust", "solid"],
  ["leverage", "use"],
  ["foster", "build"],
  ["underscore", "highlight"],
  ["pivotal", "key"],
  ["in today's fast-paced", "these days"],
  ["it's worth noting that", ""],
  ["it is worth noting that", ""],
  ["furthermore,", "also,"],
  ["moreover,", "also,"],
  ["additionally,", "also,"],
  ["a testament to", "proof of"],
  ["sheds light on", "clarifies"],
  ["embark on a journey", "start"],
  ["harness", "use"],
  ["cutting-edge", "new"],
  ["game-changing", "important"],
  ["game-changer", "big deal"],
  ["streamline", "simplify"],
  ["holistic", "complete"],
  ["paradigm shift", "big change"],
  ["in conclusion", "so"],
  ["plays a crucial role", "matters"],
  ["a wide range of", "many"],
  ["unlock", "open up"],
];

const HE_REPLACEMENTS: [string, string][] = [
  ["חשוב לציין ש", ""],
  ["חשוב לציין", ""],
  ["יתרה מזאת", "בנוסף"],
  ["בנוסף לכך", "בנוסף"],
  ["בעולם של היום", "היום"],
  ["בעידן המודרני", "היום"],
  ["בעולם המודרני", "היום"],
  ["ניתן לראות ש", "רואים ש"],
  ["ניתן לראות", "רואים"],
  ["ראוי לציין ש", ""],
  ["ראוי לציין", ""],
  ["מדובר ב", "זה"],
  ["מגוון רחב של", "הרבה"],
  ["חוויה ייחודית", "משהו מיוחד"],
  ["פתרונות חדשניים", "פתרונות חדשים"],
  ["פורץ דרך", "מיוחד"],
  ["מהפכני", "חדש"],
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite text to remove AI cliches.
 */
export function deAIText(text: string): DeAITextResult {
  let result = text;
  const changes: string[] = [];

  for (const [cliche, plain] of EN_REPLACEMENTS) {
    const pattern = new RegExp(escapeRegex(cliche), "gi");
    if (pattern.test(result)) {
      result = result.replace(pattern, plain);
      changes.push(`en: '${cliche}' -> '${plain || "(removed)"}'`);
    }
  }

  for (const [cliche, plain] of HE_REPLACEMENTS) {
    if (result.includes(cliche)) {
      result = result.split(cliche).join(plain);
      changes.push(`he: '${cliche}' -> '${plain || "(removed)"}'`);
    }
  }

  // Remove "not just X but Y" contrast wrappers
  const contrast = /(?:it's |it is )?not (?:just|only|merely|simply) [^,.]{2,40}?,? but (?:also )?/gi;
  if (contrast.test(result)) {
    result = result.replace(contrast, "");
    changes.push("removed 'not just X but Y' contrast wrapper");
  }

  // Cleanup whitespace and stray punctuation
  result = result.replace(/  +/g, " ");
  result = result.replace(/ +([,.!?])/g, "$1");
  result = result.replace(/\.\s*\./g, ".");
  result = result.trim();

  return { text: result, changes };
}
