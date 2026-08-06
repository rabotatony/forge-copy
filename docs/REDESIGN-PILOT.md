# Redesign Pilot — Anti-AI Design Machine

Ran the anti-AI machine from `rabotatony/design` (`machine.run_machine`) on
Forge's design layer and applied the produced package to
`src/app/globals.css`.

## Measurements (actual run)

| layer | before | after |
|---|---|---|
| CSS clean score (design_scan) | 0.588 | **1.0** |
| tells | `color.grayscale_only`, `mat.no_grain` | none |
| UI text (deep semantic) | 0.01 | 0.01 — machine declined, already clean |
| coherence | 0.77 (coherent) | lift declined ("already >= 0.6") |
| code voice | 0.02 avg | clean |

## Human seeds (required by the machine)

- signature: **"the flame"** → flame radius geometry (4px 16px 4px 16px)
- rhythm: **"bellows 2-1-3"** → breath tokens 0.8s / 0.4s / 1.2s

## What changed in globals.css

- Default shadcn grayscale scaffold → warm material palette:
  - light: bone `#d6d4ce` surfaces + bronze primary `#966e37`
  - dark: charcoal `#14110d` surfaces + bright bronze `#b09269`
- Sidebar tokens re-mapped onto the same palette (the machine left them
  cold-gray; corrected in this commit).
- Grain overlay (feTurbulence, opacity 0.03) on `body::before`.
- Composed token layer: surface-0..3, ink scale, shadows, descent spacing,
  radius tokens, breath + easing tokens.
- `signature-open` keyframes (guarded by `prefers-reduced-motion`).

## Decisions

- Phase 2 (palette unification): all 13 Tailwind color families used by
  components (1,216 utility hits / 64 files) remapped onto the forge
  identity via an `@theme` override block in globals.css — zero TSX edits.
  emerald→patina, amber→ember gold, orange→rust, red→forge red,
  rose→warm rose, zinc→warm ink, sky→steel, violet→heather, indigo→deep
  steel, blue→steel blue, teal→patina teal, green→laurel, yellow→pale gold.
- chart + destructive colors left untouched (they already have chroma).

## Rollback

`git revert` this commit — the redesign is a single-file change.
