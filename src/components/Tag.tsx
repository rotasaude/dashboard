// Tag/Badge — pílula de status. tone semântico; tom com nível também
// mostra a forma (■ ▲ ●) via CSS, fora do texto (global.css [data-glyph]).
import type { ReactNode } from "react";
import { toneColor, toneShape, type Tone } from "../theme/tokens";

interface Props {
  tone?: Tone | string;
  mono?: boolean;
  children: ReactNode;
}

export function Tag({ tone, mono = true, children }: Props) {
  const { fg, bg } = toneColor(tone);
  const shape = toneShape(tone);
  return (
    <span
      className={mono ? "mono" : ""}
      data-glyph={shape ?? undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10.5,
        color: fg,
        background: bg,
        border: `1px solid color-mix(in oklch, ${fg}, transparent 75%)`,
        textTransform: "lowercase",
        letterSpacing: 0.2,
        whiteSpace: "nowrap"
      }}
    >
      {children}
    </span>
  );
}
