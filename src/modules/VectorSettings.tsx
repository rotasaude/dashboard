// src/modules/VectorSettings.tsx
// "Produtos e parâmetros" da coordenação de endemias (módulo 35a, F-35.3; contrato §4, §11). Papel: só a coordenação
// (ProductsController e SettingsController: coordinator!; PUT /parameters também, com step-up). Três painéis: os produtos de campo,
// os parâmetros técnicos versionados e o local de estoque de onde o boletim baixa. Nada aqui é dado de pessoa.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { getVectorSettings, putVectorSettings, type VectorSettings as Settings } from "../lib/api";
import { STATIC_QUERY, VC_SETTINGS_KEY, canUseVectorControl, vectorError, vectorRefusals } from "../lib/vectorControl";
import { useActionMessage } from "../lib/useActionMessage";
import { VectorGate } from "./vectorControl/VectorGate";
import { ProductsPanel } from "./vectorControl/ProductsPanel";
import { ParametersPanel } from "./vectorControl/ParametersPanel";
import { Panel } from "../components/Panel";
import { ActionButton } from "../components/ActionButton";
import { ActionMessage } from "../components/ActionMessage";
import { inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, stack } from "./exams/styles";

export const NO_LOCATION = "sem local, cada aplicação vira falta de insumo (sem local)";
export const LOCATION_GONE = "este local não está mais ativo ou não é do controle vetorial — a lista de locais foi relida";
export const LOCATION_SAVED = "local de estoque salvo";

export function VectorSettings({ onGoToSecurity }: { onGoToSecurity?: () => void } = {}) {
  const { user } = useAuth();
  // Módulo 35b: só com `zoonoses` ficam os produtos e o local; os parâmetros técnicos são do 35a (`vector_control`).
  const parametersOn = canUseVectorControl(user);
  return (
    <VectorGate title="Produtos e parâmetros" sub="endemias · produtos, parâmetros e ajustes" allow={(r) => r.coordinator} supplies>
      {() => (
        <div style={stack}>
          <ProductsPanel />
          {parametersOn && <ParametersPanel onGoToSecurity={onGoToSecurity} />}
          <StockLocationPanel />
        </div>
      )}
    </VectorGate>
  );
}

function StockLocationPanel() {
  const settings = useQuery({ queryKey: [ VC_SETTINGS_KEY ], queryFn: getVectorSettings, ...STATIC_QUERY });
  // A mensagem mora aqui: gravar troca o local salvo e remonta o seletor.
  const msg = useActionMessage();
  const data = settings.data;
  return (
    <Panel title="Local de estoque" sub="de onde o boletim baixa os produtos aplicados">
      <div style={stack}>
        {settings.isError ? <p role="alert" style={alert}>{vectorError(settings.error)}</p>
          : !data ? <p role="status" style={muted}>Carregando…</p>
          : <LocationForm key={`${data.stock_location?.id ?? ""}|${data.options.map((o) => o.id).join(",")}`} saved={data} msg={msg} />}
        <ActionMessage message={msg.message} />
      </div>
    </Panel>
  );
}

function LocationForm({ saved, msg }: { saved: Settings; msg: ReturnType<typeof useActionMessage> }) {
  const queryClient = useQueryClient();
  const current = saved.stock_location?.id ?? "";
  const [ picked, setPicked ] = useState(current);
  // O local salvo aparece mesmo se saiu das opções (desativado depois).
  const options = saved.stock_location && !saved.options.some((o) => o.id === current) ? [ ...saved.options, saved.stock_location ] : saved.options;

  async function save() {
    msg.start();
    try {
      const result = await putVectorSettings(picked === "" ? null : picked);
      queryClient.setQueryData([ VC_SETTINGS_KEY ], result);
      msg.ok(LOCATION_SAVED);
    } catch (err) {
      // Local desativado (ou que deixou de ser vector_control) entre a leitura e o envio: a frase e UMA releitura das opções.
      const refusal = vectorRefusals(err)[0];
      if (refusal.code === "invalid_request" && refusal.path === "stock_location_id") {
        msg.fail(LOCATION_GONE);
        await queryClient.invalidateQueries({ queryKey: [ VC_SETTINGS_KEY ] });
      } else msg.fail(refusal.text);
    }
  }

  return (
    <div style={stack}>
      <label style={{ ...fieldLabel, maxWidth: 360 }}>
        Local de estoque do boletim
        <select value={picked} style={inputStyle} onChange={(e) => { setPicked(e.target.value); msg.start(); }}>
          <option value="">sem baixa de estoque</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
      {picked === "" && <p style={muted}>{NO_LOCATION}</p>}
      {saved.options.length === 0 && <p style={muted}>nenhum local de estoque do controle vetorial ativo — cadastre um no estoque</p>}
      <div><ActionButton onClick={save} disabledReason={picked === current ? "escolha outro local para salvar" : null}>Salvar local</ActionButton></div>
    </div>
  );
}
