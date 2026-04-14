/**
 * Global SVG filters used by the liquid-glass card style.
 *
 * The `glass-refract` filter combines fractal-noise turbulence with a
 * displacement map: it warps whatever is rendered behind a `backdrop-
 * filter: url(#glass-refract)` host by a few pixels along the noise
 * field. That's the real-glass effect Apple uses — what's behind the
 * card bends slightly, like looking through a piece of soft glass.
 *
 * Mounted once in the app shell. The <svg> is visually zero-size so it
 * never affects layout; only its filter definitions are referenced.
 */

export function GlassFilter() {
  return (
    <svg
      aria-hidden
      focusable="false"
      style={{
        position: "fixed",
        width: 0,
        height: 0,
        pointerEvents: "none",
      }}
    >
      <defs>
        <filter id="glass-refract" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012 0.018"
            numOctaves="2"
            seed="7"
            result="turbulence"
          />
          <feGaussianBlur in="turbulence" stdDeviation="1" result="softNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softNoise"
            scale="6"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* Slightly stronger variant for larger cards */}
        <filter id="glass-refract-strong" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.008 0.014"
            numOctaves="2"
            seed="11"
            result="t"
          />
          <feGaussianBlur in="t" stdDeviation="1.2" result="n" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="n"
            scale="10"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
