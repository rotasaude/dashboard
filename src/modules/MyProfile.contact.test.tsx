import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getMyProfessional: vi.fn(), getProfessionalContact: vi.fn() };
});

import * as api from "../lib/api";
import { MyProfile } from "./MyProfile";
import { renderWithProviders } from "../test/campaignFixtures";
import { contact, controlledUser } from "../test/controlledFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const PROFESSIONAL = {
  professional: { id: "pr1", user_id: "us1", email_address: "medica@curitiba.demo", professional_name: "Dra. Helena Prado",
    council: "CRM", council_state: "PR", registration_number: "45678", cns_masked: "***.****.****.1234", phone: null, contact_email: null },
  links: [], shifts: []
};

afterEach(cleanup);

describe("Meu perfil — endereço e telefone da receita (19d)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(api.getMyProfessional).mockResolvedValue(PROFESSIONAL);
    mocked(api.getProfessionalContact).mockResolvedValue(contact());
  });

  it("com controlled_prescriptions, mostra o painel do endereço e telefone", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(controlledUser());
    renderWithProviders(<MyProfile />);
    expect(await screen.findByText("Endereço e telefone na receita de controle especial")).not.toBeNull();
  });

  it("sem o interruptor, nem consulta o contato", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(controlledUser([ "health_professional" ], { features: [ "clinical_record", "clinical_documents" ] }));
    renderWithProviders(<MyProfile />);
    expect(await screen.findByText("Dados conferidos pela prefeitura")).not.toBeNull();
    expect(screen.queryByText("Endereço e telefone na receita de controle especial")).toBeNull();
    expect(api.getProfessionalContact).not.toHaveBeenCalled();
  });
});
