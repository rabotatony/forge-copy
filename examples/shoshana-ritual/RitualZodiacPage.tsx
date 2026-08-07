// RitualZodiacPage.tsx — shows ONE zodiac sign, deeply, in ritual style.
//
// THE PRINCIPLE: Instead of listing all 12 signs, focus on ONE.
// Give it space. Give it depth. Let it breathe.

"use client";

import { useEffect, useState } from "react";
import { ZODIAC_SIGNS, type ZodiacSign } from "@/content";
import "./RitualZodiacPage.css";

interface RitualZodiacPageProps {
  signId: string;
}

export function RitualZodiacPage({ signId }: RitualZodiacPageProps) {
  const [sign, setSign] = useState<ZodiacSign | null>(null);

  useEffect(() => {
    const s = ZODIAC_SIGNS.find((z) => z.id === signId);
    setSign(s || null);
  }, [signId]);

  if (!sign) {
    return <div className="ritual-zodiac-loading">...</div>;
  }

  return (
    <div className="ritual-zodiac-page">
      {/* THE GLYPH: large, centered */}
      <section className="rz-glyph">
        <p className="rz-glyph-symbol">{sign.glyph}</p>
      </section>

      {/* THE NAME: Hebrew and Latin */}
      <section className="rz-name">
        <h1 className="rz-hebrew-name">{sign.name}</h1>
        <p className="rz-latin-name">{sign.latin}</p>
      </section>

      {/* THE KEYWORD: one word */}
      <section className="rz-keyword">
        <p className="rz-keyword-text">{sign.keyword}</p>
      </section>

      {/* THE ESSENCE: element, quality, ruler */}
      <section className="rz-essence">
        <p className="rz-essence-line">{sign.element} — {sign.quality}</p>
        <p className="rz-essence-line">שליט: {sign.ruler}</p>
        <p className="rz-essence-line">{sign.dates}</p>
      </section>

      {/* THE MEANING: deep description */}
      <section className="rz-meaning">
        <p className="rz-description">{sign.description}</p>
      </section>

      {/* THE ARCHETYPE */}
      <section className="rz-archetype">
        <p className="rz-archetype-label">הדמות</p>
        <p className="rz-archetype-text">{sign.archetype}</p>
      </section>

      {/* THE TEACHING: one insight */}
      <section className="rz-teaching">
        <p className="rz-teaching-label">השיעור של {sign.name}</p>
        <p className="rz-teaching-text">{sign.teaching}</p>
      </section>

      {/* THE DAILY PRACTICE */}
      <section className="rz-practice">
        <p className="rz-practice-label">תרגול יומי</p>
        <p className="rz-practice-text">{sign.dailyPractice}</p>
      </section>
    </div>
  );
}