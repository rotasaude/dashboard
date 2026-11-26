// Salas de vacina (módulo 29; F-29.1): a tabela, "Nova sala" e a edição. A unidade é de uma unidade ativa que ainda não tem sala (na
// edição, a da própria sala, que não muda). Nome de 3 a 120. Conferido aqui antes da confirmação e de novo no api; a escrita passa
// pelo step-up e a tabela é relida depois. Durante a confirmação o formulário fica à vista, parado: a recusa do api (unit_taken,
// location_has_stock…) aparece junto dele.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, createVaccineRoom, errorCode, setColdChainCentralCnes, updateVaccineRoom } from "../../lib/api";
import type { AdminLocation, HealthUnitRow, VaccineRoom } from "../../lib/api";
import { BNAFAR_ERRORS } from "../../lib/bnafarErrors";
import { cnesProblem, docOf } from "../../lib/bnafar";
import { vaccinationError } from "../../lib/vaccination";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, checkLabel, fieldLabel, form, row, stack } from "../exams/styles";
import { fieldBox, fieldsetStyle, hintStyle, statusStyle } from "../regulation/styles";
import { staffCount } from "../pharmacy/LocationsPanel";

const NAME_TEXT = "o nome da sala tem de 3 a 120 caracteres";
const UNIT_TEXT = "escolha a unidade de saúde da sala";

type Editor = VaccineRoom | "new" | null;

export function RoomsPanel({ rooms, units, selectedId, onSelectStaff, onSaved, onGoToSecurity }: {
  rooms: VaccineRoom[]; units: HealthUnitRow[]; selectedId: string | null;
  onSelectStaff(id: string): void; onSaved(): void; onGoToSecurity?(): void;
}) {
  const [ editor, setEditor ] = useState<Editor>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const open = (next: Editor) => { setNotice(null); setEditor(next); };

  return (
    <div style={stack}>
      <div role="status">{notice && <p style={statusStyle}>{notice}</p>}</div>
      <Panel title="Salas de vacina" sub="uma sala por unidade de saúde"
        right={<button type="button" style={secondaryButtonStyle} onClick={() => open("new")}>Nova sala</button>}>
        <DataTable<VaccineRoom>
          cols={[
            { label: "Unidade", w: "1.4fr", render: (r) => r.health_unit.name },
            { label: "Sala", w: "1.8fr", card: "title", render: (r) => r.name },
            { label: "Situação", w: "90px", render: (r) => <Tag tone={r.active ? "ok" : "neutral"}>{r.active ? "ativa" : "inativa"}</Tag> },
            {
              label: "Vacinadores", w: "1fr", render: (r) => (
                <button type="button" style={selectedId === r.id ? buttonStyle : secondaryButtonStyle}
                  aria-label={`${staffCount(r.staff.length)}, Equipe — ${r.name}`} aria-pressed={selectedId === r.id} onClick={() => onSelectStaff(r.id)}>
                  {staffCount(r.staff.length)}
                </button>
              )
            },
            {
              label: "Ação", w: "90px", card: "actions" as const,
              render: (r) => <button type="button" style={secondaryButtonStyle} aria-label={`Editar — ${r.name}`} onClick={() => open(r)}>Editar</button>
            }
          ]}
          rows={rooms} rowKey={(r) => r.id} empty="nenhuma sala de vacina cadastrada"
        />
      </Panel>
      {editor && (
        <RoomForm key={editor === "new" ? "new" : editor.id} room={editor === "new" ? null : editor} units={units} rooms={rooms}
          onSaved={(message) => { setEditor(null); setNotice(message); onSaved(); }} onCancel={() => setEditor(null)} onGoToSecurity={onGoToSecurity} />
      )}
    </div>
  );
}

function RoomForm({ room, units, rooms, onSaved, onCancel, onGoToSecurity }: {
  room: VaccineRoom | null; units: HealthUnitRow[]; rooms: VaccineRoom[];
  onSaved(message: string): void; onCancel(): void; onGoToSecurity?(): void;
}) {
  const [ name, setName ] = useState(room?.name ?? "");
  const [ unitId, setUnitId ] = useState(room?.health_unit.id ?? "");
  const [ active, setActive ] = useState(room?.active ?? true);
  const [ problems, setProblems ] = useState<string[]>([]);
  const [ confirming, setConfirming ] = useState(false);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { setProblems([]); set(v); };
  const first = useRef<HTMLSelectElement | HTMLInputElement | null>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const ids = useId();
  const unitHint = `${ids}-unit`;
  const nameHint = `${ids}-name`;

  const taken = new Set(rooms.map((r) => r.health_unit.id));
  const options = units.filter((u) => u.active && !taken.has(u.id));

  function review(e?: FormEvent) {
    e?.preventDefault();
    const length = name.trim().length;
    const found = [ room === null && unitId === "" ? UNIT_TEXT : null, length < 3 || length > 120 ? NAME_TEXT : null ].filter((p): p is string => p !== null);
    setProblems(found);
    if (found.length === 0) setConfirming(true);
  }

  const label = name.trim();
  return (
    <section aria-label={room ? "Editar sala" : "Nova sala"} style={box}>
      <form onSubmit={review} noValidate>
      <fieldset disabled={confirming} style={fieldsetStyle}>
        <div style={form}>
          <div style={fieldBox}>
            <label style={fieldLabel}>
              Unidade
              {room ? (
                <select value={unitId} disabled aria-describedby={unitHint} style={inputStyle}><option value={room.health_unit.id}>{room.health_unit.name}</option></select>
              ) : (
                <select ref={(el) => { first.current = el; }} value={unitId} aria-describedby={unitHint} aria-invalid={problems.includes(UNIT_TEXT) || undefined} style={inputStyle} onChange={(e) => touch(setUnitId)(e.target.value)}>
                  <option value="">escolha</option>
                  {options.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              )}
            </label>
            <span id={unitHint} style={hintStyle}>{room ? "A unidade não muda depois de criada." : "Só unidades ativas que ainda não têm sala."}</span>
          </div>
          <div style={fieldBox}>
            <label style={fieldLabel}>
              Nome da sala
              <input ref={(el) => { if (room) first.current = el; }} value={name} aria-describedby={nameHint} aria-invalid={problems.includes(NAME_TEXT) || undefined} style={inputStyle} onChange={(e) => touch(setName)(e.target.value)} />
            </label>
            <span id={nameHint} style={hintStyle}>de 3 a 120 caracteres</span>
          </div>
          <label style={checkLabel}>
            <input type="checkbox" checked={active} onChange={(e) => touch(setActive)(e.target.checked)} />
            Ativa
          </label>
          {problems.length > 0 && <ul role="alert" style={{ ...alert, margin: 0, paddingLeft: 20 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          {!confirming && (
            <div style={row}>
              <button type="submit" style={buttonStyle}>Revisar</button>
              <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
            </div>
          )}
        </div>
      </fieldset>
      </form>
      {confirming && (
        <SensitiveAction
          title={room ? `Salvar ${label}` : `Criar a sala ${label}`}
          description={active
            ? "Salas ativas recebem estoque e registram doses. Só se desativa uma sala sem saldo."
            : "Sala inativa não recebe nem aplica; o histórico fica."}
          requiresStepUp
          confirmLabel={room ? "Salvar sala" : "Criar sala"}
          run={async () => {
            const body = { health_unit_id: unitId, name: label, active };
            if (room) await updateVaccineRoom(room.id, body); else await createVaccineRoom(body);
          }}
          onDone={() => onSaved(`Sala ${label} salva.`)}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => vaccinationError(err)}
        />
      )}
    </section>
  );
}

// Módulo 27b (F-21; Q13): o CNES da rede de frio. O PATCH exige a chave `cnes` (vazio → null apaga); o CNES de uma unidade de saúde
// volta 409 `cnes_in_use` (a frase do api, pergunta da cidade-piloto). A escrita passa pelo step-up e o quadro é relido depois.
const CNES_HELP = "obrigatório para o envio à BNAFAR; precisa ser um CNES desta cidade";

export function ColdChainCnes({ central, onSaved, onGoToSecurity }: { central: AdminLocation; onSaved(): void; onGoToSecurity?(): void }) {
  const [ value, setValue ] = useState(central.cnes ?? "");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ confirming, setConfirming ] = useState(false);
  const ids = useId();
  const next = value.trim() === "" ? null : docOf(value);

  function review(e?: FormEvent) {
    e?.preventDefault();
    const found = value.trim() === "" ? null : cnesProblem(value);
    setProblem(found);
    if (!found) setConfirming(true);
  }
  const translate = (err: unknown): string => {
    if (err instanceof ApiError && errorCode(err) === "cnes_in_use") return BNAFAR_ERRORS.cnes_in_use;
    if (err instanceof ApiError && errorCode(err) === "invalid_request" && (err.body as { path?: string } | undefined)?.path === "cnes") {
      const text = "o CNES tem 7 dígitos";
      setProblem(text);
      return text;
    }
    return vaccinationError(err);
  };

  return (
    <form onSubmit={review} noValidate style={form}>
      <div style={fieldBox}>
        <label style={fieldLabel}>
          CNES da rede de frio
          <input value={value} inputMode="numeric" disabled={confirming} style={inputStyle} aria-invalid={problem ? true : undefined}
            aria-describedby={`${ids}-hint${problem ? ` ${ids}-err` : ""}`}
            onChange={(e) => { setProblem(null); setValue(e.target.value); }} />
        </label>
        <span style={hintStyle}>{central.cnes ?? "sem CNES"}</span>
        <span id={`${ids}-hint`} style={hintStyle}>{CNES_HELP}</span>
        {problem && <span id={`${ids}-err`} style={alert}>{problem}</span>}
      </div>
      {!confirming && <div style={row}><button type="submit" style={secondaryButtonStyle}>Salvar CNES</button></div>}
      {confirming && (
        <SensitiveAction
          title="Salvar o CNES da rede de frio"
          description={next ? `O CNES ${next} identifica a rede de frio no envio à BNAFAR.` : "Sem CNES, a rede de frio fica fora do envio à BNAFAR."}
          requiresStepUp
          confirmLabel="Confirmar CNES"
          run={async () => { await setColdChainCentralCnes(next); }}
          onDone={() => { setConfirming(false); onSaved(); }}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={translate}
        />
      )}
    </form>
  );
}
