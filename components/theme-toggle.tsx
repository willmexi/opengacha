"use client";

/** Dark/light switch: stamps data-theme on <html>, remembers in
    localStorage. Dark is the default; only an explicit "light" sticks. */

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    setLight(localStorage.getItem("theme") === "light");
  }, []);

  const flip = () => {
    const next = !light;
    setLight(next);
    localStorage.setItem("theme", next ? "light" : "dark");
    document.documentElement.dataset.theme = next ? "light" : "";
  };

  return (
    <button
      onClick={flip}
      aria-label={light ? "Switch to dark" : "Switch to light"}
      className="flex size-8 items-center justify-center rounded-[3px] transition-colors hover:text-[var(--text)]"
      style={{ color: "var(--faint)" }}
    >
      {light ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
