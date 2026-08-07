# AGENTS.md — How to work well on this project

Read this BEFORE making changes. It encodes hard-won lessons. Following it makes
your work better, more thorough, and less likely to break or look AI-generated.

---

## 1. The project's identity (what we are building)

This is a mysticism/knowledge site. Its value is DEPTH and FEEL, not breadth.

Core design philosophy — **focus over comprehensiveness**:
- Show ONE thing at a time, deeply. Not everything at once.
- A page is a RITUAL / experience, not an encyclopedia / index.
- Give content space to breathe. Whitespace is a feature.
- Change with time (time of day, lunar phase, season) so it feels alive.

If you find yourself adding a long list / grid / index of everything — STOP.
That is the single biggest "AI tell" and the thing this project fights against.

---

## 2. What makes output look AI-generated (avoid these)

Design:
- Glassmorphism (backdrop-filter: blur) — the biggest tell.
- Pure grayscale scaffolds (#fff/#000/#eee everywhere) with no warmth.
- Gradient overuse. Perfect symmetry. No personality.

Text:
- Cliches: delve, tapestry, leverage, seamless, robust, pivotal, "in today's
  fast-paced", "it's worth noting", furthermore/moreover/additionally.
- Hebrew: חשוב לציין, יתרה מזאת, בעולם המודרני, מגוון רחב, פורץ דרך, מדובר ב.
- "Not just X, but Y" contrast constructions.

Code:
- Leftover console.log/debug, TODO/FIXME trails, placeholder values,
  generic names (temp, foo, data1).

---

## 3. Tools available (use them, they are validated)

In the `design` repo / `mini-services`:
- `ai-detector` (text), `code-ai-detector`, `css-ai-detector`, `image-ai-detector`
  — DETECT AI patterns. Honest limit: they catch sloppy/cliche AI, not natural AI.
- `deai/` (`deai-text`, `deai-css`) — FIX AI patterns (the redesign half).
  Validated: text 0.45->0.00, css 0.55->0.00.
- `test-suite.json` + `VALIDATION.md` — how to validate detectors.

Workflow for any content/design change:
1. Run the relevant detector on the BEFORE state.
2. Apply your change (or the deai engine).
3. Run the detector on the AFTER state. Confirm the score drops.
4. Report the before/after numbers. Never claim "improved" without numbers.

---

## 4. Definition of DONE (this is where agents fail most)

A change is NOT done when the code is written. It is done when:

1. **It compiles / type-checks.** (No broken imports, no missing exports.)
2. **It actually renders / runs in the real environment.** Verify the deployed
   page shows the content. A blank page = NOT done.
3. **Colors are visible.** Never ship light-on-light or dark-on-dark. If you use
   CSS variables, give them CONTRASTING fallbacks. (We once shipped invisible
   text because the fallback color matched the background.)
4. **Data has fallbacks.** If content depends on async data, render something
   meaningful even when the data is empty/null.
5. **You checked the real theme.** Read globals.css for the actual --surface /
   --ink values before choosing colors. Do not assume dark or light.

If you cannot verify rendering, SAY SO explicitly instead of claiming success.

---

## 5. Common failure modes we have hit (do not repeat)

- Claiming success without verifying the page renders. (Happened. Blank page.)
- Assuming CSS variables exist in the deployed theme. (Happened. Invisible text.)
- Circular validation (testing a detector on samples written to match it).
  Always test on ADVERSARIAL / realistic samples.
- Over-comprehensiveness (adding everything at once). Fights the philosophy.
- Hardcoded thresholds with no calibration. Validate against real data.

---

## 6. How to be thorough (the "comprehensive" part)

- Read the actual current files before editing (the repo may have changed).
- Check imports/exports resolve (the named export must exist).
- After editing, re-read the file to confirm the edit landed.
- Test edge cases: empty input, null data, missing files.
- Prefer small, verifiable changes over large unverified rewrites.

---

## 7. When unsure

- Prefer the existing design tokens and components over inventing new ones.
- Prefer removing over adding (focus over comprehensiveness).
- If a change is risky, make it behind a fallback so the page never goes blank.
