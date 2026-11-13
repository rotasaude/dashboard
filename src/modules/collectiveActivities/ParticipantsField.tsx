// src/modules/collectiveActivities/ParticipantsField.tsx
// Os participantes da atividade coletiva (módulo 24b, F-24.12): cada um escolhido no `PersonPick` (escopo `collective_activities`),
// com avaliação alterada, peso e altura e, só nas práticas do Programa Nacional de Controle do Tabagismo (`smokingAllowed`), o
// tabagismo. A regra da lista vem do dado (`fieldRule`); `forbidden` não desenha nada. Quem não tem CPF nem CNS leva o aviso
// (`activityWarnings`), sem bloquear. A recusa do api de um participante abre o `PersonPick` DELE (`pick.index`); o
// `duplicate_participant` confirmável oferece "É outra pessoa". Enviando ou travado (`frozen`), tudo fica indisponível e o
// seletor sai: o reenvio leva os participantes do primeiro envio e a tela não pode mostrar outros.
import type { ReactNode } from "react";
import type { FieldRule } from "../../lib/api";
import { type ParticipantDraft } from "../../lib/collectiveActivities";
import { NO_NAME } from "../../lib/territoryRegistry";
import type { Problem } from "../../lib/pharmacy";
import { inputStyle, secondaryButtonStyle, disabledButtonStyle } from "../../components/formStyles";
import { alert, box, checkLabel, fieldLabel, fieldset, legend, muted, row } from "../exams/styles";
import { PersonPick, type PersonRestart, type PickedPerson } from "../homeVisits/PersonPick";
import type { QuickInitial, QuickRefusal } from "../homeVisits/QuickPatientForm";

// O seletor aberto: `index` null = participante novo; número = trocar (ou corrigir) aquele participante.
export type ParticipantPick = { n: number; index: number | null; restart?: PersonRestart; initialNew?: QuickInitial; refusal?: QuickRefusal | null };
export type ParticipantPatch = Partial<Pick<ParticipantDraft, "altered" | "weight" | "height" | "smoking">>;

export const participantName = (p: ParticipantDraft): string => (p.kind === "patient" ? p.displayName ?? NO_NAME : p.patient.full_name || NO_NAME);
const MEASURE = /\.measurements\./;

export function ParticipantsField({ rule, participants, smoking, today, frozen, pick, confirmable, problems, warnings, aria, errNode,
  onPick, onChoose, onPatch, onRemove, onConfirmOther }: {
  rule: FieldRule; participants: ParticipantDraft[]; smoking: boolean; today: string; frozen: boolean; pick: ParticipantPick | null;
  confirmable: number[]; problems: Problem[]; warnings: Problem[];
  aria(path: string): Record<string, unknown>; errNode(path: string): ReactNode;
  onPick(p: ParticipantPick | null): void; onChoose(index: number | null, c: PickedPerson): void; onPatch(index: number, patch: ParticipantPatch): void;
  onRemove(index: number): void; onConfirmOther(index: number): void;
}) {
  if (rule === "forbidden") return null;
  const picker = (index: number | null) => (pick && pick.index === index && !frozen ? (
    <PersonPick key={pick.n} scope="collective_activities" today={today} restart={pick.restart} initialNew={pick.initialNew} refusal={pick.refusal ?? null}
      onChoose={(c) => onChoose(index, c)} onCancel={() => onPick(null)} />
  ) : null);
  const button = (frozenStyle: boolean) => (frozenStyle ? disabledButtonStyle : secondaryButtonStyle);
  const listWarnings = warnings.filter((w) => w.path === "participants");

  return (
    <fieldset style={fieldset} {...aria("participants")}>
      <legend style={legend}>{rule === "required" ? "Participantes (obrigatório)" : "Participantes"}</legend>
      {participants.length === 0 && <p style={muted}>Nenhum participante na lista.</p>}
      {participants.map((p, i) => {
        const at = `participants[${i}]`;
        const name = participantName(p);
        // As recusas do participante que não são de medida; com o seletor dele aberto, ele mostra as da pessoa.
        const own = problems.filter((x) => (x.path === at || x.path.startsWith(`${at}.`)) && !MEASURE.test(x.path)
          && !(pick?.index === i && !frozen && x.path !== at));
        const texts = [ ...new Set(own.map((x) => x.text)) ];
        const warning = warnings.find((w) => w.path === at);
        return (
          <div key={i} role="group" aria-label={`Participante ${i + 1} — ${name}`} style={box}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{name}</p>
            {warning && <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>{warning.text}</p>}
            <label style={checkLabel}>
              <input type="checkbox" checked={p.altered} disabled={frozen} onChange={(e) => onPatch(i, { altered: e.target.checked })} />
              {`Avaliação alterada — ${name}`}
            </label>
            <div style={row}>
              <label style={{ ...fieldLabel, flex: "1 1 120px" }}>
                {`Peso (kg) — ${name}`}
                <input value={p.weight} inputMode="decimal" disabled={frozen} style={inputStyle} {...aria(`${at}.measurements.weight_kg`)}
                  onChange={(e) => onPatch(i, { weight: e.target.value })} />
              </label>
              <label style={{ ...fieldLabel, flex: "1 1 120px" }}>
                {`Altura (cm) — ${name}`}
                <input value={p.height} inputMode="decimal" disabled={frozen} style={inputStyle} {...aria(`${at}.measurements.height_cm`)}
                  onChange={(e) => onPatch(i, { height: e.target.value })} />
              </label>
            </div>
            {errNode(`${at}.measurements.weight_kg`)}
            {errNode(`${at}.measurements.height_cm`)}
            {smoking && (
              <div style={row}>
                <label style={checkLabel}>
                  <input type="checkbox" checked={!!p.smoking?.quit} disabled={frozen}
                    onChange={(e) => onPatch(i, { smoking: smokingOf({ quit: e.target.checked, dropped_out: !!p.smoking?.dropped_out }) })} />
                  {`Cessou o hábito de fumar — ${name}`}
                </label>
                <label style={checkLabel}>
                  <input type="checkbox" checked={!!p.smoking?.dropped_out} disabled={frozen}
                    onChange={(e) => onPatch(i, { smoking: smokingOf({ quit: !!p.smoking?.quit, dropped_out: e.target.checked }) })} />
                  {`Abandonou o grupo — ${name}`}
                </label>
              </div>
            )}
            {texts.map((t) => <p key={t} role="alert" style={alert}>{t}</p>)}
            <div style={row}>
              {confirmable.includes(i) && p.kind === "new" && (
                <button type="button" disabled={frozen} style={button(frozen)} onClick={() => onConfirmOther(i)}>É outra pessoa</button>
              )}
              {!(pick?.index === i && !frozen) && (
                <button type="button" disabled={frozen} style={button(frozen)}
                  onClick={() => onPick({ n: (pick?.n ?? 0) + 1, index: i, initialNew: p.kind === "new" ? p.patient : undefined })}>
                  {`Trocar — ${name}`}
                </button>
              )}
              <button type="button" disabled={frozen} style={button(frozen)} onClick={() => onRemove(i)}>{`Retirar — ${name}`}</button>
            </div>
            {picker(i)}
          </div>
        );
      })}
      {listWarnings.map((w) => <p key={w.text} style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>{w.text}</p>)}
      {errNode("participants")}
      {picker(null) ?? (
        <div style={row}>
          <button type="button" disabled={frozen} style={button(frozen)} onClick={() => onPick({ n: (pick?.n ?? 0) + 1, index: null })}>
            Adicionar participante
          </button>
        </div>
      )}
    </fieldset>
  );
}

// Nenhuma das duas marcas = sem tabagismo no corpo.
const smokingOf = (s: { quit: boolean; dropped_out: boolean }) => (s.quit || s.dropped_out ? s : null);
