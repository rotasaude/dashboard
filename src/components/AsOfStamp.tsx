// AsOfStamp — "dados de <timestamp>" + SourceBadge. Vai no header do Panel.
import { fmtTime } from "../lib/format";
import { SourceBadge } from "./SourceBadge";

interface Props {
  at: string;
  kind?: "live" | "proj";
}

export function AsOfStamp({ at, kind }: Props) {
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 10.5,
        color: "var(--ink3)"
      }}
    >
      <span>dados de {fmtTime(at)}</span>
      <SourceBadge kind={kind} compact />
    </span>
  );
}
