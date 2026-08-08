"use client";
// ============================================================
// ForgeHero — a full-screen, immersive landing page.
// "Forge is the body of the AI." Told in fire, sparks and glow,
// using the forge-motion language. This is its own dark world;
// the CTA carries you into the app.
// ============================================================
import { Anvil, Hammer, Eye, Database, Network, Rocket, TerminalSquare, Cpu, ArrowRight, Flame, ChevronDown } from "lucide-react";

const SPARKS = [
  { left: 8,  delay: 0.0, dur: 3.6, drift: 16, size: 3 },
  { left: 16, delay: 1.4, dur: 4.4, drift: -12, size: 2 },
  { left: 25, delay: 0.7, dur: 3.2, drift: 10, size: 4 },
  { left: 34, delay: 2.2, dur: 4.8, drift: -16, size: 2 },
  { left: 43, delay: 0.3, dur: 3.9, drift: 12, size: 3 },
  { left: 51, delay: 1.8, dur: 3.4, drift: -8, size: 2 },
  { left: 60, delay: 1.0, dur: 4.6, drift: 14, size: 3 },
  { left: 69, delay: 2.6, dur: 3.7, drift: -14, size: 2 },
  { left: 78, delay: 0.4, dur: 4.2, drift: 10, size: 3 },
  { left: 86, delay: 1.2, dur: 3.3, drift: -10, size: 2 },
  { left: 93, delay: 2.0, dur: 4.0, drift: 12, size: 3 },
  { left: 30, delay: 3.0, dur: 4.1, drift: 8, size: 2 },
  { left: 65, delay: 3.3, dur: 3.5, drift: -6, size: 3 },
  { left: 48, delay: 2.8, dur: 5.0, drift: 6, size: 2 },
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

export function ForgeHero({ onEnterApp, onOpenControlCenter }: { onEnterApp?: () => void; onOpenControlCenter?: () => void }) {
  return (
    <section className="relative isolate flex min-h-screen flex-col overflow-hidden bg-[#0a0705] text-foreground">
      {/* Ember field */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-x-0 bottom-0 h-[75%] forge-flame"
             style={{ background: "radial-gradient(62% 85% at 50% 112%, rgba(207,84,44,0.46), rgba(230,127,56,0.20) 45%, transparent 72%)" }} />
        <div className="absolute bottom-[-60px] left-1/2 h-[340px] w-[640px] -translate-x-1/2 forge-heat-drift"
             style={{ background: "radial-gradient(closest-side, rgba(255,164,105,0.32), transparent)", filter: "blur(34px)" }} />
        <div className="absolute left-[10%] top-[16%] h-[220px] w-[220px] forge-heat-drift"
             style={{ background: "radial-gradient(closest-side, rgba(230,127,56,0.15), transparent)", filter: "blur(26px)", animationDelay: "2s" }} />
        <div className="absolute right-[12%] top-[28%] h-[180px] w-[180px] forge-heat-drift"
             style={{ background: "radial-gradient(closest-side, rgba(255,164,105,0.12), transparent)", filter: "blur(24px)", animationDelay: "4s" }} />
        {SPARKS.map((s, i) => (
          <span key={i} className="forge-spark absolute bottom-[6%] rounded-full"
            style={{
              left: `${s.left}%`, width: s.size, height: s.size,
              background: "rgb(255,200,130)",
              boxShadow: "0 0 9px 2px rgba(255,164,105,0.85)",
              ["--spark-dur" as any]: `${s.dur}s`,
              ["--spark-delay" as any]: `${s.delay}s`,
              ["--spark-drift" as any]: `${s.drift}px`,
            }} />
        ))}
      </div>

      {/* Main content — vertically centered */}
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        {/* Anvil mark */}
        <div className="forge-reveal relative mb-9">
          <span className="forge-ember absolute inset-0 rounded-2xl" style={{ boxShadow: "0 0 70px 16px rgba(230,127,56,0.38)" }} />
          <span className="forge-anvil-ring relative flex size-24 items-center justify-center rounded-2xl border border-amber-400/30 bg-gradient-to-b from-[#2b1a10] to-[#171008]">
            <Anvil className="size-11 text-amber-400" aria-hidden />
          </span>
        </div>

        {/* Headline */}
        <h1 className="forge-molten forge-d1 text-5xl font-semibold tracking-tight text-[#f5ead6] sm:text-7xl">Forge</h1>
        <p className="forge-reveal forge-d2 mt-4 text-xl font-medium text-amber-300/95 sm:text-3xl">The body of the AI.</p>
        <p className="forge-reveal forge-d3 mx-auto mt-5 max-w-2xl text-base leading-relaxed text-[#b6ae9f] sm:text-lg">
          An AI can speak, but Forge gives it <em className="text-amber-200 not-italic">hands to build, eyes to see, and a fire of its own</em>.
          Upload, build, deploy, and watch the result — sovereign, on your own compute.
        </p>

        {/* Value pillars */}
        <div className="mt-12 grid w-full gap-4 text-left sm:grid-cols-3">
          {PILLARS.map((p, i) => {
            const Icon = p.icon;
            return (
              <div key={p.title} className={`forge-card forge-reveal forge-d${i + 4} rounded-xl border border-amber-400/10 bg-[#141009]/70 p-5 backdrop-blur-sm`}>
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

        {/* CTAs */}
        <div className="forge-reveal forge-d8 mt-12 flex flex-col items-center gap-3 sm:flex-row">
          <button type="button" onClick={onEnterApp}
            className="forge-flame group inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-7 py-3.5 text-sm font-semibold text-[#1a0d04] shadow-[0_10px_34px_-6px_rgba(230,127,56,0.55)] transition-transform hover:scale-[1.04]">
            <Flame className="size-4" aria-hidden />
            Enter the Forge
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>
          <button type="button" onClick={onOpenControlCenter}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.04] px-7 py-3.5 text-sm font-medium text-amber-200/90 transition-colors hover:bg-amber-400/[0.1]">
            <Cpu className="size-4" aria-hidden />
            Control Center
          </button>
        </div>
      </div>

      {/* Scroll hint */}
      <button type="button" onClick={onEnterApp} aria-label="Enter the app"
        className="forge-reveal forge-d8 mx-auto mb-6 flex flex-col items-center gap-1 text-xs text-[#7a7368] transition-colors hover:text-amber-300">
        <span>Step into the workshop</span>
        <ChevronDown className="size-4 animate-bounce" aria-hidden />
      </button>
    </section>
  );
}
