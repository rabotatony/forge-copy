// RitualTarotCardPage.tsx — shows ONE tarot card, deeply, in ritual style.
//
// THE PRINCIPLE: Instead of listing all 22 cards, focus on ONE.
// Give it space. Give it depth. Let it breathe.

"use client";

import { useEffect, useState } from "react";
import { getTarotCardBySlug, type TarotCard } from "@/content";
import { TarotCardImage } from "@/components/home/TarotCardImage";
import "./RitualTarotCardPage.css";

interface RitualTarotCardPageProps {
  slug: string;
}

export function RitualTarotCardPage({ slug }: RitualTarotCardPageProps) {
  const [card, setCard] = useState<TarotCard | null>(null);

  useEffect(() => {
    const c = getTarotCardBySlug(slug);
    setCard(c);
  }, [slug]);

  if (!card) {
    return <div className="ritual-card-loading">...</div>;
  }

  return (
    <div className="ritual-card-page">
      {/* THE CARD IMAGE: large, centered, with space */}
      <section className="rc-image">
        <TarotCardImage card={card} />
      </section>

      {/* THE NAME: large, with the letter */}
      <section className="rc-name">
        <p className="rc-letter">{card.letter}</p>
        <h1 className="rc-hebrew-name">{card.hebrewName}</h1>
        <p className="rc-english-name">{card.englishName}</p>
      </section>

      {/* THE KEYWORD: one word */}
      <section className="rc-keyword">
        <p className="rc-keyword-text">{card.keyword}</p>
      </section>

      {/* THE MEANING: deep, with space */}
      <section className="rc-meaning">
        <p className="rc-pshat">{card.pshat}</p>
        {card.remez && <p className="rc-remez">{card.remez}</p>}
        {card.description && <p className="rc-description">{card.description}</p>}
      </section>

      {/* THE PRACTICE: one practical step */}
      <section className="rc-practice">
        <p className="rc-practice-label">תרגול ליום</p>
        <p className="rc-practice-text">{card.practice}</p>
      </section>
    </div>
  );
}