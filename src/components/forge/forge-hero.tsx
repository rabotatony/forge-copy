"use client";
// ============================================================
// ForgeHero — the opening statement.
// "Forge is the body of the AI." Told in fire, sparks and glow,
// using the forge-motion language (ember / spark / molten / anvil).
// ============================================================
import { Anvil, Hammer, Eye, Database, Network, Rocket, TerminalSquare, Cpu, ArrowRight, Flame } from "lucide-react";

// Deterministic spark field (no hydration randomness).
const SPARKS = [
  { left: 12, delay: 0.0, dur: 3.4, drift: 14, size: 3 },
  { left: 22, delay: 1.2, dur: 4.2, drift: -10, size: 2 },
  { left: 33, delay: 0.6, dur: 3.1, drift: 8, size: 4 },
  { left: 44, delay: 2.0, dur: 4.6, drift: -14, size: 2 },
  { left: 52, delay: 0.3, dur: 3.8, drift: 10, size: 3 },
  { left: 61, delay: 1.6, dur: 3.3, drift: -8, size: 2 },
  { left: 70, delay: 0.9, dur: 4.4, drift: 12, size: 3 },
  { left: 79, delay: 2.4, dur: 3.6, drift: -12, size: 2 },
  { left: 88, delay: 0.2, dur: 4.0, drift: 9, size: 3 },
  { left: 28, delay: 2.8, dur: 3.9, drift: 6, size: 2 },
  { left: 66, delay: 3.1, dur: 3.2, drift: -6, size: 3 },
  { left: 94, delay: 1.1, dur: 4.8, drift: 10, size: 2 },
];

const PILLARS = [
  { icon: Hammer, title: "Hands", line: "The AI executes — terminal, builds, jobs. Not just words, real action.", tint: "var(--forge-ember)" },
  { icon: Eye, title: "Eyes", line: "The AI sees its work — observer, telemetry, verification.", tint: "var(--forge-gold)" },
  { icon: Network, title: "Sovereign", line: "Runs on your own compute — the Mesh. No vendor owns the fire.", tint: "var(--forge-teal)" },
] as const;

const CAPS = [
  { icon: TerminalSquare, label: "Terminal" },
  { icon: Eye, label: "Observer" },
  { icon: Database, label: "Memory" },
  { icon: Network, label: "Mesh" },
  { icon: Rocket, label: "Deploy" },
  { icon: Cpu, label: "Capabilities" },
] as const;

export function ForgeHero({ onOpenControlCenter }: { onOpenControlCenter?: () => void }) {
  return (
    <section className="relative isolate overflow-hidden rounded-2xl border border-border bg-[#0c0a08] text-foreground">
      {/* Ember field — warm radial glow rising from the coals */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-x-0 bottom-0 h-[70%] forge-flame"
             style={{ background: "radial-gradient(60% 80% at 50% 108%, rgba(207,84,44,0.42), rgba(230,127,56,0.18) 45%, transparent 70%)" }} />
        <div className="absolute bottom-[-40px] left-1/2 h-[300px] w-[560px] -translate-x-1/2 forge-heat-drift"
             style={{ background: "radial-gradient(closest-side, rgba(255,164,105,0.30), transparent)", filter: "blur(30px)" }} />
        <div className="absolute left-[12%] top-[18%] h-[180px] w-[180px] forge-heat-drift"
             style={{ background: "radial-gradient(closest-side, rgba(230,127,56,0.14), transparent)", filter: "blur(24px)", animationDelay: "2s" }} />
        {/* sparks */}
        {SPARKS.map((s, i) => (
          <span key={i} className="forge-spark absolute bottom-[8%] rounded-full"
            style={{
              left: `${s.left}%`, width: s.size, height: s.size,
              background: "rgb(255,196,120)",
              boxShadow: "0 0 8px 2px rgba(255,164,105,0.8)",
              ["--spark-dur" as any]: `${s.dur}s`,
              ["--spark-delay" as any]: `${s.delay}s`,
              ["--spark-drift" as any]: `${s.drift}px`,
            }} />
        ))}
      </div>

      <div className="mx-auto flex max-w-5xl flex-col items-center px-6 pb-16 pt-20 text-center sm:pt-24">
        {/* The anvil mark */}
        <div className="forge-reveal relative mb-8">
          <span className="forge-ember absolute inset-0 rounded-2xl" style={{ boxShadow: "0 0 60px 14px rgba(230,127,56,0.35)" }} />
          <span className="forge-anvil-ring relative flex size-20 items-center justify-center rounded-2xl border border-amber-400/30 bg-gradient-to-b from-[#2a1a10] to-[#171008]">
            <Anvil className="size-9 text-amber-400" aria-hidden />
          </span>
        </div>

        {/* Headline — poured molten */}
        <h1 className="forge-molten forge-d1 text-4xl font-semibold tracking-tight text-[#f5ead6] sm:text-6xl">
          Forge
        </h1>
        <p className="forge-reveal forge-d2 mt-3 text-lg font-medium text-amber-300/90 sm:text-2xl">
          The body of the AI.
        </p>
        <p className="forge-reveal forge-d3 mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-[#b6ae9f] sm:text-base">
          An AI can speak, but Forge gives it <em className="text-amber-200 not-italic">hands to build, eyes to see, and a fire of its own</em>.
          Upload, build, deploy, and watch the result — sovereign, on your own compute.
        </p>

        {/* Value pillars */}
        <div className="mt-12 grid w-full gap-4 text-left sm:grid-cols-3">
          {PILLARS.map((p, i) => {
            const Icon = p.icon;
            return (
              <div key={p.title} className={`forge-card forge-reveal forge-d${i + 4} rounded-xl border border-border bg-[#141009]/80 p-5 backdrop-blur-sm`}>
                <span className="mb-3 flex size-10 items-center justify-center rounded-lg"
                      style={{ background: `color-mix(in srgb, ${p.tint} 16%, transparent)`, color: p.tint }}>
                  <Icon className="size-5" aria-hidden />
                </span>
                <div className="text-base font-semibold text-[#ece3d0]">{p.title}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-[#9b948a]">{p.line}</p>
              </div>
            );
          })}
        </div>

        {/* Capability chips */}
        <div className="forge-reveal forge-d7 mt-10 flex flex-wrap items-center justify-center gap-2">
          {CAPS.map((c) => {
            const Icon = c.icon;
            return (
              <span key={c.label} className="flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-3 py-1.5 text-xs text-amber-200/90">
                <Icon className="size-3.5" aria-hidden />{c.label}
              </span>
            );
          })}
        </div>

        {/* CTA */}
        <div className="forge-reveal forge-d8 mt-12 flex flex-col items-center gap-3 sm:flex-row">
          <button type="button" onClick={onOpenControlCenter}
            className="forge-flame group inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-6 py-3 text-sm font-semibold text-[#1a0d04] shadow-[0_8px_30px_-6px_rgba(230,127,56,0.5)] transition-transform hover:scale-[1.03]">
            <Flame className="size-4" aria-hidden />
            Enter the Control Center
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>
          <a href="#projects" className="inline-flex items-center gap-2 rounded-lg border border-border bg-transparent px-6 py-3 text-sm font-medium text-[#b6ae9f] transition-colors hover:bg-white/[0.04] hover:text-[#ece3d0]">
            Browse projects
          </a>
        </div>
      </div>
    </section>
  );
}
