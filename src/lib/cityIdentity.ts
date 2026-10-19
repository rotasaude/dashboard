// src/lib/cityIdentity.ts
// Identidade pública da cidade (nome, UF, fuso, brasão) para a tela de login,
// que aparece ANTES de qualquer sessão. Falha de rede ou cidade desconhecida
// nunca vira erro na tela: o hook devolve null e o login segue sem identidade.
import { useEffect, useState } from "react";

export interface CityIdentity {
  name: string;
  uf: string | null;
  time_zone: string;
  health_department_name: string | null;
  coat_of_arms_url: string | null;
}

export async function fetchCityIdentity(signal?: AbortSignal): Promise<CityIdentity> {
  const res = await fetch("/city_identity", { credentials: "omit", signal });
  if (!res.ok) throw new Error(`city_identity ${res.status}`);
  return (await res.json()) as CityIdentity;
}

// null enquanto carrega e quando falha; aborta a requisição ao desmontar.
export function useCityIdentity(): CityIdentity | null {
  const [identity, setIdentity] = useState<CityIdentity | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchCityIdentity(controller.signal)
      .then((i) => { if (!controller.signal.aborted) setIdentity(i); })
      .catch(() => { /* silencioso: sem identidade, o login segue */ });
    return () => controller.abort();
  }, []);
  return identity;
}

export function cityLabel(i: Pick<CityIdentity, "name" | "uf">): string {
  return i.uf ? `${i.name} · ${i.uf}` : i.name;
}

// Turno no fuso da cidade: 05–11 manhã, 12–17 tarde, 18–04 noite. Fuso
// inválido (RangeError do Intl) cai no fuso do navegador: a identidade nunca
// pode derrubar a tela de login.
function hourIn(now: Date, timeZone?: string): number {
  return Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
}

export function shiftGreeting(now: Date, timeZone?: string): "Bom dia." | "Boa tarde." | "Boa noite." {
  let hour: number;
  try {
    hour = hourIn(now, timeZone);
  } catch {
    hour = hourIn(now, undefined);
  }
  if (hour >= 5 && hour < 12) return "Bom dia.";
  if (hour >= 12 && hour < 18) return "Boa tarde.";
  return "Boa noite.";
}
