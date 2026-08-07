// NewHomePage.tsx — the ritual homepage for rose-copy.
// THE INNOVATION: The homepage is a LIVING RITUAL, not an encyclopedia.

"use client";

import { useState, useEffect } from "react";
import { composeReading, type ReadingResult } from "@/engine";
import { PROVERBS, SOUL_STORIES, getTarotCard } from "@/content";
import { TarotCardImage } from "@/components/home/TarotCardImage";
import "./NewHomePage.css";
import { getLunarPhase, getLunarPhaseName, getLunarTheme, getSeason, getSeasonalTheme } from "@/lib/cosmic";

function getTimePhase(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 10) return "morning";
  if (hour >= 10 && hour < 16) return "afternoon";
  if (hour >= 16 && hour < 20) return "evening";
  return "night";
}

function getRitualWords(phase: string): { opening: string; closing: string } {
  const words: Record<string, { opening: string; closing: string }> = {
    morning: { opening: "הבוקר עלה. מה אתה מבקש היום?", closing: "היום נפתח. לך אליו." },
    afternoon: { opening: "היום בעיצומו. עצור לרגע.", closing: "היום ממשיך. אבל אתה כבר לא אותו דבר." },
    evening: { opening: "היום נסגר. מה נשאר?", closing: "הערב יורד. קח איתך רק מה שצריך." },
    night: { opening: "הלילה. הזמן שבו הכל שקט.", closing: "הלילה שומר. מחר יבוא." },
  };
  return words[phase] || words.afternoon;
}

function pickDaily<T>(items: readonly T[]): T | null {
  if (!items || items.length === 0) return null;
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayNumber = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return items[dayNumber % items.length];
}

export function NewHomePage() {
  const [reading, setReading] = useState<ReadingResult | null>(null);
  const [phase, setPhase] = useState<string>("afternoon");
  const [lunarInfo, setLunarInfo] = useState<{ name: string; theme: string } | null>(null);
  const [seasonInfo, setSeasonInfo] = useState<{ name: string; theme: string } | null>(null);

  useEffect(() => {
    const result = composeReading(new Date());
    setReading(result);
    setPhase(getTimePhase());
    // Compute lunar and seasonal info
    const now = new Date();
    const lunarPhase = getLunarPhase(now);
    setLunarInfo({
      name: getLunarPhaseName(lunarPhase),
      theme: getLunarTheme(lunarPhase),
    });
    const season = getSeason(now);
    setSeasonInfo({
      name: season,
      theme: getSeasonalTheme(season),
    });
  }, []);

  const ritualWords = getRitualWords(phase);
  const dailyProverb = pickDaily(PROVERBS);
  const dailyStory = pickDaily(SOUL_STORIES);
  const card = reading ? getTarotCard(reading.cardNumber) : null;

  return (
    <div className="new-homepage">
      <section className="nh-opening">
        <p className="nh-opening-text">{ritualWords.opening}</p>
      </section>
      <section className="nh-card">
        {card && (
          <>
            <TarotCardImage card={card} />
            <h2 className="nh-card-name">{card.hebrewName}</h2>
            <p className="nh-card-keyword">{card.keyword}</p>
            <p className="nh-card-meaning">{card.description || card.pshat}</p>
          </>
        )}
      </section>
      <section className="nh-whisper">
        {dailyProverb && <p className="nh-whisper-text">{dailyProverb.text}</p>}
      </section>
      {/* THE COSMIC MOMENT: lunar phase and season */}
      <section className="nh-cosmic">
        {lunarInfo && seasonInfo && (
          <>
            <p className="nh-cosmic-lunar">{lunarInfo.name} — {lunarInfo.theme}</p>
            <p className="nh-cosmic-season">{seasonInfo.name} — {seasonInfo.theme}</p>
          </>
        )}
      </section>

      <section className="nh-story">
        {dailyStory && (
          <>
            <h3 className="nh-story-title">{dailyStory.title}</h3>
            <p className="nh-story-body">{dailyStory.body}</p>
            <p className="nh-story-teaching">{dailyStory.teaching}</p>
          </>
        )}
      </section>
      <section className="nh-closing">
        <p className="nh-closing-text">{ritualWords.closing}</p>
      </section>
    </div>
  );
}