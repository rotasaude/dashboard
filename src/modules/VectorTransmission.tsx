// src/modules/VectorTransmission.tsx
// "Bloqueio de transmissão" da coordenação de endemias (módulo 35a, F-35.7; contrato §8, §17; Q8, Q9, Q13(6)(9), Q26, Q28). Papel: só a
// coordenação (TransmissionBlocksController: coordinator!; o vector_lab recebe 403 e o portão nem lê). O api propõe o bloqueio pela
// notificação (Blocks::Propose); aqui a coordenação revê, confirma (step-up), descarta, fecha, lança os ciclos de UBV e junta casos.
// Lista por status em abas, propostos primeiro (GET /transmission_blocks?status[]=, mais recente primeiro, com cursor; sem pessoa nem
// trilha: STATIC_QUERY, relida depois de cada ação). Cada aba lê ao ser aberta pela primeira vez e depois fica montada e escondida.
// Colunas: doença dos casos, casos ("2 casos"), quarteirão do caso, criado em; nunca paciente. O detalhe é o BlockDetail.
// Nada em URL ou storage; nenhum polling.
import { useState } from "react";
import { listTransmissionBlocks, type TransmissionBlock, type TransmissionBlockStatus } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { VC_BLOCKS_TB_KEY, vectorError } from "../lib/vectorControl";
import { VectorGate } from "./vectorControl/VectorGate";
import { VectorListBody } from "./vectorControl/VectorListBody";
import { BlockDetail } from "./vectorControl/BlockDetail";
import { usePaged } from "./homeVisits/usePaged";
import { SegmentedControl } from "../shell/SegmentedControl";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { secondaryButtonStyle } from "../components/formStyles";
import { stack } from "./exams/styles";

const TABS: { key: TransmissionBlockStatus; label: string }[] = [
  { key: "proposed", label: "Propostos" }, { key: "active", label: "Ativos" }, { key: "closed", label: "Fechados" }, { key: "dismissed", label: "Descartados" }
];
const EMPTY: Record<TransmissionBlockStatus, string> = {
  proposed: "nenhuma proposta de bloqueio", active: "nenhum bloqueio ativo", closed: "nenhum bloqueio fechado", dismissed: "nenhuma proposta descartada"
};
const diseasesText = (b: TransmissionBlock) => [ ...new Set(b.cases.map((c) => c.disease)) ].join(", ") || "—";
const casesText = (n: number) => (n === 1 ? "1 caso" : `${n} casos`);

export function VectorTransmission({ onGoToSecurity }: { onGoToSecurity?: () => void } = {}) {
  return (
    <VectorGate title="Bloqueio de transmissão" sub="endemias · bloqueio pelos casos notificados" allow={(r) => r.coordinator}>
      {() => <TransmissionScreen onGoToSecurity={onGoToSecurity} />}
    </VectorGate>
  );
}

function TransmissionScreen({ onGoToSecurity }: { onGoToSecurity?: () => void }) {
  const [ tab, setTab ] = useState<TransmissionBlockStatus>("proposed");
  const [ visited, setVisited ] = useState<ReadonlySet<TransmissionBlockStatus>>(() => new Set<TransmissionBlockStatus>([ "proposed" ]));
  const [ selectedId, setSelectedId ] = useState<string | null>(null);
  const open = (t: TransmissionBlockStatus) => {
    setTab(t);
    setVisited((v) => (v.has(t) ? v : new Set([ ...v, t ])));
  };
  return (
    <div style={stack}>
      <div><SegmentedControl options={TABS} value={tab} onChange={open} /></div>
      {TABS.map(({ key, label }) => visited.has(key) && (
        <div key={key} role="tabpanel" aria-label={label} style={{ ...stack, display: tab === key ? "flex" : "none" }}>
          <BlocksList status={key} label={label} selectedId={selectedId} onOpen={setSelectedId} />
        </div>
      ))}
      {selectedId && <BlockDetail key={selectedId} id={selectedId} onGoToSecurity={onGoToSecurity} />}
    </div>
  );
}

function BlocksList({ status, label, selectedId, onOpen }: {
  status: TransmissionBlockStatus; label: string; selectedId: string | null; onOpen(id: string): void;
}) {
  const list = usePaged<TransmissionBlock>([ VC_BLOCKS_TB_KEY, status ], (before) => listTransmissionBlocks({ status: [ status ], before }),
    false, true, vectorError);
  return (
    <VectorListBody list={list}>
      {(items) => items.length === 0 ? <EmptyState title={EMPTY[status]} /> : (
        <DataTable label={`Bloqueios ${label.toLowerCase()}`} rows={items} rowKey={(b) => b.id} cols={[
          { label: "Doença", w: "1.6fr", card: "title", render: (b) => <strong>{diseasesText(b)}</strong> },
          { label: "Casos", render: (b) => casesText(b.cases.length) },
          { label: "Quarteirão do caso", render: (b) => b.center_block?.number ?? "sem quarteirão" },
          { label: "Criado em", w: "1.2fr", render: (b) => fmtDateTime(b.created_at) },
          { label: "Ações", card: "actions", render: (b) => (
            <button type="button" style={secondaryButtonStyle} aria-pressed={selectedId === b.id}
              aria-label={`Abrir o bloqueio criado em ${fmtDateTime(b.created_at)}`} onClick={() => onOpen(b.id)}>Abrir</button>
          ) }
        ]} />
      )}
    </VectorListBody>
  );
}
