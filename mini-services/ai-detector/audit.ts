/**
 * audit.ts — comprehensive AI-authenticity audit for Forge.
 *
 * FORGE INTEGRATION: The main entry point for AI-detection workflows.
 * Combines all three detectors (text, code, CSS) into one audit.
 *
 * Given a project, it analyzes all relevant files and produces
 * a comprehensive authenticity report.
 */

import { detectAIText, type AIDetectionResult } from "./ai-detector";
import { detectAICode, type CodeDetectionResult } from "./code-ai-detector";
import { detectAICSS, type CSSDetectionResult } from "./css-ai-detector";
import { detectAIImage, type ImageInfo, type ImageDetectionResult } from "./image-ai-detector";

export interface ProjectAuditResult {
  overallScore: number;
  verdict: "ai_likely" | "human_likely" | "mixed" | "uncertain";
  fileResults: FileResult[];
  summary: string;
}

export interface FileResult {
  path: string;
  type: "text" | "code" | "css" | "image";
  score: number;
  verdict: string;
  signals: string[];
}

export interface ProjectFile {
  path: string;
  content: string;
}

/** Determine file type from extension. */
function getFileType(path: string): "text" | "code" | "css" | "image" | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  if (["css", "scss", "sass", "less"].includes(ext)) return "css";
  if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "c", "cpp", "h"].includes(ext)) return "code";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["md", "txt", "rst"].includes(ext)) return "text";
  return null;
}

/**
 * Audit a project for AI-generated content.
 * Analyzes all relevant files and produces a comprehensive report.
 */
export function auditProject(files: ProjectFile[]): ProjectAuditResult {
  const fileResults: FileResult[] = [];
  let totalScore = 0;
  let analyzedCount = 0;

  for (const file of files) {
    const type = getFileType(file.path);
    if (!type) continue;

    // Images require metadata-based analysis (EXIF, markers) — not raw content.
    // Record them for separate handling via detectAIImage.
    if (type === "image") {
      fileResults.push({
        path: file.path,
        type,
        score: 0,
        verdict: "uncertain",
        signals: ["image_requires_metadata: use detectAIImage with EXIF data"],
      });
      continue;
    }

    let result;
    if (type === "css") {
      result = detectAICSS(file.content);
    } else if (type === "code") {
      result = detectAICode(file.content);
    } else {
      result = detectAIText(file.content);
    }

    fileResults.push({
      path: file.path,
      type,
      score: result.score,
      verdict: result.verdict,
      signals: result.signals,
    });

    totalScore += result.score;
    analyzedCount++;
  }

  // Compute overall score
  const overallScore = analyzedCount > 0 ? totalScore / analyzedCount : 0;

  // Determine overall verdict
  let verdict: ProjectAuditResult["verdict"];
  const aiLikelyCount = fileResults.filter((r) => r.verdict === "ai_likely").length;
  const humanLikelyCount = fileResults.filter((r) => r.verdict === "human_likely").length;

  if (aiLikelyCount > analyzedCount * 0.6) verdict = "ai_likely";
  else if (humanLikelyCount > analyzedCount * 0.6) verdict = "human_likely";
  else if (analyzedCount === 0) verdict = "uncertain";
  else verdict = "mixed";

  // Generate summary
  const summary = `Analyzed ${analyzedCount} files. ` +
    `${aiLikelyCount} look AI-generated, ${humanLikelyCount} look human. ` +
    `Overall score: ${overallScore.toFixed(2)}.`;

  return { overallScore, verdict, fileResults, summary };
}