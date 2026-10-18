// Baixa um arquivo lido com fetch (CSV, PDF) por um link temporário; o objeto
// é revogado depois de um minuto. Nada é gravado em console, log ou storage;
// o nome não leva dado pessoal: quem chama monta.
import type { SignatureFile } from "../../lib/api";

const BLOB_TTL_MS = 60_000;

export function saveFile(file: SignatureFile, name: string): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), BLOB_TTL_MS);
}
