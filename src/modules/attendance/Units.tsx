import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createUnit, errorCode, listAllUnits, listNeighborhoods, setUnitActive, updateUnit, type HealthUnitRow, type ScreeningScope, type UnitCapsInput
} from "../../lib/api";
import { CAPS_UNIT_KIND, CEO_UNIT_KIND, HEALTH_MANAGEMENT_UNIT_KIND, UNIT_KINDS, attendanceError } from "../../lib/attendance";
import { modalityLabel, psyError } from "../../lib/psychosocial";
import { NEIGHBORHOODS_KEY } from "../../lib/territory";
import { EMPTY_ADDRESS_FIELDS, addressFieldsFrom, addressPayload, formatAddress } from "../../lib/unitAddress";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { UnitForm, type UnitFormValue } from "./UnitForm";
import { DrainUnitPanel } from "./DrainUnitPanel";

// Units (Task 6) — cadastro de unidades de saúde, só para municipal_admin.
// Lista + criar/editar (UnitForm, com/sem id) + desativar/reativar. Desde o
// módulo 11 a unidade tem endereço (CEP pelo ViaCEP) e o bairro onde fica.
// Criar ou reativar muda quem entra em "unidades ativas" (UnitPicker,
// destino de encaminhamento em UnitQueue): invalida a query `activeUnits`
// para essas telas recarregarem (card dashboard#4, item 1 — Task 7).
const KIND_LABEL: Record<string, string> = Object.fromEntries([ ...UNIT_KINDS, CEO_UNIT_KIND, HEALTH_MANAGEMENT_UNIT_KIND, CAPS_UNIT_KIND ].map((k) => [ k.value, k.label ]));
// Módulo 31 (P34, P53): recusas do cadastro que são do CAPS ou do telefone; a frase vem da lib do módulo (genérica, sem nome de CAPS).
const CAPS_UNIT_ERRORS = [ "unit_has_caps_records", "caps_has_beds", "unit_has_attendances", "invalid_phone", "caps_modality_mismatch", "invalid_service_classification" ];
const unitError = (err: unknown): string => (CAPS_UNIT_ERRORS.includes(errorCode(err) ?? "") ? psyError(err) : attendanceError(err));

// O que o módulo 31 acrescenta ao corpo da unidade: telefone só quando mudou (vazio apaga: null); no CAPS, modalidade e classificação
// (vazia = null) vão sempre; a unidade que deixou de ser CAPS apaga as duas. Sem nada a mandar, o corpo é o de sempre.
function capsPayload(value: UnitFormValue, initial: UnitFormValue): UnitCapsInput | undefined {
  const out: UnitCapsInput = {};
  const phone = value.phone ?? "";
  if (phone !== (initial.phone ?? "")) out.phone = phone === "" ? null : phone;
  if (value.kind === "caps") {
    out.caps_modality = value.capsModality ?? null;
    out.service_classification = (value.serviceClassification ?? "") === "" ? null : (value.serviceClassification as string);
  } else if (initial.kind === "caps") {
    out.caps_modality = null;
    out.service_classification = null;
  }
  // Módulo 32a: prefixo e tempos na TV só quando mudaram (o UnitForm já os tirou sem o interruptor, no CAPS e, os tempos, fora da UPA).
  // Prefixo vazio na unidade nova = o padrão do api; nunca `null` (invalid_ticket_prefix).
  const prefix = value.ticketPrefix ?? "";
  if (value.ticketPrefix !== undefined && prefix !== "" && prefix !== (initial.ticketPrefix ?? "")) out.ticket_prefix = prefix;
  if (value.showWaitTimes !== undefined && value.showWaitTimes !== (initial.showWaitTimes ?? true)) out.show_wait_times = value.showWaitTimes;
  return Object.keys(out).length > 0 ? out : undefined;
}
// Módulo 18 (contratos §5): quem passa pela escuta inicial nesta unidade.
const SCOPE_SHORT: Record<ScreeningScope, string> = { walk_in: "sem horário", all: "todos" };

interface Editing { id: string | null; initial: UnitFormValue }

// Módulo 21b: `labOn` = `municipal_lab` ligado (vem do Atendimento, que já lê a sessão).
// Módulo 25: `surveillanceOn` = `surveillance` ligado; só então a unidade mostra e edita a marca notificadora.
// Módulo 30: `tfdOn` = canUseTransport; só então o cadastro oferece a unidade de gestão.
// Módulo 28: `dentalOn` = canUseDental; só então o cadastro oferece a unidade CEO.
// Módulo 31: `capsOn` = canUsePsychosocial; só então o cadastro oferece o tipo CAPS (sem step-up novo, P26).
// Módulo 32a: `waitingRoomOn` = canUseWaitingRoom; só então o cadastro mostra o prefixo da senha e, na UPA, os tempos na TV.
export function Units({ labOn = false, surveillanceOn = false, dentalOn = false, tfdOn = false, capsOn = false, waitingRoomOn = false }: {
  labOn?: boolean; surveillanceOn?: boolean; dentalOn?: boolean; tfdOn?: boolean; capsOn?: boolean; waitingRoomOn?: boolean;
} = {}) {
  const queryClient = useQueryClient();
  const neighborhoods = useQuery({ queryKey: NEIGHBORHOODS_KEY, queryFn: listNeighborhoods });
  const [ rows, setRows ] = useState<HealthUnitRow[] | null>(null);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ editing, setEditing ] = useState<Editing | null>(null);
  const [ draining, setDraining ] = useState<HealthUnitRow | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  async function load() {
    try {
      setRows(await listAllUnits());
    } catch (err) {
      setError(unitError(err));
    }
  }

  useEffect(() => { void load(); }, []);

  async function toggleActive(row: HealthUnitRow) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await setUnitActive(row.id, !row.active);
      if (!row.active) void queryClient.invalidateQueries({ queryKey: [ "activeUnits" ] });
      await load();
    } catch (err) {
      setError(unitError(err));
    } finally {
      setBusy(false);
    }
  }

  async function save(value: UnitFormValue) {
    if (busy || !editing) return;
    setBusy(true); setError(null);
    try {
      const address = addressPayload(value);
      // T47: o CNES só segue quando mudou (vazio apaga: null) — o api só mexe nele quando a chave vem.
      const cnes = (value.cnes ?? "") === "" ? null : (value.cnes as string);
      const cnesChanged = cnes !== ((editing.initial.cnes ?? "") === "" ? null : editing.initial.cnes);
      const caps = capsPayload(value, editing.initial);
      if (editing.id) {
        // O 7º argumento só segue quando a marca existe (interruptor ligado): desligado, o corpo é o de sempre.
        if (caps) {
          await updateUnit(editing.id, value.name, value.kind, address, value.screeningScope, value.collectsSamples, value.notifying, cnesChanged ? cnes : undefined, caps);
        } else if (cnesChanged) {
          await updateUnit(editing.id, value.name, value.kind, address, value.screeningScope, value.collectsSamples, value.notifying, cnes);
        } else if (value.notifying !== undefined) {
          await updateUnit(editing.id, value.name, value.kind, address, value.screeningScope, value.collectsSamples, value.notifying);
        } else {
          await updateUnit(editing.id, value.name, value.kind, address, value.screeningScope, value.collectsSamples);
        }
      } else if (caps) {
        await createUnit(value.name, value.kind, address, cnesChanged ? cnes : undefined, caps);
        void queryClient.invalidateQueries({ queryKey: [ "activeUnits" ] });
      } else if (cnesChanged) {
        await createUnit(value.name, value.kind, address, cnes);
        void queryClient.invalidateQueries({ queryKey: [ "activeUnits" ] });
      } else {
        await createUnit(value.name, value.kind, address);
        void queryClient.invalidateQueries({ queryKey: [ "activeUnits" ] });
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(unitError(err));
    } finally {
      setBusy(false);
    }
  }

  const nameOf = new Map((neighborhoods.data ?? []).map((n) => [ n.id, n.name ]));

  return (
    <Panel
      title="Unidades"
      right={!editing && (
        <button type="button" style={buttonStyle}
          onClick={() => setEditing({ id: null, initial: { name: "", kind: "ubs", ...EMPTY_ADDRESS_FIELDS, ...(waitingRoomOn ? { ticketPrefix: "", showWaitTimes: true } : {}) } })}>
          Nova unidade
        </button>
      )}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}
        {notice && <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{notice}</p>}

        {draining && rows && (
          <DrainUnitPanel
            key={draining.id}
            unit={draining}
            units={rows}
            onCancel={() => setDraining(null)}
            onDone={(result, target) => {
              setDraining(null);
              setNotice(`${draining.name} esvaziada: ${result.requests_count} ${result.requests_count === 1 ? "pedido" : "pedidos"} e ` +
                `${result.appointments_count} ${result.appointments_count === 1 ? "horário foi" : "horários foram"} para ${target.name}. ` +
                "Se nada novo chegar a ela, já pode ser desativada.");
              void queryClient.invalidateQueries({ queryKey: [ "unitRequests" ] });
              void queryClient.invalidateQueries({ queryKey: [ "unitAgenda" ] });
              void load();
            }}
          />
        )}

        {editing && (
          <UnitForm
            key={editing.id ?? "new"}
            initial={editing.initial}
            neighborhoods={neighborhoods.data ?? []}
            busy={busy}
            dentalOn={dentalOn}
            tfdOn={tfdOn}
            capsOn={capsOn}
            waitingRoomOn={waitingRoomOn}
            onSave={(value) => void save(value)}
            onCancel={() => setEditing(null)}
          />
        )}

        {rows && (
          <DataTable<HealthUnitRow>
            cols={[
              { label: "Nome", w: "2fr", render: (r) => r.name },
              { label: "Tipo", w: "1fr", render: (r) =>
                (r.kind === "caps" && r.caps_modality ? modalityLabel(r.caps_modality) : KIND_LABEL[r.kind] ?? r.kind) },
              { label: "CNES", w: "0.9fr", render: (r) => r.cnes ?? "—" },
              { label: "Endereço", w: "3fr", render: (r) =>
                formatAddress(r, r.neighborhood_id ? nameOf.get(r.neighborhood_id) : null) },
              { label: "Acolhimento", w: "1.2fr", render: (r) => SCOPE_SHORT[r.screening_scope ?? "walk_in"] },
              ...(labOn ? [ { label: "Coleta", w: "0.8fr", render: (r: HealthUnitRow) => (r.collects_samples ? "coleta" : "—") } ] : []),
              ...(surveillanceOn ? [ { label: "Notificadora", w: "0.9fr", render: (r: HealthUnitRow) => (r.notifying === true ? "notificadora" : "—") } ] : []),
              { label: "Situação", w: "1fr", render: (r) => <Tag tone={r.active ? "ok" : undefined}>{r.active ? "ativa" : "inativa"}</Tag> },
              {
                label: "", w: "auto", align: "right", render: (r) => (
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button type="button" style={secondaryButtonStyle}
                      onClick={() => setEditing({ id: r.id, initial: {
                        name: r.name, kind: r.kind, cnes: r.cnes ?? "", ...addressFieldsFrom(r), screeningScope: r.screening_scope ?? "walk_in",
                        phone: r.phone ?? "", ...(r.kind === "caps" ? { capsModality: r.caps_modality ?? "", serviceClassification: r.service_classification ?? "" } : {}),
                        ...(labOn ? { collectsSamples: r.collects_samples === true } : {}),
                        ...(surveillanceOn ? { notifying: r.notifying === true } : {}),
                        ...(waitingRoomOn ? { ticketPrefix: r.ticket_prefix ?? "", showWaitTimes: r.show_wait_times !== false } : {})
                      } })}>
                      Editar
                    </button>
                    {r.active && ((r.live_requests_count ?? 0) + (r.live_appointments_count ?? 0)) > 0 && (
                      <button type="button" style={secondaryButtonStyle} disabled={busy}
                        onClick={() => { setNotice(null); setDraining(r); }}>
                        Esvaziar
                      </button>
                    )}
                    <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => void toggleActive(r)}>
                      {r.active ? "Desativar" : "Reativar"}
                    </button>
                  </div>
                )
              }
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            empty="nenhuma unidade cadastrada"
          />
        )}
      </div>
    </Panel>
  );
}
