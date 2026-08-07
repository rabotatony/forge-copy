# De-AI Redesign Engines

Detection flags AI patterns; these engines FIX them. This is the redesign half.

## Validated Results (detector score before -> after)

| Engine | Before | After | Drop |
|--------|--------|-------|------|
| deai-text | 0.45 (ai_likely) | 0.00 (human_likely) | -0.45 |
| deai-css | 0.55 (ai_likely) | 0.00 (human_likely) | -0.55 |

## deai-text.ts

Replaces AI cliches with plain alternatives (English + Hebrew):
- delve -> dig, tapestry -> mix, leverage -> use
- furthermore/moreover/additionally -> also
- 'not just X but Y' contrast wrappers -> removed
- Hebrew: חשוב לציין, יתרה מזאת, בעולם המודרני, etc.

## deai-css.ts

Removes AI design patterns:
- Glassmorphism (backdrop-filter: blur) -> removed
- Gradient overuse (>3) -> simplified to solid colors
- Grayscale scaffold -> colors warmed toward cream

## Honest Limits

- Removes DETECTABLE patterns (cliches, glass, grayscale). Does not add
  genuine personality or voice — that requires human input.
- Cliche replacement is mechanical; a human editor produces better prose.
- Best used as a first pass, then human review.

## Usage

    import { deAIText } from './deai-text';
    import { deAICSS } from './deai-css';
    const { text, changes } = deAIText(aiText);
    const { css, changes } = deAICSS(aiCss);