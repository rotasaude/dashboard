// StatusDot — marcador de status. pulse = halo "ao vivo". A forma acompanha
// o nível (■ alto · ▲ moderado · ● demais), para a cor não ser o único sinal.
import { toneColor, toneShape, type Tone } from "../theme/tokens";

interface Props {
  level?: Tone | string;
  size?: number;
  pulse?: boolean;
}

const TRIANGLE = "polygon(50% 0, 100% 100%, 0 100%)";

export function StatusDot({ level, size = 8, pulse }: Props) {
  const { fg } = toneColor(level);
  const shape = toneShape(level) ?? "circle";
  const animation = pulse ? "pulse-dot 1.6s ease-in-out infinite" : undefined;
  // Triângulo é recortado por clip-path, que cortaria também o halo da
  // animação: o halo fica num invólucro sem recorte (A-04).
  if (shape === "triangle" && pulse) {
    return (
      <span aria-hidden data-shape={shape}
        style={{ display: "inline-block", width: size, height: size, borderRadius: 999, color: fg, animation, flexShrink: 0 }}>
        <span style={{ display: "block", width: size, height: size, clipPath: TRIANGLE, background: fg }} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      data-shape={shape}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: shape === "circle" ? 999 : shape === "square" ? 1 : 0,
        clipPath: shape === "triangle" ? TRIANGLE : undefined,
        background: fg,
        color: fg,
        animation,
        flexShrink: 0
      }}
    />
  );
}
