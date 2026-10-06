// Editor de faixas do modelo de agenda (módulo 17; spec §3.2, contratos §2–§3).
// A validação local espelha o 422 invalid_blocks (todos os `detail` das
// §3 e §9 do contrato), invalid_name e invalid_fit_in_limit; o api continua
// sendo quem garante. A pré-visualização calcula as vagas de um turno de exemplo sem
// gravar nada.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createScheduleTemplate, listCbo, previewScheduleTemplate, updateScheduleTemplate,
  type AppointmentType, type BlockKind, type ScheduleBlock, type ScheduleTemplate, type TemplatePreview
} from "../../lib/api";
import { professionalError, shiftWindow } from "../../lib/professionals";
import {
  BLOCK_DETAIL_MESSAGE, BLOCK_KIND_LABEL, MAX_BLOCKS, blockLine, blockProblem, overlappingBlocks, parseFitInLimit, templateDraftFrom,
  templateProblem, typeLabel, type TemplateDraft
} from "../../lib/scheduling";
import { cityIsoDate, fmtHourMinute } from "../../lib/format";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

interface Props { template: ScheduleTemplate | null; types: AppointmentType[]; onSaved(): void; onCancel(): void }

const KINDS: BlockKind[] = [ "walk_in", "bookable", "blocked" ];

// Faixa que deixa de ser agendável perde tipo e duração da vaga: o schema
// do api só aceita os dois em `bookable`.
function normalize(b: ScheduleBlock): ScheduleBlock {
  if (b.kind === "bookable") return b;
  return { starts: b.starts, ends: b.ends, kind: b.kind };
}

// Nova faixa começa onde a última termina e dura 1h (ou vai até 23:59).
// Depois de uma faixa que termina às 23:59 nasce 23:59–23:59: inválida de
// propósito, com o motivo à vista e o salvar travado — nunca em silêncio.
function nextBlock(blocks: ScheduleBlock[]): ScheduleBlock {
  const last = blocks[blocks.length - 1];
  const start = last?.ends && /^\d{2}:\d{2}$/.test(last.ends) ? last.ends : "08:00";
  const hour = Math.min(Number(start.slice(0, 2)) + 1, 23);
  const end = hour === Number(start.slice(0, 2)) ? "23:59" : `${String(hour).padStart(2, "0")}:${start.slice(3, 5)}`;
  return { starts: start, ends: end, kind: "bookable" };
}

export function TemplateEditor({ template, types, onSaved, onCancel }: Props) {
  const [ draft, setDraft ] = useState<TemplateDraft>(() => templateDraftFrom(template));
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const overlaps = overlappingBlocks(draft.blocks);
  const problem = templateProblem(draft, types);
  // Teto do api (template_blocks.rb MAX_BLOCKS): acima disso volta bad_block.
  const full = draft.blocks.length >= MAX_BLOCKS;

  const setBlocks = (blocks: ScheduleBlock[]) => setDraft((d) => ({ ...d, blocks }));
  const setBlock = (i: number, patch: Partial<ScheduleBlock>) =>
    setBlocks(draft.blocks.map((b, j) => (j === i ? normalize({ ...b, ...patch }) : b)));

  async function save() {
    if (busy || problem) return;
    // `appointment_type_name` é só de leitura (§9): nunca volta para o api.
    const blocks = draft.blocks.map(({ appointment_type_name: _name, ...rest }) => rest);
    const fields = { name: draft.name.trim(), fit_in_limit: parseFitInLimit(draft.fitInLimit) ?? 0, blocks };
    setBusy(true); setError(null);
    try {
      if (template) await updateScheduleTemplate(template.id, fields);
      else await createScheduleTemplate(fields);
      onSaved();
    } catch (err) {
      setError(professionalError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={box}>
      <strong>{template ? `Editar ${template.name}` : "Novo modelo de agenda"}</strong>
      {error && <p role="alert" style={alert}>{error}</p>}
      <label style={label}>Nome do modelo
        <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} style={inputStyle} />
      </label>
      <label style={label}>Encaixes por turno
        <input inputMode="numeric" value={draft.fitInLimit} style={inputStyle}
          onChange={(e) => setDraft((d) => ({ ...d, fitInLimit: e.target.value }))} />
      </label>

      {draft.blocks.map((b, i) => {
        const p = blockProblem(b, types) ?? (overlaps.has(i) ? "overlap" : null);
        const activeTypes = types.filter((t) => t.active);
        const current = b.appointment_type_key;
        return (
          <div key={i} role="group" aria-label={`faixa ${i + 1}`} style={card}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label style={label}>Início
                <input type="time" value={b.starts} onChange={(e) => setBlock(i, { starts: e.target.value })} style={inputStyle} />
              </label>
              <label style={label}>Fim
                <input type="time" value={b.ends} onChange={(e) => setBlock(i, { ends: e.target.value })} style={inputStyle} />
              </label>
              <label style={label}>Tipo de faixa
                <select value={b.kind} onChange={(e) => setBlock(i, { kind: e.target.value as BlockKind })} style={inputStyle}>
                  {KINDS.map((k) => <option key={k} value={k}>{BLOCK_KIND_LABEL[k]}</option>)}
                </select>
              </label>
              {b.kind === "bookable" && (
                <label style={label}>Tipo de atendimento
                  <select value={current ?? ""} style={inputStyle}
                    onChange={(e) => setBlock(i, { appointment_type_key: e.target.value || undefined })}>
                    <option value="">escolha…</option>
                    {activeTypes.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                    {current && !activeTypes.some((t) => t.key === current) && (
                      <option value={current}>{typeLabel(current, types)}</option>
                    )}
                  </select>
                </label>
              )}
              {b.kind === "bookable" && (
                <label style={label}>Vaga (min)
                  <input type="number" min={5} max={240} value={b.slot_minutes ?? ""} style={inputStyle}
                    placeholder={String(types.find((t) => t.key === current)?.duration_minutes ?? "")}
                    onChange={(e) => setBlock(i, { slot_minutes: e.target.value === "" ? undefined : Number(e.target.value) })} />
                </label>
              )}
            </div>
            {p && <small style={hint}>{BLOCK_DETAIL_MESSAGE[p]}</small>}
            <div>
              <button type="button" style={secondaryButtonStyle}
                onClick={() => setBlocks(draft.blocks.filter((_, j) => j !== i))}>remover faixa</button>
            </div>
          </div>
        );
      })}
      <div>
        <button type="button" disabled={full} style={full ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => { if (!full) setBlocks([ ...draft.blocks, nextBlock(draft.blocks) ]); }}>
          + faixa
        </button>
      </div>
      {full && <small style={hint}>{`no máximo ${MAX_BLOCKS} faixas por modelo`}</small>}
      <small style={hint}>Vaga sem duração usa a duração do tipo. A sobra no fim da faixa não vira vaga.</small>
      {problem && <small style={hint}>{problem}</small>}

      <Preview draft={draft} types={types} blocked={problem !== null} />

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={!!problem || busy} onClick={() => void save()}
          style={problem || busy ? disabledButtonStyle : buttonStyle}>Salvar modelo</button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
      </div>
    </section>
  );
}

function Preview({ draft, types, blocked }: { draft: TemplateDraft; types: AppointmentType[]; blocked: boolean }) {
  const cbo = useQuery({ queryKey: [ "cbo" ], queryFn: listCbo });
  const [ date, setDate ] = useState(() => cityIsoDate());
  const [ start, setStart ] = useState("07:00");
  const [ end, setEnd ] = useState("12:00");
  const [ cboCode, setCboCode ] = useState("");
  const [ result, setResult ] = useState<{ key: string; preview: TemplatePreview } | null>(null);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const span = shiftWindow(date, start, end);
  // O resultado vale só para o que foi pré-visualizado: mudar modelo ou
  // exemplo esconde a lista velha.
  const inputKey = JSON.stringify([ draft, date, start, end, cboCode ]);
  const ready = !blocked && !!span && cboCode !== "" && !busy;

  async function run() {
    if (!ready || !span) return;
    setBusy(true); setError(null);
    try {
      const preview = await previewScheduleTemplate({
        blocks: draft.blocks, fit_in_limit: parseFitInLimit(draft.fitInLimit) ?? 0,
        sample: { starts_at: span.startsAt, ends_at: span.endsAt, cbo_code: cboCode }
      });
      setResult({ key: inputKey, preview });
    } catch (err) {
      setError(professionalError(err));
    } finally {
      setBusy(false);
    }
  }

  const shown = result && result.key === inputKey ? result.preview : null;

  return (
    <div role="group" aria-label="Pré-visualização" style={card}>
      <strong style={{ fontSize: 13 }}>Pré-visualização</strong>
      {error && <p role="alert" style={alert}>{error}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={label}>Data do exemplo<input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></label>
        <label style={label}>Início do turno<input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle} /></label>
        <label style={label}>Fim do turno<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle} /></label>
        <label style={label}>Ocupação do exemplo (CBO)
          <select value={cboCode} onChange={(e) => setCboCode(e.target.value)} style={inputStyle}>
            <option value="">—</option>
            {(cbo.data ?? []).map((c) => <option key={c.code} value={c.code}>{`${c.code} · ${c.title}`}</option>)}
          </select>
        </label>
      </div>
      <div>
        <button type="button" disabled={!ready} onClick={() => void run()} style={ready ? secondaryButtonStyle : disabledButtonStyle}>
          Pré-visualizar
        </button>
      </div>
      {blocked && <small style={hint}>corrija o modelo para pré-visualizar</small>}
      {shown && (shown.slots.length === 0
        ? <p style={hint}>nenhuma vaga — confira o tipo das faixas e se o CBO do exemplo é atendido por ele</p>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{shown.slots.length === 1 ? "1 vaga" : `${shown.slots.length} vagas`}</span>
            {shown.slots.map((s) => (
              <span key={s.starts_at} style={{ fontSize: 12.5 }}>
                {`${fmtHourMinute(s.starts_at)}–${fmtHourMinute(s.ends_at)} · ${typeLabel(s.appointment_type_key, types)}`}
              </span>
            ))}
          </div>
        ))}
      {shown && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 12, color: "var(--ink3)" }}>Faixas no turno de exemplo</span>
          {shown.blocks.map((b, i) => <span key={i} style={{ fontSize: 12 }}>{blockLine(b, types)}</span>)}
        </div>
      )}
    </div>
  );
}

const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 12, border: "1px solid var(--rule)", borderRadius: 8 };
const card: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, padding: 10, border: "1px solid var(--rule)", borderRadius: 8 };
