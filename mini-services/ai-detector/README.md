# AI Detector Mini-Service

A comprehensive AI-content detection suite for Forge workflows.

## Capabilities

Four detectors, one audit:

### 1. ai-detector.ts — Text
Detects AI-typical patterns in text (docs, comments, markdown):
- Lexical cliches (delve, tapestry, leverage, etc.)
- Contrast constructions ('not just X, but Y')
- Em-dash density (AI signature)

### 2. code-ai-detector.ts — Code
Detects AI-typical patterns in source code:
- Debug console leftovers (console.log, print)
- TODO/FIXME/HACK trails
- Generic naming (data, temp, value, handler)
- Placeholder values (lorem, example.com, dummy)

### 3. css-ai-detector.ts — Design
Detects AI-typical patterns in CSS:
- Glassmorphism (backdrop-filter: blur) — the biggest AI tell
- Grayscale scaffold (only gray/white/black)
- Gradient overuse

### 4. audit.ts — Comprehensive Audit
Combines all three detectors into one project audit.
Analyzes all files and produces an authenticity report.

## Why This Matters for Forge

Forge inspects uploaded projects and runs workflows on them.
This suite adds a unique capability: detecting AI-generated
content as part of CI/CD. No other CI/CD platform offers this.

## Usage

    import { auditProject } from './audit';
    const result = auditProject(projectFiles);
    // returns { overallScore, verdict, fileResults, summary }

## Integration

Add as a workflow step in Forge pipelines:

    - name: Audit AI content
      run: ai-detector --audit ./project --threshold 0.5

## Files

- ai-detector.ts — text detection
- code-ai-detector.ts — code detection
- css-ai-detector.ts — design detection
- audit.ts — comprehensive audit
- README.md — this file