/**
 * Tiny inline sparkline — used in PageHero stats to give numeric
 * metrics a visual trend companion. Takes an array of points,
 * normalises to 0..1, renders a smooth stroke + soft fill.
 *
 * Server-component safe (plain SVG, no JS needed to render).
 */

type SparklineProps = {
  values: number[];
  className?: string;
  width?: number;
  height?: number;
  stroke?: string;
};

export function Sparkline({
  values,
  className,
  width = 120,
  height = 32,
  stroke = "currentColor",
}: SparklineProps) {
  if (values.length === 0) return null;

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;

  // Build path points normalised to the SVG box.
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = height - 2 - ((v - min) / span) * (height - 4);
    return [x, y] as const;
  });

  // Smooth via quadratic curves between midpoints.
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i];
    const [px, py] = pts[i - 1];
    const cx = (px + x) / 2;
    const cy = (py + y) / 2;
    d += ` Q ${px} ${py} ${cx} ${cy}`;
  }
  d += ` T ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`;

  const fillD = `${d} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      fill="none"
    >
      <path d={fillD} fill={stroke} opacity="0.12" />
      <path
        d={d}
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
