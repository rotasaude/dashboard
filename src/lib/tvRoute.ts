// A TV da sala de espera vive em `/#/tv`, fora do shell. Só o caminho decide; nada sensível no hash.
export const isTvHash = (hash: string): boolean => hash === "#/tv" || hash === "#/tv/";
