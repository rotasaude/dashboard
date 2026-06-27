// Sparkline — linha + área. Recharts AreaChart sem eixos.
import { Area, AreaChart, ResponsiveContainer } from "recharts";

interface Props {
  data: number[];
  color?: string;
  h?: number;
}

export function Sparkline({ data, color = "var(--accent)", h = 32 }: Props) {
  if (!data || data.length === 0) return <div style={{ height: h }} />;
  const series = data.map((v, i) => ({ i, v }));
  return (
    <div style={{ width: "100%", height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.4}
            fill="url(#spark-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
