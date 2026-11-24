// src/modules/ZooCampaigns.tsx
// Tela "Campanhas e vacinação" do centro de zoonoses (módulo 35b, F-35.12). Leitura para a equipe e a administração; a
// coordenação cria, edita (só `planned`), abre e encerra; a equipe registra e anula doses. Abrir e encerrar mandam `{}` (o api
// recusa qualquer chave); editar manda `expected_version`. Tela velha (409): a frase, UMA releitura das campanhas, nenhum reenvio.
import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelVaccination, closeRabiesCampaign, listRabiesCampaigns, listVaccinations, openRabiesCampaign,
  type ZooRef, type RabiesCampaign, type RabiesVaccination
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { cityIsoDate } from "../lib/format";
import { fmtDay, textProblem } from "../lib/homeVisits";
import {
  OTHER_UNIT, STATIC_QUERY, ZOO_CAMPAIGNS_KEY, ZOO_DOMAINS_KEY, ZOO_VACCINATIONS_KEY, isZoonosesStale, zooLabel, zoonosesError, type ZoonosesRoles
} from "../lib/zoonoses";
import { ActionButton } from "../components/ActionButton";
import { ConfirmButton } from "../components/ConfirmButton";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { Tag } from "../components/Tag";
import { inputStyle } from "../components/formStyles";
import { SegmentedControl } from "../shell/SegmentedControl";
import { alert, box, fieldLabel, muted, panel, row, stack, title } from "./exams/styles";
import { CampaignForm } from "./zoonoses/CampaignForm";
import { EATAV_REMINDER, STOCK_SHORTFALL_NOTE, VaccinationForm } from "./zoonoses/VaccinationForm";
import { WeeklyResult } from "./zoonoses/WeeklyResult";
import { ZoonosesGate } from "./zoonoses/ZoonosesGate";
import { useZooDomains } from "./zoonoses/useZooDomains";

const STAGE: Record<string, string> = { planned: "planejada", open: "aberta", closed: "encerrada" };
type Editor = { kind: "new" } | { kind: "edit"; id: string } | null;
type Source = "campaign" | "routine";

export function ZooCampaigns({ today }: { today?: string } = {}) {
  return (
    <ZoonosesGate title="Campanhas e vacinação" sub="zoonoses · campanhas" allow={(r) => r.reader}>
      {(roles) => <Campaigns roles={roles} today={today ?? cityIsoDate()} />}
    </ZoonosesGate>
  );
}

function Campaigns({ roles, today }: { roles: ZoonosesRoles; today: string }) {
  const client = useQueryClient();
  const list = useQuery({ queryKey: [ ZOO_CAMPAIGNS_KEY ], queryFn: listRabiesCampaigns, ...STATIC_QUERY });
  // Q43: a dose e a lista de doses usam as unidades de vacinação dos domínios (todas as ativas; `/attendance/units` é fechado à
  // equipe de zoonoses). O canil segue com `units` (Q41).
  const units = { data: useZooDomains().data?.vaccination_units };
  const [ editor, setEditor ] = useState<Editor>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ picked, setPicked ] = useState<string | null>(null);
  const [ source, setSource ] = useState<Source>("campaign");
  const [ round, setRound ] = useState(0);
  const [ recorded, setRecorded ] = useState<string[]>([]);

  const campaigns = list.data ?? [];
  const open = campaigns.find((c) => c.stage === "open") ?? null;
  const selected = campaigns.find((c) => c.id === picked) ?? open ?? campaigns[0] ?? null;
  const routineOnly = !selected && roles.team && list.isSuccess;
  const reread = () => client.invalidateQueries({ queryKey: [ ZOO_CAMPAIGNS_KEY ] });
  const rereadDoses = () => client.invalidateQueries({ queryKey: [ ZOO_VACCINATIONS_KEY ] });
  const stale = (text: string) => { setNotice(text); setEditor(null); void reread(); };

  async function stage(c: RabiesCampaign, call: (id: string) => Promise<RabiesCampaign>, done: string) {
    setNotice(null);
    try {
      await call(c.id);
      setNotice(done);
      void reread();
      void client.invalidateQueries({ queryKey: [ ZOO_DOMAINS_KEY ] });
    } catch (err) {
      setNotice(zoonosesError(err));
      if (isZoonosesStale(err)) void reread();
    }
  }

  const cols: Column<RabiesCampaign>[] = [
    { label: "Campanha", w: "1.6fr", card: "title", render: (c) => c.name },
    { label: "Ano", w: "0.5fr", render: (c) => String(c.year) },
    { label: "Período", w: "1.2fr", render: (c) => `${fmtDay(c.starts_on)} a ${fmtDay(c.ends_on)}` },
    { label: "Metas", w: "1fr", render: (c) => `${c.goal_dogs} cães · ${c.goal_cats} gatos` },
    { label: "Etapa", w: "0.7fr", render: (c) => <Tag tone={c.stage === "open" ? "ok" : "neutral"}>{STAGE[c.stage] ?? c.stage}</Tag> },
    {
      label: "Ações", w: "1.6fr", card: "actions", render: (c) => (
        <span style={row}>
          <ActionButton variant="secondary" onClick={() => { setPicked(c.id); setSource("campaign"); }}>Ver campanha</ActionButton>
          {roles.coordinator && c.stage === "planned" && (
            <>
              <ActionButton variant="secondary" onClick={() => { setNotice(null); setEditor({ kind: "edit", id: c.id }); }}>Editar</ActionButton>
              <ConfirmButton label="Abrir campanha" question="Abrir esta campanha? Só uma pode estar aberta."
                onConfirm={() => stage(c, openRabiesCampaign, "Campanha aberta.")} />
            </>
          )}
          {roles.coordinator && c.stage === "open" && (
            <ConfirmButton label="Encerrar campanha" question="Encerrar esta campanha? As doses deixam de entrar nela."
              onConfirm={() => stage(c, closeRabiesCampaign, "Campanha encerrada.")} />
          )}
        </span>
      )
    }
  ];

  const editing = editor?.kind === "edit" ? campaigns.find((c) => c.id === editor.id) : undefined;
  return (
    <div style={stack}>
      {roles.coordinator && !editor && <div style={row}><ActionButton onClick={() => { setNotice(null); setEditor({ kind: "new" }); }}>Nova campanha</ActionButton></div>}
      {editor && (editor.kind === "new" || editing) && (
        <CampaignForm key={editing ? `${editing.id}-${editing.version}` : "new"} campaign={editing}
          onSaved={() => { setEditor(null); setNotice("Campanha salva."); void reread(); }} onStale={stale} onCancel={() => setEditor(null)} />
      )}
      {notice && <p role="status" style={muted}>{notice}</p>}
      {list.isLoading && <p style={muted}>carregando…</p>}
      {list.isError && <EmptyState title={zoonosesError(list.error)} />}
      {list.data && <DataTable<RabiesCampaign> label="Campanhas" cols={cols} rows={campaigns} rowKey={(c) => c.id} empty="nenhuma campanha" />}

      {roles.team && (
        <section style={panel} aria-label="Dose">
          <strong style={title}>Registrar dose</strong>
          {recorded.map((t) => <p key={t} role="status" style={muted}>{t}</p>)}
          <VaccinationForm key={round} campaign={open} today={today} units={units.data ?? []}
            onStale={() => { void reread(); void rereadDoses(); }}
            onRecorded={(v) => {
              setRecorded([
                "Dose registrada.", ...(v.stock_lot_id === null ? [ STOCK_SHORTFALL_NOTE ] : []),
                ...(v.reminder ? [ v.reminder ] : v.adverse_event ? [ EATAV_REMINDER ] : [])
              ]);
              setRound((n) => n + 1);
              void rereadDoses();
            }} />
        </section>
      )}

      {(selected || routineOnly) && (
        <section style={panel} aria-label="Campanha selecionada">
          <strong style={title}>{(source === "routine" || !selected) && roles.team ? "Doses de rotina" : "Doses e resultado semanal"}</strong>
          {roles.team && selected && (
            <SegmentedControl<Source> options={[ { key: "campaign", label: "Da campanha" }, { key: "routine", label: "Rotina" } ]} value={source} onChange={setSource} />
          )}
          {roles.team && <Doses source={selected ? source : "routine"} campaign={selected} roles={roles} units={units.data ?? []} />}
          {selected && source === "campaign" && <WeeklyResult key={selected.id} campaign={selected} today={today} />}
        </section>
      )}
    </div>
  );
}

// ─── Doses ───────────────────────────────────────────────────────────────────
function Doses({ source, campaign, roles, units }: { source: Source; campaign: RabiesCampaign | null; roles: ZoonosesRoles; units: ZooRef[] }) {
  const { user } = useAuth();
  const domains = useZooDomains().data;
  const key = source === "routine" || !campaign ? "routine" : campaign.id;
  const q = useInfiniteQuery({
    queryKey: [ ZOO_VACCINATIONS_KEY, key ], initialPageParam: null as string | null, ...STATIC_QUERY,
    queryFn: ({ pageParam }) => listVaccinations(source === "routine" || !campaign ? { modality: "routine", before: pageParam } : { campaignId: campaign.id, before: pageParam }),
    getNextPageParam: (last) => last.next_before
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  // Id fora das unidades de vacinação: "outra unidade", nunca o id cru (Q43).
  const unitName = (id: string | null) => (id ? units.find((u) => u.id === id)?.name ?? OTHER_UNIT : "—");
  const can = (v: RabiesVaccination) => !v.cancelled && (roles.coordinator || (roles.team && v.recorded_by_user_id === user?.id));

  const cols: Column<RabiesVaccination>[] = [
    { label: "Data", w: "0.8fr", card: "title", render: (v) => fmtDay(v.vaccinated_on) },
    { label: "Modalidade", w: "0.9fr", render: (v) => zooLabel(domains?.modalities, v.modality) },
    { label: "Espécie", w: "0.7fr", render: (v) => zooLabel(domains?.species, v.species) },
    { label: "Animal", w: "0.9fr", render: (v) => (v.animal_id ? "com cadastro" : "sem cadastro") },
    { label: "Unidade", w: "1fr", render: (v) => unitName(v.health_unit_id) },
    { label: "Situação", w: "0.7fr", render: (v) => (v.cancelled ? <Tag tone="neutral">anulada</Tag> : "registrada") },
    { label: "Ações", w: "1.4fr", card: "actions", render: (v) => (can(v) ? <CancelDose vaccination={v} /> : null) }
  ];
  return (
    <div style={stack}>
      {q.isLoading && <p style={muted}>carregando…</p>}
      {q.isError && <p role="alert" style={alert}>{zoonosesError(q.error)}</p>}
      {q.data && <DataTable<RabiesVaccination> label="Doses" cols={cols} rows={rows} rowKey={(v) => v.id} empty="nenhuma dose" />}
      {q.hasNextPage && <div style={row}><ActionButton variant="secondary" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Ver mais</ActionButton></div>}
    </div>
  );
}

// Anular a dose (quem registrou ou a coordenação): motivo 10–500; o api estorna o saldo. Dose já anulada (409) → releitura.
function CancelDose({ vaccination }: { vaccination: RabiesVaccination }) {
  const client = useQueryClient();
  const [ asking, setAsking ] = useState(false);
  const [ reason, setReason ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const reread = () => client.invalidateQueries({ queryKey: [ ZOO_VACCINATIONS_KEY ] });

  async function confirm() {
    if (busy) return;
    const bad = textProblem(reason, { min: 10, max: 500, path: "reason" });
    if (bad) { setProblem(bad.text); return; }
    setBusy(true);
    setProblem(null);
    try {
      await cancelVaccination(vaccination.id, reason.trim());
      setAsking(false);
      void reread();
    } catch (err) {
      setProblem(zoonosesError(err));
      if (isZoonosesStale(err)) void reread();
    } finally {
      setBusy(false);
    }
  }

  if (!asking) return <ActionButton variant="secondary" onClick={() => setAsking(true)}>Anular</ActionButton>;
  return (
    <div style={box} role="group" aria-label="Anular dose">
      <label style={fieldLabel}>
        Motivo da anulação
        <textarea value={reason} rows={2} disabled={busy} style={inputStyle} onChange={(e) => { setReason(e.target.value); setProblem(null); }} />
      </label>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      <div style={row}>
        <ActionButton variant="danger" busy={busy} onClick={confirm}>Confirmar anulação</ActionButton>
        <ActionButton variant="secondary" onClick={() => { if (!busy) { setAsking(false); setProblem(null); } }}>Voltar</ActionButton>
      </div>
    </div>
  );
}
