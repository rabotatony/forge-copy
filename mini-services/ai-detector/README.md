# AI Detector Mini-Service

A self-contained AI-content detector for Forge workflows.

## What It Does

Analyzes text content and reports whether it looks AI-generated.
Detects three AI-typical patterns:

1. Lexical cliches - AI-typical phrases (delve, tapestry, leverage, etc.)
2. Contrast constructions - 'not just X, but Y' patterns
3. Em-dash density - excessive em-dash usage (AI signature)

## Why This Matters for Forge

Forge inspects uploaded projects and runs workflows on them. This detector
adds a unique capability: detecting AI-generated content as part of CI/CD.

Use cases:
- Flag AI-generated documentation for human review
- Detect AI-generated code comments
- Audit content authenticity before deployment

## Usage

    import { detectAIText } from './ai-detector';
    const result = detectAIText(someText);
    // returns { score, verdict, signals }

## Integration

Add as a workflow step in Forge pipelines to detect AI content
in uploaded projects before deployment.