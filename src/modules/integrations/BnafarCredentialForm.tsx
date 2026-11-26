// Credencial da BNAFAR (módulo 27b; contrato Q9). Usuário e senha do Portal de
// Serviços vivem só no estado do SensitiveAction: nunca em URL, cache, storage
// ou console, e somem ao fechar. O ambiente é o da linha (produção é sempre
// produção; homologação só fora dela), sem escolha na tela.
import { setBnafarCredential, type IntegrationCredential } from "../../lib/api";
import { credentialLabel, integrationsError } from "../../lib/integrations";
import { SensitiveAction } from "../../components/SensitiveAction";

const SCREEN_ERRORS = [ "invalid_credential", "invalid_environment", "environment_not_allowed" ];
const SAVED = "Credencial da BNAFAR salva. Teste a conexão para conferir.";

export function BnafarCredentialForm({ credential, onDone, onCancel, onGoToSecurity }: {
  credential: IntegrationCredential;
  onDone(message: string): void;
  onCancel(): void;
  onGoToSecurity?(): void;
}) {
  const environment = credential.environment ?? "production";
  return (
    <SensitiveAction
      title={`${credential.set ? "Trocar" : "Cadastrar"} credencial — ${credentialLabel("bnafar", environment)}`}
      description="A senha é gravada cifrada e não aparece de novo, nem para você. Trocar substitui a anterior."
      requiresStepUp
      fields={[
        { name: "username", label: "Usuário do Portal de Serviços", required: true },
        { name: "password", label: "Senha", type: "password", required: true }
      ]}
      confirmLabel="Salvar credencial"
      run={async (values) => {
        // Usuário sem espaços nas pontas; a senha vai como digitada.
        await setBnafarCredential(values.username.trim(), values.password, environment);
      }}
      onDone={() => onDone(SAVED)}
      onCancel={onCancel}
      onGoToSecurity={onGoToSecurity}
      translateError={(err) => {
        const code = (err as { body?: { error?: string } })?.body?.error;
        return code && SCREEN_ERRORS.includes(code) ? integrationsError(err) : null;
      }}
    />
  );
}
