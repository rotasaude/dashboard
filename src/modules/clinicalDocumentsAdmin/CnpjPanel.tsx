// CNPJ da cidade (secretaria ou fundo municipal de saúde; spec §3; contrato §6
// e Divergência D2): obrigatório para a receita de enfermagem (COFEN 801/2026).
// Gravar passa pelo step-up; o dígito verificador é conferido aqui antes de ir
// ao api (que confere de novo: 422 invalid_cnpj). Vai só com os dígitos.
// A cidade sem perfil (404 not_found) não tem onde gravar: a tela diz.
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, errorCode, getCityDocumentsProfile, setCityCnpj } from "../../lib/api";
import { CITY_DOCS_PROFILE_KEY, cnpjDigits, documentError, formatCnpj, isValidCnpj } from "../../lib/clinicalDocuments";
import { Panel } from "../../components/Panel";
import { KeyValue } from "../../components/KeyValue";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle } from "../../components/formStyles";

const NO_PROFILE = "a cidade ainda não tem perfil cadastrado — avise o suporte para cadastrar o CNPJ";

// 404 = cidade sem perfil: não é falha da tela, é "não cadastrado" sem onde gravar.
async function loadProfile(): Promise<{ cnpj: string | null; missingProfile: boolean }> {
  try {
    return { cnpj: (await getCityDocumentsProfile()).cnpj ?? null, missingProfile: false };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { cnpj: null, missingProfile: true };
    throw err;
  }
}

export function CnpjPanel({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [ CITY_DOCS_PROFILE_KEY ], queryFn: loadProfile, retry: false });
  const [ editing, setEditing ] = useState(false);
  const [ notice, setNotice ] = useState<string | null>(null);
  const cnpj = query.data?.cnpj ?? null;
  const missingProfile = query.data?.missingProfile ?? false;

  return (
    <Panel title="CNPJ da cidade" sub="secretaria ou fundo municipal de saúde · sai na receita de enfermagem">
      <div style={body}>
        {query.isPending && <p className="mono" style={muted}>carregando…</p>}
        {query.isError && <p role="alert" style={alert}>{documentError(query.error)}</p>}
        {query.isSuccess && <KeyValue k="CNPJ" v={formatCnpj(cnpj)} />}
        {query.isSuccess && !cnpj && <p style={muted}>Sem o CNPJ, a receita de enfermagem não sai (COFEN 801/2026).</p>}
        {missingProfile && <p style={muted}>{NO_PROFILE}</p>}
        {notice && <p role="status" style={statusStyle}>{notice}</p>}
        {query.isSuccess && !missingProfile && !editing && (
          <div>
            <button type="button" style={buttonStyle} onClick={() => { setNotice(null); setEditing(true); }}>
              {cnpj ? "Trocar CNPJ" : "Cadastrar CNPJ"}
            </button>
          </div>
        )}
        {editing && (
          <SensitiveAction
            title={cnpj ? "Trocar o CNPJ da cidade" : "Cadastrar o CNPJ da cidade"}
            description="O CNPJ da secretaria ou do fundo municipal de saúde sai em toda receita de enfermagem emitida daqui em diante."
            requiresStepUp
            fields={[ { name: "cnpj", label: "CNPJ (14 caracteres)", required: true } ]}
            confirmLabel="Salvar CNPJ"
            run={async (values) => {
              if (!isValidCnpj(values.cnpj)) throw new ApiError(422, { error: "invalid_cnpj" }, "local");
              await setCityCnpj(cnpjDigits(values.cnpj));
            }}
            onDone={() => {
              setEditing(false); setNotice("CNPJ salvo.");
              void queryClient.invalidateQueries({ queryKey: [ CITY_DOCS_PROFILE_KEY ] });
            }}
            onCancel={() => setEditing(false)}
            onGoToSecurity={onGoToSecurity}
            translateError={(err) => (errorCode(err) ? documentError(err) : null)}
          />
        )}
      </div>
    </Panel>
  );
}

const body: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 16, fontSize: 12.5 };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
