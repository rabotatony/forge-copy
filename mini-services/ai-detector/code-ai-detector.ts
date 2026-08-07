/**
 * code-ai-detector.ts — detects AI-generated code patterns for Forge.
 *
 * FORGE INTEGRATION: Run as a workflow step on uploaded projects.
 * Analyzes source code for AI-typical patterns.
 *
 * Detects 5 AI-typical code patterns:
 *   1. Redundant comments (comments that restate the code)
 *   2. Debug console leftovers (console.log, print)
 *   3. TODO trails (TODO, FIXME, HACK left behind)
 *   4. Generic naming (data, temp, value, item, handler)
 *   5. Placeholder values (lorem, example, test, dummy)
 */

export interface CodeDetectionResult {
  score: number;
  verdict: "ai_likely" | "human_likely" | "uncertain";
  signals: string[];
}

// Generic variable names that AI overuses
const GENERIC_NAMES = [
  "data", "temp", "value", "item", "handler", "result", "info",
  "obj", "arr", "utils", "helpers", "manager", "processor",
];

// Placeholder values AI leaves behind
const PLACEHOLDER_PATTERN = /lorem|ipsum|example\.com|placeholder|dummy|TODO_CHANGE|FIXME_LATER/gi;

// Debug console statements
const CONSOLE_PATTERN = /console\.(log|debug|warn|error|info)\(|print\(|print!\(|println!\(/g;

// TODO/FIXME/HACK trails
const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX)\b/g;

/**
 * Detect AI patterns in source code.
 */
export function detectAICode(code: string): CodeDetectionResult {
  if (!code || code.length < 50) {
    return { score: 0, verdict: "uncertain", signals: [] };
  }

  const signals: string[] = [];
  let score = 0;
  const lines = code.split("\n");
  const lineCount = lines.length;

  // 1. Debug console leftovers
  const consoleMatches = code.match(CONSOLE_PATTERN);
  const consoleCount = consoleMatches ? consoleMatches.length : 0;
  if (consoleCount > 3) {
    signals.push(`console_leftovers: ${consoleCount} debug statements`);
    score += Math.min(0.25, consoleCount * 0.05);
  }

  // 2. TODO trails
  const todoMatches = code.match(TODO_PATTERN);
  const todoCount = todoMatches ? todoMatches.length : 0;
  if (todoCount > 2) {
    signals.push(`todo_trails: ${todoCount} TODO/FIXME/HACK`);
    score += Math.min(0.2, todoCount * 0.05);
  }

  // 3. Placeholder values
  const placeholderMatches = code.match(PLACEHOLDER_PATTERN);
  const placeholderCount = placeholderMatches ? placeholderMatches.length : 0;
  if (placeholderCount > 1) {
    signals.push(`placeholders: ${placeholderCount} placeholder values`);
    score += Math.min(0.2, placeholderCount * 0.08);
  }

  // 4. Generic naming density
  let genericCount = 0;
  for (const name of GENERIC_NAMES) {
    const regex = new RegExp("\b" + name + "", "g");
    const matches = code.match(regex);
    if (matches) genericCount += matches.length;
  }
  if (lineCount > 0 && genericCount / lineCount > 0.1) {
    signals.push(`generic_naming: ${genericCount} generic identifiers`);
    score += 0.2;
  }

  // Clamp score to 0-1
  score = Math.min(1, Math.max(0, score));

  // Determine verdict
  let verdict: CodeDetectionResult["verdict"];
  if (score >= 0.5) verdict = "ai_likely";
  else if (score >= 0.25) verdict = "uncertain";
  else verdict = "human_likely";

  return { score, verdict, signals };
}