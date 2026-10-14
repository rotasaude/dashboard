// src/modules/ExamsUnit.tsx
// Exames da unidade (módulo 21a; spec §9 "Recepção/unidade"): a unidade
// escolhida (a mesma do Atendimento), a guia da recepção, o resultado
// externo e a lista para agendar, registrar coleta e resultado. A tela é da
// equipe da unidade (recepção em qualquer unidade, profissional com vínculo —
// o api confere e responde not_unit_staff); C4: o administrador municipal não
// é da unidade e não recebe a tela.
import { useState, type ReactNode } from "react";
import type { ExamPatient, HealthUnit } from "../lib/api";
import { useAuth } from "../lib/auth";
import { EXAMS_DISABLED, EXAMS_NO_ROLE, canUseExams, examRoles } from "../lib/exams";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { EmptyState } from "../components/EmptyState";
import { buttonStyle, secondaryButtonStyle } from "../components/formStyles";
import { UnitPicker } from "./attendance/UnitPicker";
import { ReceptionGuideForm } from "./exams/ReceptionGuideForm";
import { PatientLookup } from "./exams/PatientLookup";
import { ExternalResultForm } from "./exams/ExternalResultForm";
import { UnitExamList } from "./exams/UnitExamList";
import { OverduePanel } from "./exams/OverduePanel";
import { okText, row, stack } from "./exams/styles";

type Mode = null | "guide" | "external";

export function ExamsUnit() {
  const { user } = useAuth();
  const [ unit, setUnit ] = useState<HealthUnit | null>(null);
  const [ mode, setMode ] = useState<Mode>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ externalPatient, setExternalPatient ] = useState<ExamPatient | null>(null);

  if (!user) return null;
  if (!canUseExams(user)) return <Frame><EmptyState title={EXAMS_DISABLED} /></Frame>;
  const roles = examRoles(user);
  if (!(roles.reception || roles.professional)) return <Frame><EmptyState title={EXAMS_NO_ROLE} /></Frame>;
  const close = (text: string | null) => { setExternalPatient(null); setMode(null); setNotice(text); };

  return (
    <Frame>
      <UnitPicker userId={user.id} onChange={(u) => { setUnit(u); close(null); }} />
      {unit && (
        <>
          {notice && <p role="status" style={okText}>{notice}</p>}
          {mode === null && (
            <div style={row}>
              <button type="button" style={buttonStyle} onClick={() => { setNotice(null); setMode("guide"); }}>Nova guia</button>
              <button type="button" style={secondaryButtonStyle} onClick={() => { setNotice(null); setMode("external"); }}>Resultado externo</button>
            </div>
          )}
          {mode === "guide" && (
            <Panel title="Nova guia" sub="pedido feito fora do Rota Saúde, cadastrado pela guia de papel">
              <ReceptionGuideForm unit={unit} onCancel={() => close(null)} onDone={(o) => close(`Guia registrada · código ${o.short_code}`)} />
            </Panel>
          )}
          {mode === "external" && (
            <Panel title="Registrar resultado externo" sub="exame feito fora de um pedido do Rota Saúde">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <PatientLookup patient={externalPatient} onFound={setExternalPatient} />
                {externalPatient ? (
                  <ExternalResultForm patientId={externalPatient.id} onCancel={() => close(null)}
                    onDone={() => close("Resultado externo registrado.")} />
                ) : (
                  <div><button type="button" style={secondaryButtonStyle} onClick={() => close(null)}>Voltar</button></div>
                )}
              </div>
            </Panel>
          )}
          {/* key: trocar de unidade descarta o exame aberto, a aba e os filtros. */}
          <UnitExamList key={`list:${unit.id}`} unit={unit} />
          <OverduePanel key={`overdue:${unit.id}`} unitId={unit.id} canOpen />
        </>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={stack}>
      <PageHeader title="Exames da unidade" sub="guias, agendamento, coleta e resultado" />
      {children}
    </div>
  );
}
