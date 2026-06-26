// Cliente HTTP do dashboard (read-only, tenant-scoped). Consome /admin/api/*
// (namespace Admin::). Envelope universal: { data, as_of }. credentials:
// "include" para quando o módulo 06 (auth por cookie) entrar.
const BASE = import.meta.env.VITE_ADMIN_API_BASE || "/admin/api";

export interface ScopeBlock {
  municipality: { id: string | null; name: string; cross_tenant: boolean };
  period: { key: string; label: string; axis: string };
  tz: string;
}

export interface Envelope<T> {
  data: T & { scope?: ScopeBlock };
  as_of: string;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function jsonFetch<T>(input: string): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    headers: { Accept: "application/json" }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body: unknown = text;
    if (text) { try { body = JSON.parse(text); } catch { /* deixa string */ } }
    throw new ApiError(res.status, body, `${res.status} on ${input}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function adminFetch<T>(
  path: string,
  params?: Record<string, string | undefined>
): Promise<Envelope<T>> {
  const url = new URL(BASE + path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([ k, v ]) => {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    });
  }
  return jsonFetch<Envelope<T>>(url.toString());
}
