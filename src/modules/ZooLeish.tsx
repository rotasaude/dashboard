// src/modules/ZooLeish.tsx
// Tela "Leishmaniose" do centro de zoonoses (módulo 35b, F-35.15): inquéritos (a coordenação cria, edita só o rascunho, abre e
// encerra; a equipe lê), exames (coleta e sorologia), o "Desfecho pendente" dos cães reagentes e as "Coleiras a trocar". O api decide
// o tamanho do inquérito, a etiqueta, a prevalência e a troca da coleira. Abrir e encerrar mandam `expected_version`; 409: a frase,
// UMA releitura, nenhum reenvio.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { closeLeishSurvey, listLeishSurveys, openLeishSurvey, type LeishSurvey, type LeishSurveyDetail } from "../lib/api";
import { cityIsoDate } from "../lib/format";
import { fmtDay } from "../lib/homeVisits";
import { STATIC_QUERY, ZOO_SURVEYS_KEY, isZoonosesStale, zooLabel, zoonosesError, type ZoonosesRoles } from "../lib/zoonoses";
import { ActionButton } from "../components/ActionButton";
import { ConfirmButton } from "../components/ConfirmButton";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { Tag } from "../components/Tag";
import { SegmentedControl } from "../shell/SegmentedControl";
import { muted, row, stack } from "./exams/styles";
import { CollarsPanel } from "./zoonoses/CollarsPanel";
import { SurveyDetail, SurveyForm } from "./zoonoses/SurveyForm";
import { PendingOutcomes, TestsPanel } from "./zoonoses/TestsPanel";
import { ZoonosesGate } from "./zoonoses/ZoonosesGate";
import { useZooDomains } from "./zoonoses/useZooDomains";

type Tab = "surveys" | "tests" | "outcome" | "collars";
const TABS: { key: Tab; label: string }[] = [
  { key: "surveys", label: "Inquéritos" }, { key: "tests", label: "Exames" }, { key: "outcome", label: "Desfecho pendente" },
  { key: "collars", label: "Coleiras a trocar" }
];
const STAGE: Record<string, string> = { draft: "rascunho", open: "aberto", closed: "encerrado" };

export function ZooLeish({ today, onGoToShelter }: { today?: string; onGoToShelter?(): void } = {}) {
  return (
    <ZoonosesGate title="Leishmaniose" sub="zoonoses · leishmaniose" allow={(r) => r.team}>
      {(roles) => <Leish roles={roles} today={today ?? cityIsoDate()} onGoToShelter={onGoToShelter} />}
    </ZoonosesGate>
  );
}

function Leish({ roles, today, onGoToShelter }: { roles: ZoonosesRoles; today: string; onGoToShelter?(): void }) {
  const [ tab, setTab ] = useState<Tab>("surveys");
  const surveys = useQuery({ queryKey: [ ZOO_SURVEYS_KEY ], queryFn: listLeishSurveys, ...STATIC_QUERY });
  return (
    <div style={stack}>
      <SegmentedControl<Tab> options={TABS} value={tab} onChange={setTab} />
      {tab === "surveys" && <Surveys roles={roles} />}
      {tab === "tests" && <TestsPanel today={today} surveys={surveys.data ?? []} />}
      {tab === "outcome" && <PendingOutcomes today={today} onGoToShelter={onGoToShelter} />}
      {tab === "collars" && <CollarsPanel today={today} />}
    </div>
  );
}

type Editor = { kind: "new" } | { kind: "edit"; id: string } | null;

function Surveys({ roles }: { roles: ZoonosesRoles }) {
  const client = useQueryClient();
  const domains = useZooDomains().data;
  const list = useQuery({ queryKey: [ ZOO_SURVEYS_KEY ], queryFn: listLeishSurveys, ...STATIC_QUERY });
  const [ editor, setEditor ] = useState<Editor>(null);
  const [ picked, setPicked ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const surveys = list.data ?? [];
  const reread = () => client.invalidateQueries({ queryKey: [ ZOO_SURVEYS_KEY ] });
  const stale = (text: string) => { setNotice(text); setEditor(null); void reread(); };

  function saved(d: LeishSurveyDetail) {
    client.setQueryData([ ZOO_SURVEYS_KEY, d.id ], d);
    setEditor(null);
    setPicked(d.id);
    setNotice("Rascunho salvo.");
    void client.invalidateQueries({ queryKey: [ ZOO_SURVEYS_KEY ], exact: true });
  }
  async function stage(s: LeishSurvey, call: (id: string, v: number) => Promise<LeishSurveyDetail>, done: string) {
    setNotice(null);
    try {
      const d = await call(s.id, s.version);
      client.setQueryData([ ZOO_SURVEYS_KEY, d.id ], d);
      setNotice(done);
      void client.invalidateQueries({ queryKey: [ ZOO_SURVEYS_KEY ], exact: true });
    } catch (err) {
      setNotice(zoonosesError(err));
      if (isZoonosesStale(err)) void reread();
    }
  }

  const cols: Column<LeishSurvey>[] = [
    { label: "Inquérito", w: "1.5fr", card: "title", render: (s) => s.name },
    { label: "Tipo", w: "0.8fr", render: (s) => zooLabel(domains?.leish_survey_kinds, s.kind) },
    { label: "Bairro", w: "1fr", render: (s) => s.neighborhood.name },
    { label: "Período", w: "1.2fr", render: (s) => `${fmtDay(s.starts_on)} a ${fmtDay(s.ends_on)}` },
    { label: "Cães a examinar", w: "0.8fr", render: (s) => String(s.target_dogs) },
    { label: "Etapa", w: "0.7fr", render: (s) => <Tag tone={s.stage === "open" ? "ok" : "neutral"}>{STAGE[s.stage] ?? s.stage}</Tag> },
    {
      label: "Ações", w: "1.8fr", card: "actions", render: (s) => (
        <span style={row}>
          <ActionButton variant="secondary" onClick={() => setPicked(s.id)}>Ver inquérito</ActionButton>
          {roles.coordinator && s.stage === "draft" && (
            <>
              <ActionButton variant="secondary" onClick={() => { setNotice(null); setEditor({ kind: "edit", id: s.id }); }}>Editar</ActionButton>
              <ConfirmButton label="Abrir inquérito" question="Abrir este inquérito? Depois os quarteirões e a população não mudam."
                onConfirm={() => stage(s, openLeishSurvey, "Inquérito aberto.")} />
            </>
          )}
          {roles.coordinator && s.stage === "open" && (
            <ConfirmButton label="Encerrar inquérito" question="Encerrar este inquérito? Novas coletas deixam de entrar nele."
              onConfirm={() => stage(s, closeLeishSurvey, "Inquérito encerrado.")} />
          )}
        </span>
      )
    }
  ];

  const editing = editor?.kind === "edit" ? surveys.find((s) => s.id === editor.id && s.stage === "draft") : undefined;
  return (
    <div style={stack}>
      {roles.coordinator && !editor && (
        <div style={row}><ActionButton onClick={() => { setNotice(null); setEditor({ kind: "new" }); }}>Novo inquérito</ActionButton></div>
      )}
      {editor && (editor.kind === "new" || editing) && (
        <SurveyForm key={editing ? `${editing.id}-${editing.version}` : "new"} survey={editing} onSaved={saved} onStale={stale} onCancel={() => setEditor(null)} />
      )}
      {notice && <p role="status" style={muted}>{notice}</p>}
      {list.isLoading && <p style={muted}>carregando…</p>}
      {list.isError && <EmptyState title={zoonosesError(list.error)} />}
      {list.data && <DataTable<LeishSurvey> label="Inquéritos" cols={cols} rows={surveys} rowKey={(s) => s.id} empty="nenhum inquérito" />}
      {picked && <SurveyDetail key={picked} id={picked} />}
    </div>
  );
}
