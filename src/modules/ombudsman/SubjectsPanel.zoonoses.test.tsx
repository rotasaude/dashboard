// Ouvidoria e zoonoses (módulo 35b; F-35.13; Q14): cadeado nos assuntos reservados (sem "Desativar" com o centro ligado) e as
// chaves da demanda de zoonoses no balcão (`zoonoses_subtype`, `place_address`), só em Solicitação e Denúncia e só com o portão.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { options, ombudsmanUser, settings33 } from "../../test/ombudsmanFixtures";
import { ZOO_FEATURES, zooUser } from "../../test/zoonosesFixtures";
import * as api from "../../lib/api";
import { ApiError, type OmbudsmanSubject, type SessionUser } from "../../lib/api";
import { OMBUDSMAN_ERRORS } from "../../lib/ombudsman";
import { ZOONOSES_ERRORS } from "../../lib/zoonosesErrors";
import { OmbudsmanNew } from "../OmbudsmanNew";
import { OmbudsmanSettings } from "../OmbudsmanSettings";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getOmbudsmanSettings: vi.fn(),
  listOmbudsmanSubjects: vi.fn(), updateOmbudsmanSubject: vi.fn(), listOmbudsmanResponders: vi.fn(), listResponderCandidates: vi.fn(),
  getOmbudsmanOptions: vi.fn(), createOmbudsmanManifestation: vi.fn(), getOmbudsmanReceipt: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const LOCK = "assunto reservado do centro de zoonoses";
const WITH_OMB = [ ...ZOO_FEATURES, "ombudsman" ];
const subjects = (): OmbudsmanSubject[] => [
  { id: "z0", name: "Zoonoses", active: true, code: "zoonoses", children: [ { id: "z1", name: "Escorpião", active: true, code: "zoonoses.scorpion" } ] },
  { id: "s6", name: "Transporte", active: true, code: null, children: [] }
];

function mountSettings(user: SessionUser) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  vi.mocked(api.getOmbudsmanSettings).mockResolvedValue(settings33());
  vi.mocked(api.listOmbudsmanSubjects).mockResolvedValue(subjects());
  vi.mocked(api.listOmbudsmanResponders).mockResolvedValue([]);
  vi.mocked(api.listResponderCandidates).mockResolvedValue([]);
  vi.mocked(api.getOmbudsmanOptions).mockResolvedValue(options());
  return renderWithProviders(<OmbudsmanSettings />);
}

describe("assuntos reservados do centro de zoonoses", () => {
  it("com zoonoses: pai e filho com código mostram o cadeado e não desativam; renomear fica; o assunto da cidade não muda", async () => {
    mountSettings(ombudsmanUser([ "ombudsman" ], WITH_OMB));
    expect(await screen.findByText("Escorpião")).not.toBeNull();
    expect(screen.getAllByLabelText(LOCK).length).toBe(2);
    expect(screen.queryByRole("button", { name: "Desativar Zoonoses" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Desativar Escorpião" })).toBeNull();
    expect(screen.getByRole("button", { name: "Renomear Zoonoses" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Renomear Escorpião" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Desativar Transporte" })).not.toBeNull();
  });

  it("sem zoonoses: o Desativar volta; sem código, nada muda", async () => {
    mountSettings(ombudsmanUser([ "ombudsman" ]));
    expect(await screen.findByText("Escorpião")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Desativar Zoonoses" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Desativar Escorpião" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Desativar Transporte" })).not.toBeNull();
  });

  it("zoonoses ligado sem o cadastro territorial: o Desativar fica (o api só recusa com o portão inteiro)", async () => {
    mountSettings(ombudsmanUser([ "ombudsman" ], [ "ombudsman", "zoonoses" ]));
    expect(await screen.findByText("Escorpião")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Desativar Zoonoses" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Desativar Escorpião" })).not.toBeNull();
  });

  it("409 reserved_subject (corrida): a frase do centro de zoonoses", async () => {
    // Sessão ainda sem o interruptor, o api já com ele: a corrida da configuração.
    vi.mocked(api.updateOmbudsmanSubject).mockRejectedValue(new ApiError(409, { error: "reserved_subject" }, "x"));
    mountSettings(ombudsmanUser([ "ombudsman" ]));
    fireEvent.click(await screen.findByRole("button", { name: "Desativar Escorpião" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(ZOONOSES_ERRORS.reserved_subject)).not.toBeNull();
    expect(OMBUDSMAN_ERRORS.reserved_subject).toBe(ZOONOSES_ERRORS.reserved_subject);
  });
});

const BODY = "Há um escorpião na calçada da escola e as crianças brincam ali.";
const ADDRESS = "Rua das Flores, 100, Centro";

function mountNew(features: string[] = WITH_OMB) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(zooUser([ "ombudsman_staff" ], features));
  vi.mocked(api.getOmbudsmanOptions).mockResolvedValue(options());
  vi.mocked(api.createOmbudsmanManifestation).mockResolvedValue({ id: "m9", protocol: "2026-000130", due_on: "2026-12-11" });
  return renderWithProviders(<OmbudsmanNew onOpenManifestation={vi.fn()} />);
}
async function fill(kind: string, mode?: string) {
  fireEvent.change(await screen.findByLabelText("Tipo"), { target: { value: kind } });
  fireEvent.click(screen.getByLabelText("Presencial"));
  if (mode) fireEvent.click(screen.getByLabelText(mode));
  fireEvent.change(screen.getByLabelText("Texto da manifestação"), { target: { value: BODY } });
}
const QUESTION = "É sobre animais, insetos ou bichos?";
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Registrar manifestação" }));
const sent = () => vi.mocked(api.createOmbudsmanManifestation).mock.calls[0][0];

describe("balcão: demanda de zoonoses (Q14)", () => {
  it("Sim sem endereço não envia; com endereço leva o subtipo e o endereço", async () => {
    mountNew();
    await fill("request");
    fireEvent.change(screen.getByLabelText("Nome informado"), { target: { value: "José Alves" } });
    const group = await screen.findByRole("group", { name: QUESTION });
    expect(within(group).getByLabelText("Não")).toHaveProperty("checked", true);
    fireEvent.click(within(group).getByLabelText("Sim"));
    expect([ ...(screen.getByLabelText("Qual o problema?") as HTMLSelectElement).options ].map((o) => o.text).slice(1, 3)).toEqual([ "Escorpião", "Morcego" ]);
    fireEvent.change(screen.getByLabelText("Qual o problema?"), { target: { value: "scorpion" } });
    fireEvent.change(screen.getByLabelText("Onde fica o problema? (endereço do local)"), { target: { value: "Rua A" } });
    submit();
    expect(await screen.findByText("escreva de 10 a 300 caracteres")).not.toBeNull();
    expect(api.createOmbudsmanManifestation).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Onde fica o problema? (endereço do local)"), { target: { value: ADDRESS } });
    submit();
    await waitFor(() => expect(api.createOmbudsmanManifestation).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual({
      kind: "request", identification_mode: "identified", channel: "in_person", manifestant_name: "José Alves", body: BODY,
      zoonoses_subtype: "scorpion", place_address: ADDRESS
    });
  });

  it("sem escolher o tipo do problema não envia; denúncia anônima também leva as chaves", async () => {
    mountNew();
    await fill("report", "Anônima (só denúncia)");
    fireEvent.click(within(await screen.findByRole("group", { name: QUESTION })).getByLabelText("Sim"));
    fireEvent.change(screen.getByLabelText("Onde fica o problema? (endereço do local)"), { target: { value: ADDRESS } });
    submit();
    expect(await screen.findByText("escolha o tipo do problema")).not.toBeNull();
    expect(api.createOmbudsmanManifestation).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Qual o problema?"), { target: { value: "bat" } });
    submit();
    await waitFor(() => expect(api.createOmbudsmanManifestation).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ kind: "report", identification_mode: "anonymous", zoonoses_subtype: "bat", place_address: ADDRESS });
  });

  it("Não: nada de zoonoses no corpo; Elogio, Reclamação e Sugestão não mostram a pergunta", async () => {
    mountNew();
    await fill("request");
    fireEvent.change(screen.getByLabelText("Nome informado"), { target: { value: "José Alves" } });
    expect(await screen.findByRole("group", { name: QUESTION })).not.toBeNull();
    for (const kind of [ "praise", "complaint", "suggestion" ]) {
      fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: kind } });
      expect(screen.queryByRole("group", { name: QUESTION })).toBeNull();
    }
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "request" } });
    submit();
    await waitFor(() => expect(api.createOmbudsmanManifestation).toHaveBeenCalledTimes(1));
    expect(Object.keys(sent())).not.toContain("zoonoses_subtype");
    expect(Object.keys(sent())).not.toContain("place_address");
  });

  it("duplo clique em Registrar com Sim e o endereço: um envio só", async () => {
    mountNew();
    await fill("request");
    fireEvent.change(screen.getByLabelText("Nome informado"), { target: { value: "José Alves" } });
    fireEvent.click(within(await screen.findByRole("group", { name: QUESTION })).getByLabelText("Sim"));
    fireEvent.change(screen.getByLabelText("Qual o problema?"), { target: { value: "scorpion" } });
    fireEvent.change(screen.getByLabelText("Onde fica o problema? (endereço do local)"), { target: { value: ADDRESS } });
    submit();
    submit();
    await waitFor(() => expect(api.createOmbudsmanManifestation).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ zoonoses_subtype: "scorpion", place_address: ADDRESS });
  });

  it("sem o interruptor zoonoses a pergunta não aparece", async () => {
    mountNew([ "ombudsman" ]);
    await fill("request");
    expect(screen.queryByRole("group", { name: QUESTION })).toBeNull();
  });

  it("trocar para um tipo sem a pergunta descarta o que foi marcado", async () => {
    mountNew();
    await fill("request");
    fireEvent.change(screen.getByLabelText("Nome informado"), { target: { value: "José Alves" } });
    fireEvent.click(within(await screen.findByRole("group", { name: QUESTION })).getByLabelText("Sim"));
    fireEvent.change(screen.getByLabelText("Qual o problema?"), { target: { value: "tick" } });
    fireEvent.change(screen.getByLabelText("Onde fica o problema? (endereço do local)"), { target: { value: ADDRESS } });
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "complaint" } });
    submit();
    await waitFor(() => expect(api.createOmbudsmanManifestation).toHaveBeenCalledTimes(1));
    expect(Object.keys(sent())).not.toContain("zoonoses_subtype");
    expect(Object.keys(sent())).not.toContain("place_address");
  });
});
