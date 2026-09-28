import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSessionQueryClient } from "./sessionQueryClient";

// Um QueryClient por usuário logado: o cache não pode sobreviver a uma troca
// de usuário na mesma aba (ver src/main.tsx). Mesmo userId entre renders
// mantém o mesmo client (reload()/step-up não pode zerar o cache); trocar de
// userId cria um client novo e limpa o anterior, para que nenhum dado de um
// usuário sirva a outro, nem por um frame.
describe("useSessionQueryClient", () => {
  it("mantém o mesmo client entre rerenders com o mesmo userId", () => {
    const onUnauthorized = vi.fn();
    const { result, rerender } = renderHook(
      ({ userId, cb }: { userId: string | null; cb: () => void }) => useSessionQueryClient(userId, cb),
      { initialProps: { userId: "user-a", cb: onUnauthorized } }
    );

    const first = result.current;

    // Troca a identidade do callback: não deve recriar o client.
    const onUnauthorized2 = vi.fn();
    rerender({ userId: "user-a", cb: onUnauthorized2 });

    expect(result.current).toBe(first);
  });

  it("troca de usuário A para B cria client novo e limpa o cache de A", () => {
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string | null }) => useSessionQueryClient(userId, vi.fn()),
      { initialProps: { userId: "user-a" as string | null } }
    );

    const clientA = result.current;
    clientA.setQueryData([ "team" ], { name: "Equipe da cidade A" });
    expect(clientA.getQueryData([ "team" ])).toEqual({ name: "Equipe da cidade A" });

    rerender({ userId: "user-b" });

    const clientB = result.current;
    expect(clientB).not.toBe(clientA);
    expect(clientB.getQueryData([ "team" ])).toBeUndefined();
    expect(clientA.getQueryData([ "team" ])).toBeUndefined();
  });

  it("logout (A para null) limpa o cache do client de A", () => {
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string | null }) => useSessionQueryClient(userId, vi.fn()),
      { initialProps: { userId: "user-a" as string | null } }
    );

    const clientA = result.current;
    clientA.setQueryData([ "team" ], { name: "Equipe da cidade A" });

    rerender({ userId: null });

    expect(result.current).not.toBe(clientA);
    expect(clientA.getQueryData([ "team" ])).toBeUndefined();
  });

  it("nunca limpa nem desmonta o client vigente ao rerenderizar com o mesmo userId", () => {
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string | null }) => useSessionQueryClient(userId, vi.fn()),
      { initialProps: { userId: "user-a" as string | null } }
    );

    const clientA = result.current;
    const clearSpy = vi.spyOn(clientA, "clear");
    const unmountSpy = vi.spyOn(clientA, "unmount");
    clientA.setQueryData([ "team" ], { name: "Equipe da cidade A" });

    // Mesmo userId, várias vezes: o client vigente nunca é limpo/desmontado
    // (inclui o duplo-invoke de efeitos que o StrictMode simula em dev).
    rerender({ userId: "user-a" });
    rerender({ userId: "user-a" });

    expect(result.current).toBe(clientA);
    expect(clearSpy).not.toHaveBeenCalled();
    expect(unmountSpy).not.toHaveBeenCalled();
    expect(clientA.getQueryData([ "team" ])).toEqual({ name: "Equipe da cidade A" });
  });

  it("depois da troca A→B comitada, o client de B nunca é limpo e o de A é limpo e desmontado uma vez", () => {
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string | null }) => useSessionQueryClient(userId, vi.fn()),
      { initialProps: { userId: "user-a" as string | null } }
    );

    const clientA = result.current;
    const clearSpyA = vi.spyOn(clientA, "clear");
    const unmountSpyA = vi.spyOn(clientA, "unmount");

    rerender({ userId: "user-b" });

    const clientB = result.current;
    expect(clientB).not.toBe(clientA);
    expect(clearSpyA).toHaveBeenCalledTimes(1);
    expect(unmountSpyA).toHaveBeenCalledTimes(1);

    const clearSpyB = vi.spyOn(clientB, "clear");
    clientB.setQueryData([ "team" ], { name: "Equipe da cidade B" });

    // Rerenderizar de novo com B (mesmo id) não deve tocar no client vigente.
    rerender({ userId: "user-b" });

    expect(result.current).toBe(clientB);
    expect(clearSpyB).not.toHaveBeenCalled();
    expect(clientB.getQueryData([ "team" ])).toEqual({ name: "Equipe da cidade B" });
  });
});
