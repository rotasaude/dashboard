// src/modules/vectorControl/CountForm.tsx
// Contagem de ovos da palheta pela coordenação ou pelo laboratório (módulo 35a, F-35.5; contrato §6, §17; Q9, Q23).
// POST /vector_control/ovitrap_readings/:id/count com `{ egg_count }` na primeira contagem e `{ egg_count, count_note }` na
// correção (count_reading.rb): a nota só existe na correção (a primeira com nota → 422 count_note), e a correção que mantém a
// contagem → 422 egg_count (`countProblems` recusa os dois antes). A nota vai sem as pontas (`optionalNote`), nunca sai do
// campo e é texto congelado (FrozenTextNotice).
// Tela velha (o pai relê a lista UMA vez, sem reenvio): 404, `reading_not_countable` (palheta que deixou de ser contável) e a
// primeira contagem recusada em count_note (outra pessoa contou antes: a leitura virou correção). Rede ou 5xx: a contagem não
// tem client_uuid, então não se sabe se gravou — o formulário fecha e a lista é relida.
import { useState, type FormEvent } from "react";
import { countOvitrapReading, errorCode, type ApiError, type OvitrapReading } from "../../lib/api";
import { fmtNumber } from "../../lib/format";
import { fmtDay, isNetworkOrServer } from "../../lib/homeVisits";
import { countProblems, isVectorStale, optionalNote, vectorRefusals } from "../../lib/vectorControl";
import { weekLabel } from "../../lib/surveillance";
import { useFormProblems } from "../psychosocial/useFormProblems";
import { FrozenTextNotice } from "../../components/FrozenTextNotice";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { fieldLabel, form, muted, row } from "../exams/styles";

export const COUNT_STALE_REREAD = "a lista foi relida";
export const COUNT_RACED = "esta palheta já tem contagem — a lista foi relida; para mudar, use Corrigir contagem";
export const COUNT_UNCERTAIN = "não foi possível confirmar a contagem — a lista foi relida; confira a palheta antes de contar de novo";

const OWN = [ "egg_count", "count_note" ];

// "1 ovo", "0 ovos", "1.234 ovos".
export const eggsText = (n: number): string => `${fmtNumber(n)} ${n === 1 ? "ovo" : "ovos"}`;

// A primeira contagem recusada em count_note: a tela nunca manda nota nela, então a palheta já foi contada do outro lado.
const raced = (err: unknown, corrected: boolean): boolean =>
  !corrected && errorCode(err) === "invalid_request" && ((err as ApiError).body as { path?: string } | null)?.path === "count_note";

export function CountForm({ reading, corrected, onDone, onStale, onCancel }: {
  reading: OvitrapReading; corrected: boolean; onDone(r: OvitrapReading): void; onStale(text: string): void; onCancel(): void;
}) {
  const f = useFormProblems({
    refusals: (err) => vectorRefusals(err).map((r) => ({ ...r, participantIndex: null })),
    isStale: (err) => isVectorStale(err) || errorCode(err) === "reading_not_countable" || raced(err, corrected) || isNetworkOrServer(err)
  });
  const [ eggs, setEggs ] = useState("");
  const [ note, setNote ] = useState("");
  const number = reading.ovitrap.number;
  const noteId = `count-note-notice-${reading.id}`;

  function submit(ev: FormEvent) {
    void f.submit(ev, {
      check: () => countProblems({ eggs, note: corrected ? note : "" }, corrected, corrected ? reading.egg_count : null),
      call: () => countOvitrapReading(reading.id, { egg_count: Number(eggs.trim()), ...(corrected ? optionalNote("count_note", note) : {}) }),
      ok: onDone,
      stale: (text, err) => {
        if (isNetworkOrServer(err)) onStale(COUNT_UNCERTAIN);
        else if (raced(err, corrected)) onStale(COUNT_RACED);
        else onStale(`${text} — ${COUNT_STALE_REREAD}`);
      }
    });
  }

  const busy = f.busy;
  const title = corrected ? `Corrigir contagem — ovitrampa ${number}` : `Contar ovos — ovitrampa ${number}`;
  return (
    <form ref={f.formRef} noValidate style={form} aria-label={title} onSubmit={submit}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>{title}</p>
      <span style={muted}>
        {[ `Quarteirão ${reading.city_block.number}`, reading.neighborhood.name, weekLabel(reading.epi_week),
          reading.collected_on ? `coletada em ${fmtDay(reading.collected_on)}` : null,
          corrected && reading.egg_count !== null ? `contagem atual: ${eggsText(reading.egg_count)}` : null ].filter(Boolean).join(" · ")}
      </span>

      <label style={fieldLabel}>
        Ovos
        <input value={eggs} inputMode="numeric" autoComplete="off" disabled={busy} style={inputStyle} {...f.aria("egg_count")}
          onChange={(e) => { setEggs(e.target.value); f.clear("egg_count"); }} />
      </label>
      {f.errNode("egg_count")}

      {corrected && (
        <>
          <label style={fieldLabel}>
            Nota da correção
            <textarea value={note} disabled={busy} style={{ ...inputStyle, minHeight: 56 }} {...f.aria("count_note")}
              aria-describedby={[ f.aria("count_note")["aria-describedby"], noteId ].filter(Boolean).join(" ")}
              onChange={(e) => { setNote(e.target.value); f.clear("count_note", "egg_count"); }} />
          </label>
          <FrozenTextNotice id={noteId} />
          {f.errNode("count_note")}
        </>
      )}

      {f.top((p) => OWN.includes(p))}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>
          {corrected ? "Registrar correção" : "Registrar contagem"}
        </button>
        <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
      </div>
    </form>
  );
}
