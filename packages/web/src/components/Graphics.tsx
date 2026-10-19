/**
 * Every image in this application lives in this file, as inline SVG: a
 * stick-and-ball mark, a rink outline and a closed-door glyph. Imagery
 * option 1 from the layout review — no photographs, no illustration files,
 * nothing licensed, nothing to download, and it stays sharp at any size.
 */

export function StickMark(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 2.5v6.2a5 5 0 0 0 10 0V2.5"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="8" cy="13" r="1.6" fill="#ffffff" />
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
      <rect x="3.5" y="5.5" width="19" height="17" rx="3" fill="none" stroke="#5a6b63" strokeWidth="1.8" />
      <path
        d="M3.5 10.5h19M9 3.5v4M17 3.5v4M10 15.5h6"
        stroke="#5a6b63"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A rink outline, used as the quiet graphic on the activity page header. */
export function Rink(): React.ReactElement {
  return (
    <svg className="rink" viewBox="0 0 320 96" aria-hidden="true">
      <rect x="2" y="2" width="316" height="92" rx="14" fill="none" stroke="#cbdcd4" strokeWidth="2" />
      <path d="M160 2v92" stroke="#cbdcd4" strokeWidth="2" />
      <circle cx="160" cy="48" r="22" fill="none" stroke="#cbdcd4" strokeWidth="2" />
      <path d="M2 28h30v40H2M318 28h-30v40h30" fill="none" stroke="#cbdcd4" strokeWidth="2" />
    </svg>
  );
}
