# AI Detector Suite for Forge

A comprehensive AI-content detection suite — text, code, design, and images.
A unique capability for a CI/CD platform.

## The 5 Detectors

### 1. ai-detector.ts — Text
Detects AI patterns in text/docs/markdown:
- Lexical cliches (delve, tapestry, leverage)
- Contrast constructions ('not just X, but Y')
- Em-dash density

### 2. code-ai-detector.ts — Code
Detects AI patterns in source code:
- Debug console leftovers
- TODO/FIXME/HACK trails
- Generic naming, placeholder values

### 3. css-ai-detector.ts — Design
Detects AI patterns in CSS:
- Glassmorphism (backdrop-filter: blur)
- Grayscale scaffold
- Gradient overuse

### 4. image-ai-detector.ts — Images
Detects AI-generated images:
- Missing EXIF camera data
- AI-tool metadata markers (DALL-E, Midjourney, SD)
- AI-typical dimensions

### 5. audit.ts — Comprehensive Audit
Combines all detectors. Analyzes every file in a project
and produces an authenticity report.

## Files

- ai-detector.ts — text
- code-ai-detector.ts — code
- css-ai-detector.ts — design
- image-ai-detector.ts — images
- audit.ts — comprehensive audit
- README.md — this file

## Integration

- API endpoint: POST /api/forge/ai-audit (in src/app/api/forge/ai-audit/)
- Workflow template: examples/ai-audit-workflow/
- UI component: examples/ai-audit-workflow/AIAuditPanel.tsx

## Why This Matters

Forge is the first CI/CD platform to offer AI-content detection.
This differentiates it from every other tool in the market.