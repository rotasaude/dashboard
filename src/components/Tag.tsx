// Tag/Badge — pílula de status. tone semântico.
import type { ReactNode } from "react";
import { toneColor, type Tone } from "../theme/tokens";

interface Props {
  tone?: Tone | string;
  mono?: boolean;
  children: ReactNode;
}

export function Tag({ tone, mono = true, children }: Props) {
  const { fg, bg } = toneColor(tone);
  return (
    <span
      className={mono ? "mono" : ""}
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
