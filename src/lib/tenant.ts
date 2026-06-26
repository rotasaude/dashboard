// Fonte única do tenant na fase 1 (auth deferido — módulo 06). Quando o 06
// entrar, troca-se a origem (env → sessão) SÓ aqui.
export function municipalityId(): string {
  const id = import.meta.env.VITE_MUNICIPALITY_ID;
  if (!id || typeof id !== "string") {
    throw new Error(
      "VITE_MUNICIPALITY_ID não definido — defina o município do tenant no .env (ver .env.example)."
    );
  }
  return id;
}
