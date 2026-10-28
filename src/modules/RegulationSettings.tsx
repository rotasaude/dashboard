// RegulationSettings — prazos por cor e lista do enfermeiro (módulo 26a; F-26.1; contrato §6, G5).
// Só o municipal_admin chega aqui; toda escrita passa pelo step-up. O api sempre devolve as quatro cores (padrões 7/30/90/180 se a
// cidade ainda não tem linha). A ordem dos prazos (cor menos grave nunca menor que a mais grave) é conferida antes e de novo no
// api (`invalid_deadlines`); os campos ficam como foram digitados quando algo é recusado.
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRiskDeadlines, listNurseItems, removeNurseItem, updateRiskDeadlines } from "../lib/api";
import type { NurseItem, RiskDeadlines } from "../lib/api";
import { COLORS, REG_DEADLINES_KEY, REG_NURSE_KEY, STATIC_QUERY, deadlinesProblem, regulationError, typeLabel } from "../lib/regulation";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { RegulationGate } from "./regulation/RegulationGate";
import { NurseItemForm } from "./regulation/NurseItemForm";
import { fieldBox, fieldsetStyle, hintStyle } from "./regulation/styles";

const DEADLINE_NOTE = "O prazo conta da data do pedido; mudar vale para os pedidos novos.";
const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
const daysGrid: CSSProperties = { display: "flex", gap: 16, flexWrap: "wrap" };

export function RegulationSettings({ onGoToSecurity }: { onGoToSecurity?: () => void } = {}) {
  return (
    <RegulationGate title="Prazos e lista do enfermeiro" sub="prazos por cor e o que o enfermeiro pode pedir" allow={(r) => r.admin}>
      {() => <Body onGoToSecurity={onGoToSecurity} />}
    </RegulationGate>
  );
}

function Body({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const [ notice, setNotice ] = useState<string | null>(null);
  return (
    <div style={stack}>
      {notice && <p role="status" style={statusStyle}>{notice}</p>}
      <DeadlinesPanel onSaved={setNotice} onGoToSecurity={onGoToSecurity} />
      <NursePanel notice={setNotice} onGoToSecurity={onGoToSecurity} />
    </div>
  );
}

function DeadlinesPanel({ onSaved, onGoToSecurity }: { onSaved(message: string): void; onGoToSecurity?(): void }) {
  const deadlines = useQuery({ queryKey: [ REG_DEADLINES_KEY ], queryFn: getRiskDeadlines, ...STATIC_QUERY });
  return (
    <Panel title="Prazos por cor" sub="dias para a regulação atender, pela cor de risco">
      <div style={stack}>
        {deadlines.isPending && <p className="mono" style={muted}>carregando…</p>}
        {deadlines.isError && <p role="alert" style={alert}>{regulationError(deadlines.error)}</p>}
        {/* A chave recria o formulário quando os prazos guardados mudam (depois de salvar). */}
        {deadlines.data && <DeadlinesForm key={JSON.stringify(deadlines.data)} saved={deadlines.data} onSaved={onSaved} onGoToSecurity={onGoToSecurity} />}
      </div>
    </Panel>
  );
}

function DeadlinesForm({ saved, onSaved, onGoToSecurity }: { saved: RiskDeadlines; onSaved(message: string): void; onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const [ values, setValues ] = useState<Record<keyof RiskDeadlines, string>>({
    red: String(saved.red), yellow: String(saved.yellow), green: String(saved.green), blue: String(saved.blue)
  });
  const [ error, setError ] = useState<string | null>(null);
  const [ confirming, setConfirming ] = useState(false);

  function review() {
    const problem = deadlinesProblem(values);
    if (problem) { setError(problem); return; }
    setConfirming(true);
  }
  const body = (): RiskDeadlines => ({
    red: Number(values.red.trim()), yellow: Number(values.yellow.trim()), green: Number(values.green.trim()), blue: Number(values.blue.trim())
  });

  return (
    <>
      <fieldset disabled={confirming} style={fieldsetStyle}>
        <div style={stack}>
          <div style={daysGrid}>
            {COLORS.map((c) => (
              <div key={c.key} style={fieldBox}>
                <label style={fieldLabel}>
                  {`${c.label.charAt(0).toUpperCase()}${c.label.slice(1)} (dias)`}
                  <input value={values[c.key]} inputMode="numeric" style={{ ...inputStyle, maxWidth: 120 }}
                    onChange={(e) => { setError(null); setValues({ ...values, [c.key]: e.target.value }); }} />
                </label>
                <span style={hintStyle}>de 1 a 365</span>
              </div>
            ))}
          </div>
          <p style={muted}>{DEADLINE_NOTE}</p>
          {error && <p role="alert" style={alert}>{error}</p>}
          {!confirming && (
            <div style={row}>
              <button type="button" style={buttonStyle} onClick={review}>Salvar prazos</button>
            </div>
          )}
        </div>
      </fieldset>
      {confirming && (
        <SensitiveAction
          title="Mudar os prazos por cor"
          description={`Vermelho ${values.red.trim()}, amarelo ${values.yellow.trim()}, verde ${values.green.trim()} e azul ${values.blue.trim()} dias. ${DEADLINE_NOTE}`}
          requiresStepUp
          confirmLabel="Confirmar"
          run={() => updateRiskDeadlines(body()).then(() => undefined)}
          onDone={() => {
            setConfirming(false);
            onSaved("Prazos atualizados.");
            void queryClient.invalidateQueries({ queryKey: [ REG_DEADLINES_KEY ] });
          }}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => regulationError(err)}
        />
      )}
    </>
  );
}

function NursePanel({ notice, onGoToSecurity }: { notice(message: string | null): void; onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const items = useQuery({ queryKey: [ REG_NURSE_KEY ], queryFn: listNurseItems, ...STATIC_QUERY });
  const [ adding, setAdding ] = useState(false);
  const [ removing, setRemoving ] = useState<NurseItem | null>(null);

  const reload = () => { void queryClient.invalidateQueries({ queryKey: [ REG_NURSE_KEY ] }); };
  function openAdd() { notice(null); setRemoving(null); setAdding(true); }
  function openRemove(item: NurseItem) { notice(null); setAdding(false); setRemoving(item); }

  return (
    <>
      <Panel title="O que o enfermeiro pode pedir" sub="especialidades e procedimentos da lista do município"
        right={<button type="button" style={secondaryButtonStyle} onClick={openAdd}>Acrescentar item</button>}>
        <div style={stack}>
          {items.isPending && <p className="mono" style={muted}>carregando…</p>}
          {items.isError && <p role="alert" style={alert}>{regulationError(items.error)}</p>}
          {items.data && (
            <DataTable<NurseItem>
              cols={[
                { label: "Tipo", w: "1.2fr", render: (i) => typeLabel(i.target_type) },
                { label: "Código", w: "1fr", render: (i) => <span className="mono">{i.target_code}</span> },
                { label: "Nome", w: "2fr", card: "title", render: (i) => i.name },
                {
                  label: "Ação", w: "100px", card: "actions",
                  render: (i) => <button type="button" style={secondaryButtonStyle} onClick={() => openRemove(i)}>Retirar</button>
                }
              ]}
              rows={items.data} rowKey={(i) => `${i.target_type}-${i.target_code}`} empty="a lista está vazia: o enfermeiro não pede nada"
            />
          )}
        </div>
      </Panel>
      {adding && (
        <NurseItemForm onCancel={() => setAdding(false)} onGoToSecurity={onGoToSecurity}
          onSaved={(message) => { setAdding(false); notice(message); reload(); }} />
      )}
      {removing && (
        <SensitiveAction
          key={`${removing.target_type}-${removing.target_code}`}
          title="Retirar da lista do enfermeiro"
          description={`${removing.name} (${typeLabel(removing.target_type)}) deixa de poder ser pedido pelo enfermeiro. Os pedidos já feitos não mudam.`}
          requiresStepUp
          confirmLabel="Confirmar"
          run={() => removeNurseItem({ target_type: removing.target_type, target_code: removing.target_code })}
          onDone={() => { setRemoving(null); notice("Item retirado da lista do enfermeiro."); reload(); }}
          onCancel={() => setRemoving(null)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => regulationError(err)}
        />
      )}
    </>
  );
}
