// BarMini — barras verticais compactas. Recharts.

import { Bar, BarChart, ResponsiveContainer } from "recharts";

interface Props {
  data: number[];
  color?: string;
  h?: number;
  highlightLast?: boolean;
}

export function BarMini({ data, color = "var(--accent)", h = 56, highlightLast }: Props) {
  if (!data || data.length === 0) {
    return <div style={{ height: h }} />;
  }
  const series = data.map((v, i) => ({ i, v }));
  const lastIdx = series.length - 1;
  return (
    <div style={{ width: "100%", height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Bar dataKey="v" fill={color} radius={[ 2, 2, 0, 0 ]} isAnimationActive={false}>
            {highlightLast &&
              series.map((s, idx) => (
                <rect
                  key={s.i}
                  fill={idx === lastIdx ? color : `color-mix(in oklch, ${color}, transparent 50%)`}
                />
              ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
