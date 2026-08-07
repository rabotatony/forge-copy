# AI Detector Suite for Forge — HONEST capability statement

Detects SOME AI-generated content patterns. Has real limits. Read VALIDATION.md.

## What it CAN detect

Sloppy, cliche-laden AI output (unedited generation):
- Text: AI cliches (delve, tapestry, leverage; Hebrew equivalents)
- Code: debug leftovers, placeholders, TODO trails
- CSS: glassmorphism, grayscale scaffold, gradient overuse
- Images: AI-tool markers, missing EXIF, AI-typical dimensions

## What it CANNOT detect

Natural-sounding AI output. Realistic AI text contains none of the detected
cliches and scores 0.00. This is a hard ceiling of heuristic detection.

## Files

- ai-detector.ts — text (bilingual)
- code-ai-detector.ts — code
- css-ai-detector.ts — design
- image-ai-detector.ts — images (byte analysis)
- audit.ts — project-wide audit
- test-suite.json — NON-adversarial baseline (cliche-heavy)
- VALIDATION.md — HONEST results incl. adversarial 0/6
- ROAST.md — self-critique

## Use responsibly

Treat scores as 'flag for review', never as 'definitely AI'.
Reliable detection requires ML, which this heuristic suite does not provide.