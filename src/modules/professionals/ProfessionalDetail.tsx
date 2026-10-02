import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelShift, endProfessionalLink, getProfessional, listActiveUnits, listCbo, listProfessionalShifts,
  openProfessionalLink, scheduleShift, updateProfessional, type CboEntry, type HealthUnit,
  type ProfessionalLink, type ProfessionalShift
} from "../../lib/api";
import { professionalError, professionalErrorOrNull, shiftWindow } from "../../lib/professionals";
import { cityIsoDate, fmtDateTime } from "../../lib/format";
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
const dayIso = (d: Date) => cityIsoDate(d);
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
  // Incrementado a cada "Lançar turno" clicado (mesmo no mesmo vínculo) para
  // forçar o remount de ScheduleShift via `key` — sem isto, clicar de novo
  // no mesmo vínculo depois de salvar reabriria o painel ainda preso no
  // estado "turno lançado" (`saved`), sem formulário nenhum para digitar o
  // próximo turno.
  const [ scheduleOpenSeq, setScheduleOpenSeq ] = useState(0);
  const [ cancelling, setCancelling ] = useState<ProfessionalShift | null>(null);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: [ "professional", professionalId ] });
    void queryClient.invalidateQueries({ queryKey: [ "professionalShifts", professionalId ] });
  }

  function openSchedule(link: ProfessionalLink) {
    setScheduling(link);
    setScheduleOpenSeq((n) => n + 1);
  }

  if (!detail.data) return detail.error ? <p role="alert">{professionalError(detail.error)}</p> : null;
  const { professional, links } = detail.data;
  const active = links.filter((l) => !l.ended_at);

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
                <button type="button" style={secondaryButtonStyle} onClick={() => openSchedule(l)}>Lançar turno</button>
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
            unitsError={units.error}
            cboError={cbo.error}
            onDone={() => { setOpening(false); refresh(); }}
            onCancel={() => setOpening(false)}
          />
        )}
        {ending && (
          <EndLink
            professionalId={professional.id}
            link={ending}
            onRefresh={refresh}
            onDone={() => setEnding(null)}
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
        {scheduling && (
          <ScheduleShift
            key={`${scheduling.id}-${scheduleOpenSeq}`}
            link={scheduling}
            onSaved={refresh}
            onClose={() => setScheduling(null)}
          />
        )}
        {shifts.isError ? (
          <p role="alert" style={alertStyle}>{professionalError(shifts.error)}</p>
        ) : (
          <DataTable<ProfessionalShift>
            cols={[
              { label: "Unidade", w: "2fr", render: (s) => s.unit_name },
              { label: "Ocupação", w: "2fr", render: (s) => {
                const l = links.find((x) => x.id === s.professional_link_id);
                return l ? `${l.cbo_code} · ${l.cbo_title ?? ""}` : "—";
              } },
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
        )}
        {cancelling && <CancelShiftPanel shift={cancelling} onDone={() => { setCancelling(null); refresh(); }} onCancel={() => setCancelling(null)} />}
      </Panel>
      {active.length === 0 && <p style={{ fontSize: 12.5 }}>Sem vínculo ativo: este profissional não chama pacientes.</p>}
    </div>
  );
}

interface OpenLinkProps {
  professionalId: string; units: HealthUnit[]; cboEntries: CboEntry[];
  unitsError: unknown; cboError: unknown;
  onDone(): void; onCancel(): void;
}

function OpenLink({ professionalId, units, cboEntries, unitsError, cboError, onDone, onCancel }: OpenLinkProps) {
  const [ unitId, setUnitId ] = useState("");
  const [ code, setCode ] = useState("");
  const [ search, setSearch ] = useState("");
  const options = cboEntries.filter((e) => `${e.code} ${e.title}`.toLowerCase().includes(search.toLowerCase()));
  const loadError = unitsError ?? cboError;

  // Digitar em "Buscar ocupação" pode tirar a ocupação já escolhida da lista
  // filtrada — sem isto, `code` continuaria setado e o SensitiveAction
  // ficaria visível confirmando uma ocupação que não aparece mais no select.
  useEffect(() => {
    if (code && !options.some((e) => e.code === code)) setCode("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ search ]);

  const selectedUnit = units.find((u) => u.id === unitId);
  const selectedCbo = options.find((e) => e.code === code);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
      {loadError != null && <p role="alert" style={alertStyle}>{professionalError(loadError)}</p>}
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
      {/* Só entra em modo sensível (SensitiveAction, com o campo de código
          quando não há janela de step-up) depois de unidade e ocupação
          escolhidas — do contrário, um código de uso único seria gasto num
          formulário que ainda não tem o que confirmar. */}
      {unitId && code ? (
        <SensitiveAction
          title="Abrir vínculo"
          description={`${selectedUnit?.name ?? ""} · ${code} · ${selectedCbo?.title ?? ""} — com o vínculo, o profissional passa a chamar e registrar desfecho nesta unidade.`}
          requiresStepUp
          confirmLabel="Confirmar vínculo"
          run={async () => { await openProfessionalLink(professionalId, unitId, code); }}
          translateError={(err) => professionalErrorOrNull(err)}
          onDone={onDone}
          onCancel={onCancel}
        />
      ) : (
        <div><button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button></div>
      )}
    </div>
  );
}

const END_WINDOW_DAYS = 62;

function describeFutureCount(n: number): string {
  if (n === 0) return "Nenhum turno futuro nos próximos 62 dias será cancelado.";
  const plural = n !== 1;
  return `${n} turno${plural ? "s" : ""} futuro${plural ? "s" : ""} nos próximos 62 dias ${plural ? "serão" : "será"} cancelado${plural ? "s" : ""}.`;
}

function EndLink({ professionalId, link, onRefresh, onDone, onCancel }: {
  professionalId: string; link: ProfessionalLink; onRefresh(): void; onDone(): void; onCancel(): void;
}) {
  // Contagem dedicada (spec §5, D5): a tabela de turnos só mostra uma janela
  // de 14 dias, mas o encerramento cancela QUALQUER turno futuro até o
  // limite de 62 dias que a API aceita — teria que contar errado (a favor
  // de "nada a cancelar") se reaproveitasse a consulta da tabela.
  const from = dayIso(new Date());
  const to = addDays(from, END_WINDOW_DAYS);
  // Chave aninhada sob o prefixo "professionalShifts" (mesmo prefixo que
  // refresh() invalida) para que lançar/cancelar um turno também atualize
  // esta prévia — sem isto, ela ficava presa na contagem de quando o painel
  // de encerrar abriu.
  const endShifts = useQuery({
    queryKey: [ "professionalShifts", professionalId, "end", link.id, from ],
    queryFn: () => listProfessionalShifts(professionalId, from, to)
  });
  const futureCount = (endShifts.data ?? [])
    .filter((s) => s.professional_link_id === link.id && !s.cancelled_at && Date.parse(s.starts_at) > Date.now())
    .length;
  const [ cancelledCount, setCancelledCount ] = useState<number | null>(null);
  // Nunca deixar "Nenhum turno futuro…" aparecer por a consulta ainda estar
  // carregando ou ter falhado — pareceria "confirmado que não há nada".
  const description = endShifts.isLoading
    ? "contando turnos futuros…"
    : endShifts.isError
      ? professionalError(endShifts.error)
      : describeFutureCount(futureCount);

  if (cancelledCount !== null) {
    const plural = cancelledCount !== 1;
    return (
      <section style={panelStyle}>
        <strong>{`Encerrar vínculo em ${link.unit_name}`}</strong>
        <p role="status" style={{ margin: 0, fontSize: 12.5 }}>
          {`Vínculo encerrado; ${cancelledCount} turno${plural ? "s" : ""} cancelado${plural ? "s" : ""}`}
        </p>
        <div><button type="button" style={buttonStyle} onClick={onDone}>Fechar</button></div>
      </section>
    );
  }

  return (
    <SensitiveAction
      title={`Encerrar vínculo em ${link.unit_name}`}
      description={description}
      requiresStepUp
      confirmLabel="Confirmar encerramento"
      run={async () => {
        const result = await endProfessionalLink(link.id);
        onRefresh();
        setCancelledCount(result.cancelled_shift_ids.length);
      }}
      translateError={(err) => professionalErrorOrNull(err)}
      onDone={() => {}}
      onCancel={onCancel}
    />
  );
}

function fmtShiftLine(span: { startsAt: string; endsAt: string }): string {
  return `${ddmm(span.startsAt.slice(0, 10))} ${span.startsAt.slice(11, 16)}–${span.endsAt.slice(11, 16)}`;
}

function ScheduleShift({ link, onSaved, onClose }: { link: ProfessionalLink; onSaved(): void; onClose(): void }) {
  const [ date, setDate ] = useState("");
  const [ start, setStart ] = useState("");
  const [ end, setEnd ] = useState("");
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  // Depois de salvar, o painel mostra a linha "turno lançado" em vez de
  // fechar direto (onClose): um turno numa semana fora da janela visível de
  // 14 dias da tabela senão parece que sumiu.
  const [ saved, setSaved ] = useState<{ startsAt: string; endsAt: string } | null>(null);
  const span = shiftWindow(date, start, end);

  async function save() {
    if (busy || !span) return;
    setBusy(true); setError(null);
    try {
      await scheduleShift(link.id, span.startsAt, span.endsAt);
      onSaved();
      setSaved(span);
    } catch (err) {
      setError(professionalError(err));
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <section style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, border: "1px solid var(--rule)", borderRadius: 8, marginBottom: 12 }}>
        <strong>{`Turno em ${link.unit_name}`}</strong>
        <p role="status" style={{ margin: 0, fontSize: 12.5 }}>{`turno lançado: ${fmtShiftLine(saved)}`}</p>
        <div><button type="button" style={buttonStyle} onClick={onClose}>Fechar</button></div>
      </section>
    );
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
        <button type="button" disabled={busy} onClick={onClose} style={secondaryButtonStyle}>Cancelar</button>
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
const alertStyle = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const panelStyle = { display: "flex", flexDirection: "column" as const, gap: 10, padding: 16,
  border: "1px solid var(--rule)", borderRadius: 8, background: "var(--panel)", marginTop: 12 };
