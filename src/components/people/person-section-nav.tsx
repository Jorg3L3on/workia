"use client";

import { useEffect } from "react";

import {
  detailCardDomId,
  type DetailCardId,
} from "@/components/people/person-detail-model";
import {
  scrollMarginTop,
  scrollToElement,
} from "@/components/people/section-scroll";

type PersonSectionNavProps = {
  cards: { id: DetailCardId; label: string }[];
  /**
   * A card to land on when the page opens: `?emit=1` and `?contract=created`
   * land on Contrato (they used to open its tab). It is scrolled to,
   * focused and highlighted for a moment.
   */
  landOn?: DetailCardId;
};

const HIGHLIGHT_MS = 2400;

const cardElement = (id: DetailCardId) =>
  document.getElementById(detailCardDomId(id));

const goTo = (id: DetailCardId, smooth: boolean) => {
  const card = cardElement(id);

  if (!card) {
    return null;
  }

  scrollToElement(card, { offset: scrollMarginTop(card), smooth });
  card.focus({ preventScroll: true });

  return card;
};

/**
 * Shortcut chips to the expediente's cards. They only scroll (there are no
 * tabs): every card stays on the page. On phones they are a sticky
 * horizontal row.
 */
export const PersonSectionNav = ({ cards, landOn }: PersonSectionNavProps) => {
  useEffect(() => {
    if (!landOn) {
      return;
    }

    const card = goTo(landOn, false);

    if (!card) {
      return;
    }

    card.dataset.highlight = "true";
    const timer = window.setTimeout(() => {
      delete card.dataset.highlight;
    }, HIGHLIGHT_MS);

    return () => window.clearTimeout(timer);
  }, [landOn]);

  return (
    <nav
      aria-label="Secciones del expediente"
      className="workia-section-chips bg-background sticky -top-4 z-10 -mx-4 [scrollbar-width:none] overflow-x-auto px-4 py-2 md:static md:mx-0 md:overflow-visible md:bg-transparent md:px-0 md:py-0"
      data-section-nav=""
    >
      <ul className="flex gap-2 md:flex-wrap">
        {cards.map((card) => (
          <li className="shrink-0" key={card.id}>
            <a
              className="workia-chip"
              href={`#${detailCardDomId(card.id)}`}
              onClick={(event) => {
                event.preventDefault();
                goTo(card.id, true);
              }}
            >
              {card.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
};
