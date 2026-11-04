// Correção de presença pela central (módulo 30, F-30.4): só em viagem concluída, com motivo (10–500) e segundo fator. Um seletor por
// passageiro e por acompanhante (só `boarded`/`no_show`); vão só os itens alterados, e cada item leva `attendance` (o api exige),
// com `companion_attendance` só quando o acompanhante mudou. Recusas traduzidas: `tfd_leg_done`, `passenger_anonymized`, `invalid_transition`.
import { useRef, useState } from "react";
import { correctAttendance, type AttendanceItem, type Trip, type TripAttendance, type TripPassenger } from "../../lib/api";
import { LocalRefusal, attendanceLabel, isStaleRefusal, reasonProblemText, refusalTexts, transportRefusals } from "../../lib/transport";
import { NO_NAME } from "../../lib/territoryRegistry";
import { SensitiveAction } from "../../components/SensitiveAction";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { fieldLabel, fieldset, legend, stack } from "../exams/styles";

const NOTHING_TEXT = "mude ao menos uma presença";
const CHOICES: TripAttendance[] = [ "boarded", "no_show" ];

const nameOf = (p: TripPassenger) => p.patient.display_name ?? NO_NAME;
type Draft = Record<string, { attendance: string; companion: string | null }>;

function draftFrom(t: Trip): Draft {
  return Object.fromEntries(t.passengers.map((p) => [ p.id, { attendance: p.attendance, companion: p.companion ? p.companion_attendance ?? "pending" : null } ]));
}

// Opções: as duas aceitas; um valor atual fora delas (código novo ou "pending") aparece cru/rotulado, sem sumir.
function Choice({ id, label, value, disabled, onChange }: { id: string; label: string; value: string; disabled: boolean; onChange(v: string): void }) {
  const options = CHOICES.includes(value as TripAttendance) ? CHOICES : [ value, ...CHOICES ];
  return (
    <div style={fieldLabel}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} style={inputStyle} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o} disabled={!CHOICES.includes(o as TripAttendance)}>{attendanceLabel(o)}</option>)}
      </select>
    </div>
  );
}

export function AttendanceCorrection({ trip, onCorrected, onReload, onGoToSecurity }: {
  trip: Trip; onCorrected(t: Trip): void; onReload?(): void; onGoToSecurity?(): void;
}) {
  const [ open, setOpen ] = useState(false);
  const [ draft, setDraft ] = useState<Draft>(() => draftFrom(trip));
  // Enquanto a correção corre, os seletores ficam travados (o que vai é o lido no início do envio).
  const [ running, setRunning ] = useState(false);
  // O que foi enviado, na ordem: a recusa `items.N.*` vira a frase com o nome do passageiro (nada é destacado nesta tela; C5).
  const sent = useRef<AttendanceItem[]>([]);
  if (trip.status !== "done" || trip.passengers.length === 0) return null;

  function items(): AttendanceItem[] {
    const out: AttendanceItem[] = [];
    for (const p of trip.passengers) {
      const d = draft[p.id];
      if (!d) continue;
      const patientChanged = d.attendance !== p.attendance;
      const companionChanged = p.companion !== null && d.companion !== (p.companion_attendance ?? "pending");
      if (!patientChanged && !companionChanged) continue;
      out.push({ passenger_id: p.id, attendance: d.attendance as TripAttendance, ...(companionChanged ? { companion_attendance: d.companion as TripAttendance } : {}) });
    }
    return out;
  }

  if (!open) {
    return (
      <button type="button" style={{ ...secondaryButtonStyle, alignSelf: "flex-start" }}
        onClick={() => { setDraft(draftFrom(trip)); setOpen(true); }}>Corrigir presença</button>
    );
  }

  const setOne = (id: string, patch: Partial<Draft[string]>) => setDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  return (
    <div style={stack}>
      <fieldset style={fieldset}>
        <legend style={legend}>Presenças</legend>
        {trip.passengers.map((p) => {
          const d = draft[p.id] ?? { attendance: p.attendance, companion: null };
          return (
            <div key={p.id} style={stack}>
              <Choice id={`fix-${trip.id}-${p.id}`} label={`Presença de ${nameOf(p)}`} value={d.attendance} disabled={running} onChange={(v) => setOne(p.id, { attendance: v })} />
              {p.companion && (
                <Choice id={`fix-${trip.id}-${p.id}-companion`} label={`Presença do acompanhante de ${nameOf(p)}`} value={d.companion ?? "pending"} disabled={running}
                  onChange={(v) => setOne(p.id, { companion: v })} />
              )}
            </div>
          );
        })}
      </fieldset>
      <SensitiveAction title="Corrigir presença" requiresStepUp onGoToSecurity={onGoToSecurity}
        description="A presença fechada só muda por aqui, com motivo; a mudança fica no histórico."
        fields={[ { name: "reason", label: "Motivo", required: true, multiline: true } ]}
        translateError={(err) => refusalTexts(err, (e) => transportRefusals(e).map((r) => {
          const m = r.code === "invalid_request" ? /^items\.(\d+)(\.|$)/.exec(r.path) : null;
          const p = m ? trip.passengers.find((x) => x.id === sent.current[Number(m[1])]?.passenger_id) : undefined;
          return p ? { ...r, text: `confira a presença de ${nameOf(p)}` } : r;
        }))}
        run={async (values) => {
          const list = items();
          if (list.length === 0) throw new LocalRefusal(NOTHING_TEXT);
          const reason = (values.reason ?? "").trim();
          const short = reasonProblemText(reason);
          if (short) throw new LocalRefusal(short);
          sent.current = list;
          setRunning(true);
          try {
            const t = await correctAttendance(trip.id, { items: list, reason });
            onCorrected(t);
          } catch (err) {
            if (isStaleRefusal(err)) onReload?.();
            throw err;
          } finally { setRunning(false); }
        }}
        onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
    </div>
  );
}
