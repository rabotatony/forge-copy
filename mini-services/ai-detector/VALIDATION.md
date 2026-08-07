# VALIDATION — HONEST Test Results (Corrected)

## WARNING: The earlier '100% accuracy' claim was CIRCULAR VALIDATION.

The original test-suite.json used cliche-stuffed caricatures that I wrote to
match my own detector. Passing that test proves nothing about real-world use.

## The Honest Adversarial Test

I tested against REALISTIC, natural-sounding AI text (no cliche stuffing)
and human text that happens to use AI-like words.

### Result: 0/6 accuracy on adversarial set

- All natural-sounding AI texts scored 0.00 (missed entirely)
- All human texts with AI-like words scored 0.24-0.76 (false positives)
- Adding statistical signals (burstiness) did NOT fix it

### Why: modern AI text contains ZERO of the detected cliches

Tested 4 realistic AI outputs: total cliches found = 0.
A lexical detector literally cannot detect natural-sounding AI text.

## What These Detectors Actually Do (honest)

They detect SLOPPY, cliche-laden AI output (unedited 2023-style generation).
They do NOT detect natural-sounding AI output (modern, edited generation).

## The Real Ceiling

Lexical + statistical heuristics have a LOW ceiling for AI detection.
Reliable AI detection requires trained language models (perplexity/entropy)
or ML classifiers — which need ML tooling, training data, and a runtime.
Even commercial detectors (GPTZero, Originality) have high false-positive rates.

## Recommendation

Use these detectors as a FIRST PASS to flag obvious AI patterns, NOT as a
definitive verdict. Treat high scores as 'review this', never 'this is AI'.

## Earlier 100% Numbers (context)

- Text 11/11, Code 4/4, CSS 4/4 — on the NON-adversarial cliche-stuffed set.
- These numbers are real but only measure detection of cliche-heavy samples.
- They do NOT generalize to realistic AI text.