// Odontograma (F-28.3). Cada dente é um botão (tabindex móvel); as faces do desenho são atalho de ponteiro.
// A situação nunca é só cor: sigla visível + aria-label completo. Regras em `lib/dental`.
import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { Dentition, DentalVocabulary, OdontogramTooth, ToothFace } from "../../lib/api";
import { chartRows, faceLayout, isUpperTooth, situationAbbr, situationTone, toothAriaLabel } from "../../lib/dental";
import { SegmentedControl } from "../../shell/SegmentedControl";
import { toneColor } from "../../theme/tokens";

export interface ToothSelection { tooth: string; face: ToothFace | null }

interface Props {
  teeth: OdontogramTooth[];
  dentition: Dentition;
  situations?: DentalVocabulary["situations"];
  pending?: Record<string, number>;
  selected: ToothSelection | null;
  onSelect(sel: ToothSelection | null): void;
  onDentitionChange?(d: Dentition): void;
}

const DENTITIONS: { key: Dentition; label: string }[] = [ { key: "permanent", label: "Permanente" }, { key: "deciduous", label: "Decídua" }, { key: "mixed", label: "Mista" } ];
const CELL = 44;
const isUpperRow = (row: string[]) => isUpperTooth(row[0]);
const empty = (code: string | null | undefined) => !code || code === "none";

// Posição vizinha numa linha acima/abaixo: mesma distância da linha média, do mesmo lado; sem par, a mais externa.
function verticalTarget(from: string[], index: number, to: string[]): string {
  const h = from.length / 2, h2 = to.length / 2;
  const j = index < h ? Math.max(0, h2 - (h - index)) : Math.min(to.length - 1, h2 + (index - h));
  return to[j];
}

function toothStyle(selected: boolean, pendingMark: boolean): CSSProperties {
  return {
    minWidth: CELL, minHeight: 56, padding: 2, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
    background: selected ? "var(--sunken)" : "var(--panel)", color: "var(--ink)", cursor: "pointer", borderRadius: 6,
    border: `${selected ? 2 : 1}px ${pendingMark ? "dashed" : "solid"} ${selected ? "var(--accent)" : "var(--rule)"}`
  };
}

function faceStyle(code: string | null | undefined, chosen: boolean): CSSProperties {
  const c = toneColor(code ? situationTone(code) : undefined);
  return { background: code ? c.bg : "var(--sunken)", border: `${chosen ? "3px double" : "1px solid"} ${chosen ? "var(--accent)" : code ? c.fg : "var(--rule)"}`, boxSizing: "border-box" };
}

export function Odontogram({ teeth, dentition, situations, pending, selected, onSelect, onDentitionChange }: Props) {
  const rows = useMemo(() => chartRows(dentition), [ dentition ]);
  const byTooth = useMemo(() => new Map(teeth.map((t) => [ t.tooth, t ])), [ teeth ]);
  const [ focused, setFocused ] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const faceHandled = useRef(false); // pointerUp na face já selecionou; o click seguinte não pode sobrescrever

  const all = rows.flat();
  const stop = focused && all.includes(focused) ? focused : selected && all.includes(selected.tooth) ? selected.tooth : rows[0][0];

  const focusTooth = (tooth: string) => root.current?.querySelector<HTMLButtonElement>(`[data-tooth="${tooth}"]`)?.focus();

  function onKey(e: KeyboardEvent<HTMLButtonElement>, tooth: string) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const r = rows.findIndex((row) => row.includes(tooth));
    const row = rows[r], i = row.indexOf(tooth);
    let next: string | undefined;
    if (e.key === "ArrowLeft") next = row[i - 1];
    else if (e.key === "ArrowRight") next = row[i + 1];
    else if (e.key === "Home") next = row[0];
    else if (e.key === "End") next = row[row.length - 1];
    else if (e.key === "ArrowUp" && r > 0) next = verticalTarget(row, i, rows[r - 1]);
    else if (e.key === "ArrowDown" && r < rows.length - 1) next = verticalTarget(row, i, rows[r + 1]);
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect({ tooth, face: null }); return; }
    else if (e.key === "Escape") { e.preventDefault(); onSelect(null); return; }
    else return;
    e.preventDefault();
    if (next) focusTooth(next);
  }

  function onFacePointer(e: PointerEvent<HTMLSpanElement>, tooth: string, face: ToothFace) {
    if (e.button) return; // só o botão primário; jsdom sem PointerEvent não traz button
    e.currentTarget.closest("button")?.focus();
    faceHandled.current = true;
    onSelect({ tooth, face });
  }

  function renderTooth(tooth: string, upper: boolean) {
    const t = byTooth.get(tooth);
    const count = pending?.[tooth] ?? 0;
    const isSel = selected?.tooth === tooth;
    const lay = faceLayout(tooth);
    const faceAt = { [lay.top]: "top", [lay.bottom]: "bottom", [lay.left]: "left", [lay.right]: "right", O: "center" } as Record<ToothFace, string>;
    const hasMore = !empty(t?.root) || Object.values(t?.faces ?? {}).some((c) => !empty(c));
    const abbr = (empty(t?.situation) ? "—" : situationAbbr(t!.situation!, situations, "crown")) + (hasMore ? "+" : "");
    const rootCode = empty(t?.root) ? null : t!.root!;
    const rootBar = (
      <span data-part="root" aria-hidden="true" style={{ display: "block", width: 14, height: 4, borderRadius: 2, ...faceStyle(rootCode, false) }} />
    );
    return (
      <button key={tooth} type="button" data-tooth={tooth} aria-label={toothAriaLabel(t, tooth, situations, count)}
        aria-pressed={isSel} tabIndex={tooth === stop ? 0 : -1} style={toothStyle(isSel, count > 0)}
        onFocus={() => setFocused(tooth)} onPointerDown={() => { faceHandled.current = false; }} onPointerCancel={() => { faceHandled.current = false; }} onKeyDown={(e) => onKey(e, tooth)}
        onClick={() => { if (faceHandled.current) { faceHandled.current = false; return; } onSelect({ tooth, face: null }); }}>
        {!upper && rootBar}
        <span className="mono" style={{ fontSize: 11, fontWeight: 600 }}>{tooth}{count > 0 ? "•" : ""}</span>
        <span aria-hidden="true" style={{ display: "grid", gridTemplate: "7px 10px 7px / 7px 10px 7px", width: 24, height: 24 }}>
          {([ "top", "left", "center", "right", "bottom" ] as const).map((pos) => {
            const face = (Object.keys(faceAt) as ToothFace[]).find((f) => faceAt[f] === pos)!;
            const grid = { top: "1 / 2 / 2 / 3", left: "2 / 1 / 3 / 2", center: "2 / 2 / 3 / 3", right: "2 / 3 / 3 / 4", bottom: "3 / 2 / 4 / 3" }[pos];
            return <span key={pos} data-face={face} style={{ gridArea: grid, ...faceStyle(t?.faces?.[face], isSel && selected?.face === face) }}
              onPointerUp={(e) => onFacePointer(e, tooth, face)} />;
          })}
        </span>
        <span className="mono" style={{ fontSize: 10, color: "var(--ink2)" }}>{abbr}</span>
        {upper && rootBar}
      </button>
    );
  }

  const innerMin = 16 * (CELL + 2) + 2;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: "100%" }}>
      {onDentitionChange && <div><SegmentedControl options={DENTITIONS} value={dentition} onChange={onDentitionChange} /></div>}
      <div role="group" aria-label="Odontograma" ref={root} style={{ overflowX: "auto", maxWidth: "100%" }}>
        <div style={{ minWidth: innerMin, display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.map((row, r) => {
            const upper = isUpperRow(row), h = row.length / 2;
            const boundary = r < rows.length - 1 && upper && !isUpperRow(rows[r + 1]);
            return (
              <div key={row[0]} style={{ display: "contents" }}>
                <div style={{ display: "grid", gap: 2, margin: "0 auto", width: `${(row.length / 16) * 100}%`, minWidth: row.length * (CELL + 2) + 2,
                  gridTemplateColumns: `repeat(${h}, minmax(${CELL}px, 1fr)) 2px repeat(${h}, minmax(${CELL}px, 1fr))` }}>
                  {row.slice(0, h).map((tooth) => renderTooth(tooth, upper))}
                  <span aria-hidden="true" style={{ background: "var(--rule2, var(--rule))" }} />
                  {row.slice(h).map((tooth) => renderTooth(tooth, upper))}
                </div>
                {boundary && <hr aria-hidden="true" style={{ width: "100%", border: 0, borderTop: "2px solid var(--rule)", margin: "2px 0" }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
