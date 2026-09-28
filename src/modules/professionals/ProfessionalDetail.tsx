import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelShift, endProfessionalLink, getProfessional, listActiveUnits, listCbo, listProfessionalShifts,
  openProfessionalLink, scheduleShift, updateProfessional, type CboEntry, type HealthUnit,
  type ProfessionalLink, type ProfessionalShift
} from "../../lib/api";
import { professionalError, shiftWindow } from "../../lib/professionals";
import { fmtDateTime } from "../../lib/format";
import { PageHeader } from "../../components/PageHeader";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { KeyValue } from "../../components/KeyValue";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { ProfileForm } from "./ProfileForm";

// Ficha do profissional (spec §5): perfil, vínculos (step-up para abrir e
// encerrar, D5) e turnos por vínculo numa janela de 14 dias (D6, D8).
interface Props { professionalId: string; onBack(): void }

const WINDOW_DAYS = 14;
const dayIso = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function ProfessionalDetail({ professionalId, onBack }: Props) {
  const queryClient = useQueryClient();
  const [ from, setFrom ] = useState(() => dayIso(new Date()));
  const to = addDays(from, WINDOW_DAYS);
  const detail = useQuery({ queryKey: [ "professional", professionalId ], queryFn: () => getProfessional(professionalId) });
  const shifts = useQuery({ queryKey: [ "professionalShifts", professionalId, from ],
    queryFn: () => listProfessionalShifts(professionalId, from, to) });
  // Carregadas junto com a ficha (não só quando o painel de abrir vínculo
  // aparece): a lista de unidades e a tabela CBO já estão prontas quando a
  // pessoa clica em "Abrir vínculo".
  const units = useQuery({ queryKey: [ "activeUnits" ], queryFn: listActiveUnits });
  const cbo = useQuery({ queryKey: [ "cbo" ], queryFn: listCbo });
  const [ opening, setOpening ] = useState(false);
  const [ ending, setEnding ] = useState<ProfessionalLink | null>(null);
  const [ scheduling, setScheduling ] = useState<ProfessionalLink | null>(null);
  const [ cancelling, setCancelling ] = useState<ProfessionalShift | null>(null);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: [ "professional", professionalId ] });
    void queryClient.invalidateQueries({ queryKey: [ "professionalShifts", professionalId ] });
  }

  if (!detail.data) return detail.error ? <p role="alert">{professionalError(detail.error)}</p> : null;
  const { professional, links } = detail.data;
  const active = links.filter((l) => !l.ended_at);
  const now = Date.now();
  const futureCount = (l: ProfessionalLink) =>
    (shifts.data ?? []).filter((s) => s.professional_link_id === l.id && !s.cancelled_at && Date.parse(s.starts_at) > now).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title={professional.professional_name} sub={professional.email_address} />
      <div><button type="button" style={secondaryButtonStyle} onClick={onBack}>← Profissionais</button></div>

      <Panel title="Perfil">
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
          <KeyValue k="Conselho" v={`${professional.council}-${professional.council_state} ${professional.registration_number}`} />
          <KeyValue k="CNS" v={professional.cns_masked} />
        </div>
        <ProfileForm initial={professional} submitLabel="Salvar perfil"
          onSubmit={async (fields) => { await updateProfessional(professional.id, fields); refresh(); }} />
      </Panel>

      <Panel title="Vínculos" right={<button type="button" style={buttonStyle} onClick={() => setOpening(true)}>Abrir vínculo</button>}>
        <DataTable<ProfessionalLink>
          cols={[
            { label: "Unidade", w: "2fr", render: (l) => l.unit_name },
            { label: "Ocupação", w: "2fr", render: (l) => `${l.cbo_code} · ${l.cbo_title ?? ""}` },
            { label: "Início", w: "1.5fr", render: (l) => `${fmtDateTime(l.started_at)} · ${l.started_by}` },
            { label: "Fim", w: "1.5fr", render: (l) => l.ended_at ? `${fmtDateTime(l.ended_at)} · ${l.ended_by}` : "ativo" },
            { label: "", w: "auto", align: "right", render: (l) => !l.ended_at && (
              <span style={{ display: "flex", gap: 6 }}>
                <button type="button" style={secondaryButtonStyle} onClick={() => setScheduling(l)}>Lançar turno</button>
                <button type="button" style={secondaryButtonStyle} onClick={() => setEnding(l)}>Encerrar</button>
              </span>
            ) }
          ]}
          rows={links}
          rowKey={(l) => l.id}
          empty="nenhum vínculo"
        />
        {opening && (
          <OpenLink
            professionalId={professional.id}
            units={units.data ?? []}
            cboEntries={cbo.data ?? []}
            onDone={() => { setOpening(false); refresh(); }}
            onCancel={() => setOpening(false)}
          />
        )}
        {ending && (
          <SensitiveAction
            title={`Encerrar vínculo em ${ending.unit_name}`}
            description={futureCount(ending) > 0
              ? `${futureCount(ending)} ${futureCount(ending) === 1 ? "turno futuro será cancelado" : "turnos futuros serão cancelados"}.`
              : "Nenhum turno futuro neste vínculo."}
            requiresStepUp
            confirmLabel="Confirmar encerramento"
            run={async () => { await endProfessionalLink(ending.id); }}
            translateError={(err) => professionalError(err)}
            onDone={() => { setEnding(null); refresh(); }}
            onCancel={() => setEnding(null)}
          />
        )}
      </Panel>

      <Panel title="Turnos" sub={`${ddmm(from)} a ${ddmm(to)}`} right={
        <span style={{ display: "flex", gap: 6 }}>
          <button type="button" style={secondaryButtonStyle} onClick={() => setFrom(addDays(from, -7))}>← semana</button>
          <button type="button" style={secondaryButtonStyle} onClick={() => setFrom(addDays(from, 7))}>semana →</button>
        </span>
      }>
        {scheduling && <ScheduleShift link={scheduling} onDone={() => { setScheduling(null); refresh(); }} onCancel={() => setScheduling(null)} />}
        <DataTable<ProfessionalShift>
          cols={[
            { label: "Unidade", w: "2fr", render: (s) => s.unit_name },
            { label: "Início", w: "1.5fr", render: (s) => fmtDateTime(s.starts_at) },
            { label: "Fim", w: "1.5fr", render: (s) => fmtDateTime(s.ends_at) },
            { label: "Situação", w: "2fr", render: (s) => s.cancelled_at ? `cancelado — ${s.cancel_reason}` : "válido" },
            { label: "", w: "auto", align: "right", render: (s) => !s.cancelled_at && (
              <button type="button" style={secondaryButtonStyle} onClick={() => setCancelling(s)}>Cancelar</button>
            ) }
          ]}
          rows={shifts.data ?? []}
          rowKey={(s) => s.id}
          empty="nenhum turno no período"
        />
        {cancelling && <CancelShiftPanel shift={cancelling} onDone={() => { setCancelling(null); refresh(); }} onCancel={() => setCancelling(null)} />}
      </Panel>
      {active.length === 0 && <p style={{ fontSize: 12.5 }}>Sem vínculo ativo: este profissional não chama pacientes.</p>}
    </div>
  );
}

interface OpenLinkProps {
  professionalId: string; units: HealthUnit[]; cboEntries: CboEntry[]; onDone(): void; onCancel(): void;
}

function OpenLink({ professionalId, units, cboEntries, onDone, onCancel }: OpenLinkProps) {
  const [ unitId, setUnitId ] = useState("");
  const [ code, setCode ] = useState("");
  const [ search, setSearch ] = useState("");
  const options = cboEntries.filter((e) => `${e.code} ${e.title}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
      <label style={labelStyle}>Unidade
        <select value={unitId} onChange={(e) => setUnitId(e.target.value)} style={inputStyle}>
          <option value="">—</option>
          {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      <label style={labelStyle}>Buscar ocupação
        <input value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} placeholder="código ou título" />
      </label>
      <label style={labelStyle}>Ocupação (CBO)
        <select value={code} onChange={(e) => setCode(e.target.value)} style={inputStyle}>
          <option value="">—</option>
          {options.map((e) => <option key={e.code} value={e.code}>{`${e.code} · ${e.title}`}</option>)}
        </select>
      </label>
      <SensitiveAction
        title="Abrir vínculo"
        description="Com o vínculo, o profissional passa a chamar e registrar desfecho nesta unidade."
        requiresStepUp
        confirmLabel="Confirmar vínculo"
        run={async () => {
          if (!unitId || !code) throw new Error("selecione unidade e ocupação");
          await openProfessionalLink(professionalId, unitId, code);
        }}
        translateError={(err) => professionalError(err)}
        onDone={onDone}
        onCancel={onCancel}
      />
    </div>
  );
}

function ScheduleShift({ link, onDone, onCancel }: { link: ProfessionalLink; onDone(): void; onCancel(): void }) {
  const [ date, setDate ] = useState("");
  const [ start, setStart ] = useState("");
  const [ end, setEnd ] = useState("");
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const span = shiftWindow(date, start, end);

  async function save() {
    if (busy || !span) return;
    setBusy(true); setError(null);
    try {
      await scheduleShift(link.id, span.startsAt, span.endsAt);
      onDone();
    } catch (err) {
      setError(professionalError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, border: "1px solid var(--rule)", borderRadius: 8, marginBottom: 12 }}>
      <strong>{`Turno em ${link.unit_name}`}</strong>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <label style={labelStyle}>Data<input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></label>
        <label style={labelStyle}>Início<input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle} /></label>
        <label style={labelStyle}>Fim<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle} /></label>
      </div>
      {span?.nextDay && <p style={{ margin: 0, fontSize: 12.5 }}>{`termina em ${ddmm(span.endsAt.slice(0, 10))} às ${end}`}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={!span || busy} onClick={() => void save()} style={!span || busy ? disabledButtonStyle : buttonStyle}>Salvar turno</button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
      </div>
    </section>
  );
}

function CancelShiftPanel({ shift, onDone, onCancel }: { shift: ProfessionalShift; onDone(): void; onCancel(): void }) {
  const [ reason, setReason ] = useState("");
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  async function confirm() {
    if (busy || !reason.trim()) return;
    setBusy(true); setError(null);
    try {
      await cancelShift(shift.id, reason);
      onDone();
    } catch (err) {
      setError(professionalError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, border: "1px solid var(--rule)", borderRadius: 8, marginTop: 12 }}>
      <strong>Cancelar turno</strong>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}
      <label style={labelStyle}>Motivo<input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} style={inputStyle} /></label>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={!reason.trim() || busy} onClick={() => void confirm()} style={!reason.trim() || busy ? disabledButtonStyle : buttonStyle}>Confirmar cancelamento</button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Voltar</button>
      </div>
    </section>
  );
}

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };
