// Registro de ação da matrícula (F-31.4; §4, P3, P12, P23, P40): individual, familiar ou no território. O procedimento vem de
// `options.procedures` (a SIGTAP da competência, já filtrada pelo CBO de quem lança), agrupado pelo instrumento que o api vai
// decidir para quem tem matrícula. A crítica local (`actionProblems`) só barra o que o api já vai recusar — quantidade acima do
// máximo, autorização exigida, data futura, ação antes do início da matrícula, familiar fora do atendimento familiar, repetido —
// e dado ausente não restringe. A crítica do api (`action_rejected`) chega toda de uma vez: o problema de um participante vai para
// a linha dele (`participant_index` ou o índice de `participants[i]`), o resto no campo ou no topo, e o formulário fica intacto.
// O matriculado da tela é o primeiro participante, fixo, sempre por `enrollment_id` (P40). Outros matriculados vêm da lista de
// matrículas abertas do CAPS (lida só ao pedir); familiar sem cadastro, pelo nome. Sem duplo envio (`useFormProblems`).
// "Agora" é lido na hora (`now` só nos testes): o formulário aberto há meia hora não acha que a ação de 10 minutos atrás é futura.
// Acrescentar ou retirar participante leva o foco ao campo novo ou ao botão vizinho.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPsyAction, listPsyEnrollments, type PsyAction, type PsyOptions, type PsyPlace, type PsyProcedure, type PsyUnit } from "../../lib/api";
import {
  NOMINAL_QUERY, NO_OTHER_ENROLLMENTS, PSY_ENROLLMENTS_KEY, actionInput, actionProblems, emptyActionDraft, indexFromPath, instrumentLabel,
  maxQuantityHint, placeLabel, procInstrument, psyCodeText, psyError, type ActionDraft, type ParticipantDraft
} from "../../lib/psychosocial";
import type { Problem } from "../../lib/pharmacy";
import { cityLocalInput } from "../../lib/vaccination";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";
import { useFormProblems } from "./useFormProblems";

const MAX_PARTICIPANTS = 100;
const OWN_FIELDS = [ "sigtap_code", "performed_at", "place", "quantity", "notes", "authorization_number", "participants" ];
const INSTRUMENT_ORDER = [ "raas_psi", "bpa_i", "bpa_c" ];

// Os participantes levam um id local (a chave da linha), que nunca vai ao api (`actionInput` escolhe os campos).
type Row = ParticipantDraft & { key: string };
let rowSeq = 0;
const withKey = (p: ParticipantDraft): Row => ({ ...p, key: `participant-${++rowSeq}` });

export type ActionFormProps = {
  unit: PsyUnit; options: PsyOptions; enrollment: { id: string; name: string; startedOn: string }; now?: Date;
  onSaved(a: PsyAction): void; onCancel(): void;
};

export function ActionForm({ unit, options, enrollment, now, onSaved, onCancel }: ActionFormProps) {
  const f = useFormProblems();
  const { aria, errNode, busy } = f;
  const clock = () => now ?? new Date();
  const [ d, setD ] = useState<Omit<ActionDraft, "participants">>(() => {
    const { participants: _p, ...rest } = emptyActionDraft(clock());
    return rest;
  });
  const [ rows, setRows ] = useState<Row[]>(() => [ withKey({ kind: "enrollment", enrollmentId: enrollment.id, name: enrollment.name,
    startedOn: enrollment.startedOn }) ]);
  const [ picking, setPicking ] = useState(false);
  const [ pickId, setPickId ] = useState("");
  // `data-focus` do elemento que recebe o foco depois de mudar a lista de participantes.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    f.formRef.current?.querySelector<HTMLElement>(`[data-focus="${target}"]`)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ rows, picking ]);

  const proc: PsyProcedure | undefined = options.procedures.find((p) => p.code === d.sigtapCode);
  const draft = (): ActionDraft => ({ ...d, participants: rows.map(({ key: _k, ...p }) => p) });
  const set = (patch: Partial<typeof d>, ...paths: string[]) => { f.clear(...paths); setD((x) => ({ ...x, ...patch })); };
  // Tirar ou acrescentar participante muda os índices: as marcas dos participantes saem.
  const setParticipants = (next: Row[], focus: string) => {
    f.setProblems((ps) => ps.filter((p) => !p.path.startsWith("participants")));
    pendingFocus.current = focus;
    setRows(next);
  };
  const addFamily = () => {
    const row = withKey({ kind: "family", name: "" });
    setParticipants([ ...rows, row ], `field-${row.key}`);
  };
  // O vizinho que tem "Retirar" (o seguinte, senão o anterior que não seja o fixo); sem ele, o botão de acrescentar familiar.
  const remove = (i: number) => {
    const next = rows[i + 1] ?? (i - 1 > 0 ? rows[i - 1] : undefined);
    setParticipants(rows.filter((_, n) => n !== i), next ? `remove-${next.key}` : "add-family");
  };
  const stopPicking = () => { pendingFocus.current = "add-enrolled"; setPicking(false); setPickId(""); };

  const others = useQuery({
    queryKey: [ PSY_ENROLLMENTS_KEY, unit.id, "open" ], queryFn: () => listPsyEnrollments({ unitId: unit.id, status: "open" }),
    enabled: picking, ...NOMINAL_QUERY
  });
  // A lista de matriculados chega: o foco vai a ela.
  useEffect(() => {
    if (picking && others.isSuccess) f.formRef.current?.querySelector<HTMLElement>("[data-focus='pick']")?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ picking, others.isSuccess ]);
  const taken = new Set(rows.flatMap((r) => (r.kind === "enrollment" ? [ r.enrollmentId ] : [])));
  const pickable = (others.data ?? []).filter((e) => !taken.has(e.id));
  const include = () => {
    const e = pickable.find((x) => x.id === pickId);
    if (!e) return;
    const row = withKey({ kind: "enrollment", enrollmentId: e.id, name: e.patient.name, startedOn: e.started_on });
    setParticipants([ ...rows, row ], `remove-${row.key}`);
    setPickId("");
    setPicking(false);
  };

  // Procedimentos pelo instrumento que vale para quem tem matrícula (P3); código novo do api aparece cru.
  const groups = INSTRUMENT_ORDER.map((ins) => ({ ins, procs: options.procedures.filter((p) => procInstrument(p, true) === ins) }))
    .filter((g) => g.procs.length > 0);
  const loose = options.procedures.filter((p) => !INSTRUMENT_ORDER.includes(procInstrument(p, true) ?? ""));
  const showAuth = proc?.requires_authorization === true || d.authorizationNumber !== "" || !!f.textOf("authorization_number");
  const own = (path: string) => OWN_FIELDS.includes(path) || ((indexFromPath(path) ?? rows.length) < rows.length);
  // O problema de participante vai para a linha dele, mesmo que o api dê só o `participant_index`; a frase é a do novo path.
  const refused = (list: { code: string; path: string; text: string; participantIndex: number | null }[]): Problem[] =>
    list.map((r) => {
      if (r.participantIndex === null || indexFromPath(r.path) === r.participantIndex) return { path: r.path, text: r.text };
      const path = `participants[${r.participantIndex}]`;
      return { path, text: r.code ? psyCodeText(r.code, path) : r.text };
    });
  // As frases da linha, sem repetir dentro dela.
  const rowProblems = (i: number) => {
    const mine = f.problems.filter((p) => indexFromPath(p.path) === i);
    return mine.filter((p, n) => mine.findIndex((x) => x.text === p.text) === n);
  };

  return (
    <form ref={f.formRef} aria-label="Registrar ação" style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, {
        check: () => actionProblems(draft(), proc, clock(), options.competence), call: () => createPsyAction(actionInput(draft(), unit.id)), ok: onSaved, refused
      });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Registrar ação</p>
      {f.top(own)}

      <label style={fieldLabel}>
        Procedimento
        <select value={d.sigtapCode} style={inputStyle} {...aria("sigtap_code")}
          onChange={(ev) => {
            // O procedimento decide o familiar: as marcas dos nomes saem com as do código.
            f.setProblems((ps) => ps.filter((p) => !/^participants\[\d+\]\.family_name$/.test(p.path)));
            set({ sigtapCode: ev.target.value }, "sigtap_code", "quantity", "authorization_number", "participants");
          }}>
          <option value="">Escolha o procedimento</option>
          {groups.map((g) => (
            <optgroup key={g.ins} label={instrumentLabel(g.ins)}>
              {g.procs.map((p) => <option key={p.code} value={p.code}>{`${p.code} · ${p.name}`}</option>)}
            </optgroup>
          ))}
          {loose.map((p) => <option key={p.code} value={p.code}>{`${p.code} · ${p.name}`}</option>)}
        </select>
      </label>
      {errNode("sigtap_code")}

      <div style={row}>
        <label style={fieldLabel}>
          Data e hora
          <input type="datetime-local" value={d.performedAt} max={cityLocalInput(clock())} style={inputStyle} {...aria("performed_at")}
            onChange={(ev) => set({ performedAt: ev.target.value }, "performed_at")} />
        </label>
        <label style={fieldLabel}>
          Local
          <select value={d.place} style={inputStyle} {...aria("place")} onChange={(ev) => set({ place: ev.target.value as PsyPlace }, "place")}>
            {options.places.map((p) => <option key={p} value={p}>{placeLabel(p)}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>
          Quantidade
          <input value={d.quantity} inputMode="numeric" autoComplete="off" style={{ ...inputStyle, width: 90 }} {...aria("quantity")}
            onChange={(ev) => set({ quantity: ev.target.value }, "quantity")} />
        </label>
        {typeof proc?.max_quantity === "number" && <span style={muted}>{maxQuantityHint(proc.max_quantity)}</span>}
      </div>
      {errNode("performed_at")}{errNode("place")}{errNode("quantity")}

      {showAuth && (
        <>
          <label style={fieldLabel}>
            Número de autorização
            <input value={d.authorizationNumber} inputMode="numeric" autoComplete="off" style={inputStyle} {...aria("authorization_number")}
              onChange={(ev) => set({ authorizationNumber: ev.target.value }, "authorization_number")} />
          </label>
          {errNode("authorization_number")}
        </>
      )}

      <label style={fieldLabel}>
        Evolução
        <textarea value={d.notes} rows={4} style={inputStyle} {...aria("notes")} onChange={(ev) => set({ notes: ev.target.value }, "notes")} />
      </label>
      {errNode("notes")}

      <fieldset style={fieldset}>
        <legend style={legend}>Participantes</legend>
        {errNode("participants")}
        {rows.map((r, i) => {
          const familyPath = `participants[${i}].family_name`;
          return (
            <div key={r.key} data-testid={`participant-${i}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={row}>
                {r.kind === "family" ? (
                  <label style={fieldLabel}>
                    {`Nome do familiar ${i + 1}`}
                    <input value={r.name} autoComplete="off" style={inputStyle} data-focus={`field-${r.key}`} {...aria(familyPath)}
                      onChange={(ev) => {
                        f.clear(familyPath, `participants[${i}]`);
                        const name = ev.target.value;
                        setRows((xs) => xs.map((x) => (x.key === r.key ? { ...x, name } : x)));
                      }} />
                  </label>
                ) : <span style={{ fontSize: 13 }}>{r.name}</span>}
                {i > 0 && (
                  <button type="button" style={secondaryButtonStyle} aria-label={`Retirar participante ${i + 1}`} data-focus={`remove-${r.key}`}
                    onClick={() => remove(i)}>Retirar</button>
                )}
              </div>
              {rowProblems(i).map((p) => (
                // A frase do nome descreve o campo; as outras (linha sem campo) recebem o foco do envio recusado.
                <p key={p.text} role="alert" style={alert}
                  {...(r.kind === "family" && p.path === familyPath ? { id: `${f.fid(familyPath)}-err` } : { tabIndex: -1, "data-general": "true" })}>
                  {p.text}
                </p>
              ))}
            </div>
          );
        })}
        {picking && (
          <div style={row}>
            {others.isPending ? <p className="mono" style={muted}>carregando…</p>
              : others.isError ? <p role="alert" style={alert}>{psyError(others.error)}</p>
              : pickable.length === 0 ? <p style={muted}>{NO_OTHER_ENROLLMENTS}</p>
              : (
                <>
                  <label style={fieldLabel}>
                    Usuário matriculado
                    <select value={pickId} style={inputStyle} data-focus="pick" onChange={(ev) => setPickId(ev.target.value)}>
                      <option value="">Escolha o usuário</option>
                      {pickable.map((e) => <option key={e.id} value={e.id}>{e.patient.name}</option>)}
                    </select>
                  </label>
                  <button type="button" style={pickId ? secondaryButtonStyle : disabledButtonStyle} disabled={!pickId} onClick={include}>Incluir</button>
                </>
              )}
            <button type="button" style={secondaryButtonStyle} onClick={stopPicking}>Desistir</button>
          </div>
        )}
        {rows.length < MAX_PARTICIPANTS && (
          <div style={row}>
            <button type="button" style={secondaryButtonStyle} data-focus="add-enrolled" onClick={() => setPicking(true)}>Adicionar usuário matriculado</button>
            <button type="button" style={secondaryButtonStyle} data-focus="add-family" onClick={addFamily}>
              Adicionar familiar sem cadastro
            </button>
          </div>
        )}
      </fieldset>

      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Salvar ação</button>
        <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
