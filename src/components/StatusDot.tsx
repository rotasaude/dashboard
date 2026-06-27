// StatusDot — bolinha de status. pulse = halo "ao vivo".
import { toneColor, type Tone } from "../theme/tokens";

interface Props {
  level?: Tone | string;
  size?: number;
  pulse?: boolean;
}

export function StatusDot({ level, size = 8, pulse }: Props) {
  const { fg } = toneColor(level);
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 999,
        background: fg,
        color: fg,
        animation: pulse ? "pulse-dot 1.6s ease-in-out infinite" : undefined,
        flexShrink: 0
      }}
    />
  );
}
