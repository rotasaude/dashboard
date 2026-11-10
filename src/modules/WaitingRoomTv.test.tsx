// A TV da sala de espera (F-32.5; contrato §8, §14 Q8; preflight A19/A20, C Task 12, E7): pareamento com o código de 6 dígitos em
// texto, só o token no localStorage, o quadro campo a campo (nada de nome, CPF, cor da pessoa nem queixa), polling de 5 s sem timer
// sobrando, sem rede mantém a última tela, 401 display_revoked/invalid_token volta ao pareamento, 429 recua e a TV nunca chama a sessão.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()), pairWaitingRoomDisplay: vi.fn(), fetchWaitingRoomBoard: vi.fn(), fetchCurrentSession: vi.fn()
}));

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { WAITING_ROOM_DISABLED } from "../lib/urgency";
import { NOW32, board } from "../test/urgencyFixtures";
import { DISPLAY_TOKEN_KEY, WaitingRoomTv } from "./WaitingRoomTv";

// Com chaves: o retorno do beforeEach/afterEach vira teardown no vitest.
beforeEach(() => {
  vi.mocked(api.pairWaitingRoomDisplay).mockReset();
  vi.mocked(api.fetchWaitingRoomBoard).mockReset();
  vi.mocked(api.fetchCurrentSession).mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });

const pair = (code: string) => {
  fireEvent.change(screen.getByLabelText("Código de pareamento"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Parear esta TV" }));
};

it("primeiro acesso pede o código; 6 dígitos; pareia e guarda só o token", async () => {
  vi.mocked(api.pairWaitingRoomDisplay).mockResolvedValue({ display_token: "tok-abc" });
  vi.mocked(api.fetchWaitingRoomBoard).mockResolvedValue(board());
  render(<WaitingRoomTv now={() => NOW32} />);
  expect(screen.getByText("Peça o código à administração da unidade (Urgência → Senhas, locais e TVs).")).not.toBeNull();
  pair("48291");
  expect(screen.getByText("o código tem 6 dígitos")).not.toBeNull();
  expect(api.pairWaitingRoomDisplay).not.toHaveBeenCalled();
  pair("482913");
  expect(await screen.findByText("U-042")).not.toBeNull();
  expect(localStorage.getItem("waitingRoom.displayToken")).toBe("tok-abc");
  expect(Object.keys(localStorage)).toEqual([ "waitingRoom.displayToken" ]);
  expect(DISPLAY_TOKEN_KEY).toBe("waitingRoom.displayToken");
  expect(api.fetchWaitingRoomBoard).toHaveBeenCalledWith("tok-abc");
  // O token nunca aparece na tela.
  expect(document.body.textContent).not.toContain("tok-abc");
});

it("o código vai como texto: o zero da frente conta", async () => {
  vi.mocked(api.pairWaitingRoomDisplay).mockResolvedValue({ display_token: "tok-abc" });
  vi.mocked(api.fetchWaitingRoomBoard).mockResolvedValue(board());
  render(<WaitingRoomTv />);
  const input = screen.getByLabelText("Código de pareamento");
  expect(input.getAttribute("inputmode")).toBe("numeric");
  expect(input.getAttribute("autocomplete")).toBe("one-time-code");
  pair("012345");
  await screen.findByText("U-042");
  expect(api.pairWaitingRoomDisplay).toHaveBeenCalledWith("012345");
});

it("código inválido ou vencido: a frase, sem guardar nada", async () => {
  vi.mocked(api.pairWaitingRoomDisplay).mockRejectedValue(new ApiError(422, { error: "invalid_pairing_code" }, "x"));
  render(<WaitingRoomTv />);
  pair("000000");
  expect(await screen.findByText("código inválido ou vencido — peça um código novo à administração")).not.toBeNull();
  expect(localStorage.getItem("waitingRoom.displayToken")).toBeNull();
  expect(api.fetchWaitingRoomBoard).not.toHaveBeenCalled();
});

it("um pareamento por vez; 429 mostra a frase de espera", async () => {
  let reject!: (e: unknown) => void;
  vi.mocked(api.pairWaitingRoomDisplay).mockReturnValue(new Promise((_, r) => { reject = r; }));
  render(<WaitingRoomTv />);
  pair("482913");
  fireEvent.click(screen.getByRole("button", { name: "Parear esta TV" }));
  expect(api.pairWaitingRoomDisplay).toHaveBeenCalledTimes(1);
  expect((screen.getByRole("button", { name: "Parear esta TV" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => reject(new ApiError(429, { error: "too_many_requests" }, "x")));
  expect(screen.getByText("muitas tentativas — aguarde um minuto")).not.toBeNull();
  expect((screen.getByRole("button", { name: "Parear esta TV" }) as HTMLButtonElement).disabled).toBe(false);
});

it("board lê campo a campo: chamada atual em destaque, as anteriores, tempos por cor e a frase da prioridade", async () => {
  localStorage.setItem("waitingRoom.displayToken", "tok-abc");
  const leaky = board({ calls: [ { ...board().calls[0], name: "Maria Lima", cpf: "52998224725", color: "red", complaint: "dor no peito",
    patient_id: "p-77" } as never, board().calls[1] ] });
  vi.mocked(api.fetchWaitingRoomBoard).mockResolvedValue(leaky);
  render(<WaitingRoomTv now={() => NOW32} />);
  const current = await screen.findByRole("region", { name: "Chamada agora" });
  expect(current.getAttribute("aria-live")).toBe("polite");
  expect(current.getAttribute("aria-atomic")).toBe("true");
  expect(within(current).getByText("U-042")).not.toBeNull();
  expect(within(current).getByText("Consultório 2")).not.toBeNull();
  expect(within(current).getByText("Atendimento")).not.toBeNull();
  expect(within(current).getByText("chamada às 09:59")).not.toBeNull();
  const previous = screen.getByRole("region", { name: "Chamadas anteriores" });
  expect(within(previous).getByText("U-041")).not.toBeNull();
  expect(within(previous).getByText("Classificação de risco")).not.toBeNull();
  expect(screen.getByText("UPA Boqueirão")).not.toBeNull();
  const waits = screen.getByRole("region", { name: "Tempo de espera agora" });
  expect(within(waits).getByText("amarelo")).not.toBeNull();
  expect(within(waits).getByText("laranja")).not.toBeNull();
  expect(within(waits).getByText("cerca de 34 min")).not.toBeNull();
  expect(within(waits).getAllByText("poucas pessoas aguardando")).toHaveLength(4);
  expect(screen.getByText("Quem corre mais risco é atendido primeiro, mesmo que tenha chegado depois.")).not.toBeNull();
  expect(screen.getByText("atualizado às 10:00")).not.toBeNull();
  expect(document.body.textContent).not.toMatch(/Maria|52998224725|dor no peito|p-77|tok-abc/);
});

it("só as 8 chamadas mais recentes: a atual e até 7 anteriores", async () => {
  localStorage.setItem("waitingRoom.displayToken", "tok-abc");
  const calls = Array.from({ length: 9 }, (_, i) => ({
    ticket: `U-0${50 - i}`, location: "Consultório 1", kind: "care" as const, called_at: "2026-11-05T09:50:00-03:00"
  }));
  vi.mocked(api.fetchWaitingRoomBoard).mockResolvedValue(board({ calls }));
  render(<WaitingRoomTv />);
  const previous = await screen.findByRole("region", { name: "Chamadas anteriores" });
  expect(within(previous).getAllByRole("listitem")).toHaveLength(7);
  expect(screen.queryByText("U-042")).toBeNull();
});

it("chamada sem local: a linha do local some", async () => {
  localStorage.setItem("waitingRoom.displayToken", "tok-abc");
  vi.mocked(api.fetchWaitingRoomBoard).mockResolvedValue(board({ calls: [ { ...board().calls[0], location: null } ] }));
  render(<WaitingRoomTv />);
  const current = await screen.findByRole("region", { name: "Chamada agora" });
  expect(within(current).getByText("U-042")).not.toBeNull();
  expect(current.textContent).not.toMatch(/null|—/);
});

it("enquanto conecta e com o painel desligado, o título é fixo, nunca um h1 vazio", async () => {
  localStorage.setItem("waitingRoom.displayToken", "tok-abc");
  vi.mocked(api.fetchWaitingRoomBoard).mockImplementation(() => new Promise(() => undefined));
  render(<WaitingRoomTv />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Painel de chamada");
  cleanup();
  vi.mocked(api.fetchWaitingRoomBoard).mockRejectedValue(new ApiError(403, { error: "feature_disabled", feature: "waiting_room_display" }, "x"));
  render(<WaitingRoomTv />);
  expect(await screen.findByText(WAITING_ROOM_DISABLED)).not.toBeNull();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Painel de chamada");
});

it("sem tempos (unidade não mostra): a seção some; sem chamadas: 'Aguarde ser chamado pela sua senha.'", async () => {
  localStorage.setItem("waitingRoom.displayToken", "tok-abc");
  vi.mocked(api.fetchWaitingRoomBoard).mockResolvedValue(board({ calls: [], wait_times: null }));
  render(<WaitingRoomTv />);
  expect(await screen.findByText("Aguarde ser chamado pela sua senha.")).not.toBeNull();
  expect(screen.queryByRole("region", { name: "Tempo de espera agora" })).toBeNull();
  expect(screen.queryByText("Quem corre mais risco é atendido primeiro, mesmo que tenha chegado depois.")).toBeNull();
});

describe("polling e falhas", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it("relê a cada 5 s; sem rede mantém a última tela com o aviso; revogada apaga o token e volta ao pareamento", async () => {
    localStorage.setItem("waitingRoom.displayToken", "tok-abc");
    vi.mocked(api.fetchWaitingRoomBoard).mockResolvedValueOnce(board()).mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new ApiError(401, { error: "display_revoked" }, "x"));
    const { unmount } = render(<WaitingRoomTv />);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText("U-042")).not.toBeNull();
    expect(screen.queryByText("sem conexão — tentando de novo")).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.getByText("U-042")).not.toBeNull();
    expect(screen.getByText("sem conexão — tentando de novo")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.getByLabelText("Código de pareamento")).not.toBeNull();
    expect(localStorage.getItem("waitingRoom.displayToken")).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.fetchWaitingRoomBoard).toHaveBeenCalledTimes(3);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("token desconhecido (invalid_token) também volta ao pareamento", async () => {
    localStorage.setItem("waitingRoom.displayToken", "tok-abc");
    vi.mocked(api.fetchWaitingRoomBoard).mockRejectedValue(new ApiError(401, { error: "invalid_token" }, "x"));
    render(<WaitingRoomTv />);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByLabelText("Código de pareamento")).not.toBeNull();
    expect(localStorage.getItem("waitingRoom.displayToken")).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(api.fetchWaitingRoomBoard).toHaveBeenCalledTimes(1);
  });

  it("volta a conexão: o aviso some e o quadro novo entra", async () => {
    localStorage.setItem("waitingRoom.displayToken", "tok-abc");
    vi.mocked(api.fetchWaitingRoomBoard).mockResolvedValueOnce(board()).mockRejectedValueOnce(new ApiError(503, "", "x"))
      .mockResolvedValue(board({ calls: [ { ...board().calls[0], ticket: "U-043" } ] }));
    render(<WaitingRoomTv />);
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.getByText("U-042")).not.toBeNull();
    expect(screen.getByText("sem conexão — tentando de novo")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.getByText("U-043")).not.toBeNull();
    expect(screen.queryByText("sem conexão — tentando de novo")).toBeNull();
  });

  it("429: mantém a tela com o aviso e recua um minuto antes de pedir de novo", async () => {
    localStorage.setItem("waitingRoom.displayToken", "tok-abc");
    vi.mocked(api.fetchWaitingRoomBoard).mockResolvedValueOnce(board())
      .mockRejectedValueOnce(new ApiError(429, { error: "too_many_requests" }, "x")).mockResolvedValue(board());
    const { unmount } = render(<WaitingRoomTv />);
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.fetchWaitingRoomBoard).toHaveBeenCalledTimes(2);
    expect(screen.getByText("U-042")).not.toBeNull();
    expect(screen.getByText("sem conexão — tentando de novo")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(55_000);
    expect(api.fetchWaitingRoomBoard).toHaveBeenCalledTimes(2);
    expect(screen.getByText("sem conexão — tentando de novo")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(api.fetchWaitingRoomBoard).toHaveBeenCalledTimes(3);
    expect(screen.queryByText("sem conexão — tentando de novo")).toBeNull();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("painel desligado na cidade: a frase no lugar do quadro, e segue tentando", async () => {
    localStorage.setItem("waitingRoom.displayToken", "tok-abc");
    vi.mocked(api.fetchWaitingRoomBoard).mockResolvedValueOnce(board())
      .mockRejectedValueOnce(new ApiError(403, { error: "feature_disabled", feature: "waiting_room_display" }, "x"))
      .mockResolvedValue(board());
    render(<WaitingRoomTv />);
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.getByText(WAITING_ROOM_DISABLED)).not.toBeNull();
    expect(screen.queryByText("U-042")).toBeNull();
    expect(localStorage.getItem("waitingRoom.displayToken")).toBe("tok-abc");
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.getByText("U-042")).not.toBeNull();
    expect(screen.queryByText(WAITING_ROOM_DISABLED)).toBeNull();
  });
});

it("401 que chega depois de desmontar não apaga o token guardado", async () => {
  localStorage.setItem("waitingRoom.displayToken", "tok-abc");
  let reject!: (e: unknown) => void;
  vi.mocked(api.fetchWaitingRoomBoard).mockReturnValue(new Promise((_, r) => { reject = r; }));
  const { unmount } = render(<WaitingRoomTv />);
  expect(api.fetchWaitingRoomBoard).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => reject(new ApiError(401, { error: "display_revoked" }, "x")));
  expect(localStorage.getItem("waitingRoom.displayToken")).toBe("tok-abc");
});

it("localStorage indisponível: pareia e mostra o quadro com o token só na memória", async () => {
  const broken = {
    getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceeded"); },
    removeItem: () => { throw new Error("SecurityError"); }
  } as unknown as Storage;
  vi.mocked(api.pairWaitingRoomDisplay).mockResolvedValue({ display_token: "tok-abc" });
  vi.mocked(api.fetchWaitingRoomBoard).mockResolvedValue(board());
  render(<WaitingRoomTv storage={broken} />);
  pair("482913");
  expect(await screen.findByText("U-042")).not.toBeNull();
  expect(api.fetchWaitingRoomBoard).toHaveBeenCalledWith("tok-abc");
});

describe("tela cheia", () => {
  // O jsdom não tem a API de tela cheia: o teste a põe e tira.
  const root = document.documentElement as unknown as { requestFullscreen?: () => Promise<void> };
  afterEach(() => {
    Reflect.deleteProperty(root, "requestFullscreen");
    Reflect.deleteProperty(document, "fullscreenElement");
  });

  it("o botão e a tecla F pedem tela cheia; o botão some depois de entrar", async () => {
    root.requestFullscreen = vi.fn(() => Promise.resolve());
    localStorage.setItem("waitingRoom.displayToken", "tok-abc");
    vi.mocked(api.fetchWaitingRoomBoard).mockResolvedValue(board());
    render(<WaitingRoomTv />);
    await screen.findByText("U-042");
    fireEvent.click(screen.getByRole("button", { name: "Tela cheia" }));
    expect(root.requestFullscreen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "f" });
    expect(root.requestFullscreen).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "fullscreenElement", { value: root, configurable: true });
    act(() => { document.dispatchEvent(new Event("fullscreenchange")); });
    expect(screen.queryByRole("button", { name: "Tela cheia" })).toBeNull();
  });

  it("navegador sem tela cheia: nenhum botão", async () => {
    localStorage.setItem("waitingRoom.displayToken", "tok-abc");
    vi.mocked(api.fetchWaitingRoomBoard).mockResolvedValue(board());
    render(<WaitingRoomTv />);
    await screen.findByText("U-042");
    expect(screen.queryByRole("button", { name: "Tela cheia" })).toBeNull();
  });
});

it("nenhuma chamada de sessão nem de outra rota do dashboard", async () => {
  localStorage.setItem("waitingRoom.displayToken", "tok-abc");
  vi.mocked(api.fetchWaitingRoomBoard).mockResolvedValue(board());
  render(<WaitingRoomTv />);
  await screen.findByText("U-042");
  expect(api.fetchCurrentSession).not.toHaveBeenCalled();
  expect(api.pairWaitingRoomDisplay).not.toHaveBeenCalled();
});
