# SYSTEM.md — Map of the AI-quality system

Quick map of every piece and how they connect. For HOW to work, see AGENTS.md.

## Problem solved
AI sites look AI due to: over-comprehensiveness (everything at once), perfect
symmetry, cliche text, glassmorphism/grayscale design, and unverified changes
(blank pages). This system attacks each.

## Pieces
- Philosophy: focus over comprehensiveness (ritual, not encyclopedia) -> RitualPage.
- Detection: mini-services/ai-detector/ (text/code/css/image + audit + tests).
  Honest limit: catches sloppy/cliche AI, NOT natural-sounding AI.
- Redesign: mini-services/deai/ (deai-text, deai-css). Validated 0.45/0.55 -> 0.00.
- Building block: RitualPage.tsx/css (visible text + empty-data fallbacks).
- Local tool: scripts/deai-check.mjs (score/verdict/signals per file).
- CI: typecheck.yml (blank pages), deai-audit.yml (PR comment + fail>=0.6), build.yml.

## Flow
agent writes -> AGENTS.md self-check (tsc+deai-check+render+colors+fallbacks)
-> push/PR -> CI (typecheck + deai-audit + build)
-> deai-audit comments scores; fails if >=0.6 -> merge only if clean.

## Failure classes caught
- blank page / broken import: typecheck, build, RitualPage fallbacks
- invisible text: AGENTS.md colors rule, RitualPage
- cliche/AI text: deai-check, deai-audit, deai-text
- AI design (glass/gray): deai-check, deai-audit, deai-css
- unverified claims: AGENTS.md definition-of-done, VALIDATION.md