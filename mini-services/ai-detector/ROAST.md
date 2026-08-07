# ROAST — Honest Self-Critique of the AI-Detector Suite

I roasted my own code and found real bugs. Here's what was wrong and what I fixed.

## Bug #1: Text detector was ENGLISH-ONLY (critical)

**The roast:** The entire rose-copy project is Hebrew, but the text detector
only checked English cliches. Hebrew AI text scored 0.00 = 'human_likely'.
The detector was useless on the primary language.

**Evidence (v1):**
- ai_text_en: 0.40 'uncertain' (WRONG — obvious AI missed)
- ai_text_he: 0.00 'human_likely' (WRONG — no Hebrew detection)
- Accuracy: 2/4 = coin flip

**Fix (v2):** Added Hebrew cliche list, calibrated scoring.
- Accuracy after: 4/4

## Bug #2: Code detector FALSE POSITIVES on legit words

**The roast:** The generic-naming check flagged 'result', 'data', 'value', 'item'
— all completely legitimate in real code. Real human code scored 0.82 density
vs the 0.1 threshold = instant false positive.

**Evidence:**
    function processOrder(order) {
      const result = validateOrder(order);   // 'result' flagged!
      const data = order.items.map(...);      // 'data' flagged!
      const value = data.reduce(...);         // 'value' flagged!
    }
    -> density 0.82, would be flagged as AI. WRONG.

**Fix (v2):** Generic naming now only catches truly-generic patterns
(temp, foo, data1, item2). Console detection ignores error/warn (legit).
- Validated: human code 0.00, AI-style code 0.51

## Bug #3: CSS grayscale detection was 100% BROKEN

**The roast:** The hex regex `#(?:fff|000|[0-9a-f]{6})` mangled #ffffff as #fff
(prefix match), and the grayscale calc skipped ALL 3-digit colors
(`hex.length === 6` check). Result: grayscale detection returned 0 even for
100% grayscale designs. #fff and #000 (the MOST common grayscale) were ignored.

**Evidence (v1):**
    .container { background: #fff; color: #000; }
    -> matches #fff, #000, but both SKIPPED (length != 6)
    -> grayscale count = 0. Detection broken.

**Fix (v2):** Correct 3+6 digit hex handling with word boundaries.
- Validated: 100% grayscale scaffold now detected

## Bug #4: audit.ts passed images to text detector

**The roast:** I added 'image' as a file type but the audit loop passed image
content (binary) to detectAIText (expects text). Would crash or misbehave.

**Fix:** Images now recorded for metadata-based analysis via detectAIImage.

## Lesson

Heuristic detectors with hardcoded thresholds and NO testing are unreliable.
Every detector should be validated against known AI and human samples.
The v2 versions are tested; the v1 versions were guesses.

## Remaining weaknesses (honest)

- Scores are still heuristic, not ML-calibrated
- Test set is small (4 text samples)
- Image detector needs real EXIF parsing (currently metadata-in)
- No integration test in the actual Forge runtime