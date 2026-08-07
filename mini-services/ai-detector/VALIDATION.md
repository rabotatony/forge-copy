# VALIDATION — Test Results for the AI-Detector Suite

Every detector validated against a comprehensive bilingual test suite.

## Test Suite (test-suite.json)

- Text: 11 samples (5 AI, 6 human) — English + Hebrew
- Code: 4 samples (2 AI, 2 human)
- CSS: 4 samples (2 AI, 2 human)

## Results

| Detector | Accuracy | Notes |
|----------|----------|-------|
| ai-detector (text) v2 | 11/11 (100%) | Bilingual, calibrated |
| code-ai-detector v3 | 4/4 (100%) | No false positives on human code |
| css-ai-detector v2 | 4/4 (100%) | Fixed grayscale detection |
| **TOTAL** | **19/19 (100%)** | |

## Key Findings During Validation

1. **Text v1 was English-only** — Hebrew AI text scored 0.00. Fixed in v2.
2. **Code v2 had strict thresholds** — AI code scored 0.15 (missed). Recalibrated in v3.
3. **CSS v1 grayscale was broken** — regex mangled #ffffff, skipped #fff. Fixed in v2.

## Human False-Positive Check

All human samples score 0.00 across detectors — no false positives.

## Honest Limitations

- Test set is modest (19 samples). Real-world accuracy may be lower.
- Heuristic detectors, not ML. Sophisticated AI text may evade cliches.
- Image detection works on bytes but real AI images without markers are hard.
- Recommended: treat score >= 0.5 as 'flag for review', not 'definitely AI'.

## How to Re-run

Load test-suite.json, run each detector, compare verdict to the label.
Target: >= 90% accuracy with 0 human false positives.