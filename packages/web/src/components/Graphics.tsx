/**
 * Every image in this application lives in this file, as inline SVG: the ball
 * mark, a magnifier and a closed-door glyph. Imagery option 1 from the layout review — no
 * photographs, no illustration files, nothing licensed, nothing to download,
 * and it stays sharp at any size.
 */

/**
 * The masthead mark: a floorball ball, drawn by its holes.
 *
 * It is 16px on a 28px badge, and at that size a mark has to survive being
 * tiny. An earlier attempt drew the curve of a stick blade and simply read as
 * the letter U next to the wordmark. A stick is worse the smaller it gets —
 * it becomes a slash — and a plain ringed circle reads as a symbol rather
 * than a sport. The holes are what make this one unmistakable: nothing else
 * in an interface looks like a ball with holes in it.
 */
export function BallMark(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.1" fill="none" stroke="#ffffff" strokeWidth="1.5" />
      <circle cx="8" cy="5.2" r="1.05" fill="#ffffff" />
      <circle cx="5.3" cy="9.3" r="1.05" fill="#ffffff" />
      <circle cx="10.7" cy="9.3" r="1.05" fill="#ffffff" />
    </svg>
  );
}

export function SearchGlyph(): React.ReactElement {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden="true">
      <circle cx="7" cy="7" r="5.2" fill="none" stroke="#5a6b63" strokeWidth="1.7" />
      <path d="M11 11l4 4" stroke="#5a6b63" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function ClosedGlyph(): React.ReactElement {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" role="img" aria-label="Ei pelipäivä">
      <rect
        x="3.5"
        y="5.5"
        width="19"
        height="17"
        rx="3"
        fill="none"
        stroke="#5a6b63"
        strokeWidth="1.8"
      />
      <path
        d="M3.5 10.5h19M9 3.5v4M17 3.5v4M10 15.5h6"
        stroke="#5a6b63"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
