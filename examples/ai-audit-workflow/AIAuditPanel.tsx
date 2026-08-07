// AIAuditPanel.tsx — UI component for the AI-audit capability in Forge.
//
// Displays the AI-authenticity report for an uploaded project.
// Shows overall verdict, per-file results, and signals.

"use client";

import { useState } from "react";

interface FileResult {
  path: string;
  type: "text" | "code" | "css";
  score: number;
  verdict: string;
  signals: string[];
}

interface AuditResult {
  overallScore: number;
  verdict: "ai_likely" | "human_likely" | "mixed" | "uncertain";
  fileResults: FileResult[];
  summary: string;
}

interface AIAuditPanelProps {
  projectId: string;
}

export function AIAuditPanel({ projectId }: AIAuditPanelProps) {
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAudit() {
    setLoading(true);
    setError(null);
    try {
      // Collect files from the project (simplified)
      const response = await fetch(`/api/forge/ai-audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: [], // In production, collect actual project files
          threshold: 0.5,
        }),
      });
      if (!response.ok) throw new Error("Audit failed");
      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const verdictColors: Record<string, string> = {
    ai_likely: "#ef4444",    // red
    human_likely: "#22c55e", // green
    mixed: "#f59e0b",        // amber
    uncertain: "#6b7280",    // gray
  };

  return (
    <div className="ai-audit-panel">
      <div className="ai-audit-header">
        <h3>AI Content Audit</h3>
        <button onClick={runAudit} disabled={loading}>
          {loading ? "Auditing..." : "Run Audit"}
        </button>
      </div>

      {error && <div className="ai-audit-error">{error}</div>}

      {result && (
        <div className="ai-audit-result">
          <div className="ai-audit-overview">
            <span
              className="ai-audit-verdict"
              style={{ color: verdictColors[result.verdict] }}
            >
              {result.verdict.replace("_", " ")}
            </span>
            <span className="ai-audit-score">
              Score: {result.overallScore.toFixed(2)}
            </span>
          </div>
          <p className="ai-audit-summary">{result.summary}</p>
          <div className="ai-audit-files">
            {result.fileResults.map((file) => (
              <div key={file.path} className="ai-audit-file">
                <span className="ai-audit-file-path">{file.path}</span>
                <span
                  className="ai-audit-file-verdict"
                  style={{ color: verdictColors[file.verdict] || "#6b7280" }}
                >
                  {file.score.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}