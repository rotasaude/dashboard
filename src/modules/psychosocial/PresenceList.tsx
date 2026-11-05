// Lista de presença de um grupo do CAPS (F-31.4; P3, P12, P23, P40): feita para o celular de 375 px. As matrículas abertas do CAPS em
// cartões empilhados (sem tabela), cada pessoa um botão de linha inteira com `aria-pressed` e alvo de 44 px, a marca "presente" em texto
// (nunca só cor), o filtro por nome local, o contador (acima das vagas só avisa) e "Registrar presença" no fim.
// A presença é UMA ação coletiva (`createPsyAction`) com `group_id`, o código do grupo, `performed_at` = a data + o início do grupo (hora
// de parede da cidade) e um `{ enrollment_id }` por pessoa marcada, na ordem da lista. A crítica local é a da ação (`actionProblems`,
// máximo e autorização só na competência corrente); a do api chega toda de uma vez e o problema de cada participante vai para a linha
// dele (`participant_index`, ou o índice de `participants[i]`, ligado de volta à matrícula pela lista enviada). As marcações ficam como
// estavam. Sem duplo envio (`useFormProblems`). "Agora" é lido na hora (`now` só nos testes). Nada clínico: só nome e CNS mascarado.
import { useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPsyAction, listPsyEnrollments, type PsyAction, type PsyEnrollmentRow, type PsyGroup, type PsyOptions, type PsyUnit } from "../../lib/api";
import { todayInCity } from "../../lib/campaigns";
import {
  DATE_TIME_TEXT, FUTURE_DATE_TEXT, NOMINAL_QUERY, NO_NAME_MATCH, NO_OPEN_ENROLLMENTS, PRESENCE_NONE, PRESENCE_NOTE, PSY_ENROLLMENTS_KEY, actionInput,
  actionProblems, foldName, indexFromPath, presenceCount, psyCodeText, psyError, type ActionDraft, type PsyRefusal
} from "../../lib/psychosocial";
import type { Problem } from "../../lib/pharmacy";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, muted, row } from "../exams/styles";
import { useFormProblems } from "./useFormProblems";

// O que a presença usa do grupo (a grade traz o grupo inteiro; o Hoje, um pedaço).
export type PresenceGroup = Pick<PsyGroup, "id" | "name" | "sigtap_code" | "starts_at" | "capacity">;

export type PresenceListProps = {
  unit: PsyUnit; group: PresenceGroup; options: PsyOptions; date: string; now?: Date; onSaved(a: PsyAction): void; onCancel(): void;
};

const rowPath = (enrollmentId: string) => `en:${enrollmentId}`;
// Enter num campo do <form> faria a submissão implícita: a presença sairia pela metade, e ela é imutável.
// A linha da pessoa: o botão secundário com a borda em longhands, sempre de 2 px (só a cor muda ao marcar).
const { border: _border, ...SECONDARY_NO_BORDER } = secondaryButtonStyle;
const ROW_BUTTON = { ...SECONDARY_NO_BORDER, borderWidth: 2, borderStyle: "solid" } as const;
const blockEnter = (ev: KeyboardEvent<HTMLInputElement>) => { if (ev.key === "Enter") ev.preventDefault(); };
const OWN = (path: string) => path.startsWith("en:") || path === "performed_at" || path === "notes";

export function PresenceList({ unit, group, options, date: initialDate, now, onSaved, onCancel }: PresenceListProps) {
  const f = useFormProblems();
  const { aria, errNode, busy } = f;
  const clock = () => now ?? new Date();
  const [ date, setDate ] = useState(initialDate);
  const [ notes, setNotes ] = useState("");
  const [ filter, setFilter ] = useState("");
  const [ marked, setMarked ] = useState<ReadonlySet<string>>(() => new Set());
  // As matrículas na ordem do último envio: o índice da recusa aponta para elas.
  const sent = useRef<string[]>([]);

  const people = useQuery({
    queryKey: [ PSY_ENROLLMENTS_KEY, unit.id, "open" ], queryFn: () => listPsyEnrollments({ unitId: unit.id, status: "open" }), ...NOMINAL_QUERY
  });
  // Só os campos da linha, um a um (nada clínico mesmo que o api mande por engano), sem repetir.
  const all: PsyEnrollmentRow[] = (people.data ?? []).filter((r, i, xs) => xs.findIndex((x) => x.id === r.id) === i);
  const term = foldName(filter);
  const shown = all.filter((r) => term === "" || foldName(r.patient.name).includes(term));
  const chosen = all.filter((r) => marked.has(r.id));

  const toggle = (id: string) => {
    f.clear(rowPath(id), "participants");
    setMarked((m) => {
      const next = new Set(m);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const draft = (): ActionDraft => ({
    sigtapCode: group.sigtap_code, performedAt: `${date}T${group.starts_at}`, place: "caps", quantity: "1", notes, authorizationNumber: "",
    groupId: group.id,
    participants: chosen.map((r) => ({ kind: "enrollment", enrollmentId: r.id, name: r.patient.name, startedOn: r.started_on }))
  });
  // O índice de participante (da tela ou do api) vira a linha da matrícula; a frase é a do path do participante.
  const toRows = (list: (Problem & { code?: string; participantIndex?: number | null })[], ids: string[]): Problem[] => {
    const out = list.map((p) => {
      const index = p.participantIndex ?? indexFromPath(p.path);
      const id = index === null ? undefined : ids[index];
      if (!id) return { path: p.path, text: p.text };
      const text = p.code && indexFromPath(p.path) !== index ? psyCodeText(p.code, `participants[${index}]`) : p.text;
      return { path: rowPath(id), text };
    });
    // A linha recusada precisa estar à vista.
    if (out.some((p) => p.path.startsWith("en:"))) setFilter("");
    return out;
  };
  const check = (): Problem[] => {
    const out: Problem[] = [];
    if (chosen.length === 0) out.push({ path: "participants", text: PRESENCE_NONE });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) out.push({ path: "performed_at", text: DATE_TIME_TEXT });
    else if (date > todayInCity(clock())) out.push({ path: "performed_at", text: FUTURE_DATE_TEXT });
    if (out.length > 0) return out;
    const proc = options.procedures.find((p) => p.code === group.sigtap_code);
    const ids = chosen.map((r) => r.id);
    return toRows(actionProblems(draft(), proc, clock(), options.competence), ids);
  };
  const refused = (list: PsyRefusal[]): Problem[] => toRows(list, sent.current);
  // As frases da linha, sem repetir.
  const rowTexts = (id: string) => [ ...new Set(f.problems.filter((p) => p.path === rowPath(id)).map((p) => p.text)) ];

  return (
    <form ref={f.formRef} aria-label={`Presença: ${group.name}`} style={{ ...form, maxWidth: 560 }} noValidate onSubmit={(ev) => {
      void f.submit(ev, {
        check,
        call: () => { sent.current = chosen.map((r) => r.id); return createPsyAction(actionInput(draft(), unit.id)); },
        ok: onSaved, refused
      });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{`Presença: ${group.name}`}</p>
      <p style={muted}>{PRESENCE_NOTE}</p>

      <label style={fieldLabel}>
        Data
        <input type="date" value={date} max={todayInCity(clock())} style={inputStyle} {...aria("performed_at")} onKeyDown={blockEnter}
          onChange={(ev) => { f.clear("performed_at"); setDate(ev.target.value); }} />
      </label>
      {errNode("performed_at")}

      <label style={fieldLabel}>
        Filtrar por nome
        <input type="search" value={filter} autoComplete="off" style={inputStyle} onKeyDown={blockEnter} onChange={(ev) => setFilter(ev.target.value)} />
      </label>

      {people.isPending ? <p className="mono" style={muted}>carregando…</p>
        : people.isError ? <p role="alert" style={alert}>{psyError(people.error)}</p>
        : (
          <div role="group" aria-label="Pessoas em acompanhamento" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {all.length === 0 ? <p style={muted}>{NO_OPEN_ENROLLMENTS}</p>
              : shown.length === 0 ? <p style={muted}>{NO_NAME_MATCH}</p>
              : shown.map((r) => {
                const on = marked.has(r.id);
                const texts = rowTexts(r.id);
                const errId = `${f.fid(rowPath(r.id))}-err`;
                const cnsId = `${f.fid(rowPath(r.id))}-cns`;
                // O CNS mascarado distingue homônimos; a frase da recusa vem junto.
                const describedBy = [ r.patient.cns_masked ? cnsId : "", texts.length > 0 ? errId : "" ].filter(Boolean).join(" ");
                return (
                  <div key={r.id} data-testid={`presence-${r.id}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <button type="button" aria-pressed={on} aria-label={r.patient.name} disabled={busy}
                      {...(describedBy ? { "aria-describedby": describedBy } : {})}
                      onClick={() => toggle(r.id)}
                      style={{
                        ...ROW_BUTTON, minHeight: 44, width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                        gap: 8, textAlign: "left", borderColor: on ? "var(--ok)" : "var(--rule2)", ...(on ? { background: "var(--sunken)" } : {})
                      }}>
                      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, overflowWrap: "anywhere" }}>
                        <span>{r.patient.name}</span>
                        {r.patient.cns_masked && <span id={cnsId} className="mono" style={muted}>{`CNS ${r.patient.cns_masked}`}</span>}
                      </span>
                      <span style={{ flexShrink: 0, fontWeight: on ? 600 : 400, color: on ? "var(--ok)" : "var(--ink3)" }}>{on ? "✓ presente" : "marcar"}</span>
                    </button>
                    {texts.length > 0 && (
                      <div id={errId}>
                        {texts.map((t) => <p key={t} role="alert" tabIndex={-1} data-general="true" style={alert}>{t}</p>)}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}

      <label style={fieldLabel}>
        Evolução do grupo (opcional)
        <textarea value={notes} rows={3} style={inputStyle} {...aria("notes")} onChange={(ev) => { f.clear("notes"); setNotes(ev.target.value); }} />
      </label>
      {errNode("notes")}

      <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{presenceCount(chosen.length, group.capacity)}</p>
      {f.top(OWN)}
      <div style={row}>
        <button type="submit" style={{ ...(busy ? disabledButtonStyle : buttonStyle), minHeight: 44, flex: "1 1 200px" }} disabled={busy}>Registrar presença</button>
        <button type="button" style={{ ...(busy ? disabledButtonStyle : secondaryButtonStyle), minHeight: 44 }} disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
