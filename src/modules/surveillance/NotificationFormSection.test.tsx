import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), updateNotificationForm: vi.fn() }));
import * as api from "../../lib/api";
import { ApiError, type SurveillanceNotification } from "../../lib/api";
import { NotificationFormSection } from "./NotificationFormSection";
import { NOTIFICATION_KEY, STALE_TEXT } from "../../lib/surveillance";
import { notification } from "../../test/surveillanceFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const update = () => mocked(api.updateNotificationForm);
const KEYS = [ "pregnancy", "race_color", "schooling", "residence_uf", "residence_district", "residence_neighborhood", "residence_street",
  "residence_number", "residence_complement", "residence_geo1", "residence_geo2", "residence_reference", "residence_zip", "phone",
  "residence_zone", "residence_country", "occupation_cbo" ];
const body = (over: Record<string, string | null>) => ({ ...Object.fromEntries(KEYS.map((k) => [ k, null ])), ...over });

function tree(n: SurveillanceNotification, onSaved = vi.fn(), client = new QueryClient()) {
  return <QueryClientProvider client={client}><NotificationFormSection notification={n} onSaved={onSaved} /></QueryClientProvider>;
}
const mount = (status = "investigating", form: Record<string, string> = { race_color: "4" }, onSaved = vi.fn(), client = new QueryClient()) =>
  render(tree(notification({ status, version: 4, form }), onSaved, client));
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Salvar ficha" }));

describe("NotificationFormSection", () => {
  beforeEach(() => { update().mockReset(); });

  it("um campo por linha da ficha, com o valor da notificação; o código mostra o rótulo", () => {
    mount("investigating", { race_color: "4", residence_zip: "01310100", residence_uf: "PR" });
    for (const label of [ "Gestante", "Raça/Cor", "Escolaridade", "UF", "Distrito", "Bairro", "Logradouro", "Número", "Complemento", "Geo campo 1",
      "Geo campo 2", "Ponto de referência", "CEP", "(DDD) Telefone", "Zona", "País (se residente fora do Brasil)", "Ocupação (CBO)" ]) {
      expect(screen.getByLabelText(label)).not.toBeNull();
    }
    const race = field("Raça/Cor") as HTMLSelectElement;
    expect(race.value).toBe("4");
    expect(race.options[race.selectedIndex].text).toBe("Parda");
    expect(field("CEP").value).toBe("01310100");
    expect((field("UF") as HTMLSelectElement).value).toBe("PR");
    expect(field("Bairro").value).toBe("");
  });

  it("nenhum campo corta o digitado (sem maxLength)", () => {
    mount();
    expect(document.querySelectorAll("[maxlength]").length).toBe(0);
  });

  it("salva a ficha inteira com a versão; limpa o que ficou vazio; zero à esquerda fica", async () => {
    update().mockResolvedValue(notification({ version: 5, form: { race_color: "4", residence_zip: "01310100" } }));
    const onSaved = vi.fn();
    mount("investigating", { race_color: "4" }, onSaved);
    type("CEP", "01310100");
    type("Zona", "1");
    fireEvent.click(screen.getByRole("button", { name: "Salvar ficha" }));
    await waitFor(() => expect(update().mock.calls[0]).toEqual([ "nt1", body({ race_color: "4", residence_zip: "01310100", residence_zone: "1" }), 4 ]));
    expect(onSaved.mock.calls[0][0].version).toBe(5);
    expect((await screen.findByRole("status")).textContent).toBe("Ficha salva.");
  });

  it("depois de salvar, a resposta do api vira a ficha da tela", async () => {
    update().mockResolvedValue(notification({ version: 5, form: { phone: "4133334444" } }));
    mount();
    type("(DDD) Telefone", "(41) 3333-4444");
    save();
    await screen.findByRole("status");
    expect(field("(DDD) Telefone").value).toBe("4133334444");
    expect(field("Raça/Cor").value).toBe("");
  });

  it("confere antes de enviar: nada vai, a frase leva o rótulo e o foco vai ao campo", async () => {
    mount();
    type("CEP", "1310100");
    save();
    expect((await screen.findByRole("alert")).textContent).toBe("CEP: 8 dígitos");
    expect(update()).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field("CEP"));
  });

  it("422 invalid_form com path: a frase e o foco no campo", async () => {
    update().mockRejectedValue(new ApiError(422, { error: "invalid_form", path: "form.residence_street" }, "x"));
    mount();
    save();
    expect((await screen.findByRole("alert")).textContent).toBe("confira o campo indicado na ficha");
    expect(document.activeElement).toBe(field("Logradouro"));
  });

  it("422 invalid_form com path form: a frase geral, sem foco em campo", async () => {
    update().mockRejectedValue(new ApiError(422, { error: "invalid_form", path: "form" }, "x"));
    mount();
    save();
    expect((await screen.findByRole("alert")).textContent).toBe("a ficha tem dado que o sistema não aceita — confira os campos");
    expect(document.activeElement).toBe(document.body);
  });

  it("invalid_transition ao salvar: ficha travada", async () => {
    update().mockRejectedValue(new ApiError(422, { error: "invalid_transition" }, "x"));
    mount();
    save();
    expect((await screen.findByRole("alert")).textContent).toBe("ficha travada — recarregue");
  });

  it("409 stale_version na ficha: frase e os valores ficam", async () => {
    update().mockRejectedValue(new ApiError(409, { error: "stale_version" }, "x"));
    mount();
    type("Logradouro", "Rua das Flores");
    save();
    expect((await screen.findByRole("alert")).textContent).toBe(STALE_TEXT);
    expect(field("Logradouro").value).toBe("Rua das Flores");
    expect(field("Raça/Cor").value).toBe("4");
    expect(update()).toHaveBeenCalledTimes(1); // nada é reenviado sozinho
  });

  it("Recarregar relê o detalhe; a versão nova traz os campos que não foram digitados e mantém os digitados", async () => {
    update().mockRejectedValue(new ApiError(409, { error: "stale_version" }, "x"));
    const client = new QueryClient();
    const refetch = vi.spyOn(client, "refetchQueries").mockResolvedValue();
    const view = mount("investigating", { race_color: "4" }, vi.fn(), client);
    type("Logradouro", "Rua das Flores");
    save();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    expect(refetch).toHaveBeenCalledWith({ queryKey: [ NOTIFICATION_KEY, "nt1" ] });
    view.rerender(tree(notification({ status: "investigating", version: 5, form: { race_color: "2", phone: "4133334444" } }), vi.fn(), client));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field("Logradouro").value).toBe("Rua das Flores"); // digitado
    expect(field("Raça/Cor").value).toBe("2"); // da versão nova
    expect(field("(DDD) Telefone").value).toBe("4133334444");
    update().mockResolvedValue(notification({ version: 6 }));
    save();
    await waitFor(() => expect(update().mock.calls[1][2]).toBe(5));
  });

  it("outra recusa não oferece Recarregar", async () => {
    update().mockRejectedValue(new ApiError(422, { error: "invalid_form", path: "form.phone" }, "x"));
    mount();
    save();
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Recarregar" })).toBeNull();
  });

  it("o erro e a tela nunca repetem o dado em console ou no alerta", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    update().mockRejectedValue(new ApiError(422, { error: "invalid_form", path: "form.phone" }, "x"));
    mount();
    type("(DDD) Telefone", "41999990000");
    save();
    const alertText = (await screen.findByRole("alert")).textContent ?? "";
    expect(alertText).not.toContain("41999990000");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("possível, notificada, investigando e encerrada: editável", () => {
    for (const status of [ "possible", "notified", "investigating", "closed" ]) {
      mount(status);
      expect(screen.getByRole("button", { name: "Salvar ficha" })).not.toBeNull();
      cleanup();
    }
  });

  it("digitada, descartada ou situação desconhecida: só leitura, com os rótulos e sem botão", () => {
    for (const status of [ "entered", "dismissed", "novo_estado" ]) {
      mount(status, { race_color: "4", residence_zip: "01310100", residence_zone: "2" });
      expect(screen.queryByRole("button", { name: "Salvar ficha" })).toBeNull();
      expect(screen.queryByLabelText("CEP")).toBeNull();
      expect(screen.getByText("Parda")).not.toBeNull();
      expect(screen.getByText("01310100")).not.toBeNull();
      expect(screen.getByText("Rural")).not.toBeNull();
      cleanup();
    }
  });
});
