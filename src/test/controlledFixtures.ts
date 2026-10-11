// Dados comuns aos testes do módulo 19d (receita de controlado, SNCR).
// Relógio: sábado, 2026-10-10 10:00 em São Paulo (-03:00). A autora é `us1`
// (médica, CBO 225142), a mesma das fixtures do 19a/19b/19c. Endereços,
// telefone e números SNCR são fictícios; o CPF do paciente vem mascarado.
// Os itens de documento têm o `catalog_item` SEM as marcas de lista (como o
// api grava); as marcas só existem na busca, na REMUME e no protocolo.
import type {
  CatalogItemRef, ClinicalDocument, MedicationSearchItem, PrescriberContact, PrescriptionContent, ProfessionalContact,
  SessionUser, SncrAddress, SncrOverview, SncrStock
} from "../lib/api";
import { sessionWith } from "./campaignFixtures";
import { catalogItem, prescriptionDoc, prescriptionItem, searchItem, AMOXICILLIN } from "./documentFixtures";

export const NOW19D = "2026-10-10T10:00:00-03:00";
export const TODAY19D = "2026-10-10";

// Janela de step-up aberta (sessionWith põe `mfa_verified_at` = agora): crie a
// sessão DEPOIS de fixar o relógio.
export function controlledUser(roles: string[] = [ "health_professional" ], over: Partial<SessionUser> = {}): SessionUser {
  return sessionWith(roles, {
    id: "us1", email_address: "medica@curitiba.demo",
    features: [ "clinical_record", "digital_signature", "clinical_documents", "controlled_prescriptions" ], ...over
  });
}

const c1 = (over: Partial<MedicationSearchItem>) =>
  searchItem({ controlled: true, controlled_list: "C1", anticonvulsant: false, antimicrobial: false, in_network: true, ...over });

export const SERTRALINE = c1({
  id: "ci10", catmat_code: 267503, label: "Sertralina, cloridrato 50 mg, comprimido", active_ingredient: "cloridrato de sertralina",
  strength: "50 mg", dosage_form: "comprimido"
});
export const AMITRIPTYLINE = c1({
  id: "ci11", catmat_code: 267504, label: "Amitriptilina, cloridrato 25 mg, comprimido", active_ingredient: "cloridrato de amitriptilina",
  strength: "25 mg", dosage_form: "comprimido"
});
export const FLUOXETINE = c1({
  id: "ci12", catmat_code: 267505, label: "Fluoxetina, cloridrato 20 mg, cápsula", active_ingredient: "cloridrato de fluoxetina",
  strength: "20 mg", dosage_form: "cápsula"
});
export const CARBAMAZEPINE = c1({
  id: "ci13", catmat_code: 267506, label: "Carbamazepina 200 mg, comprimido", active_ingredient: "carbamazepina",
  strength: "200 mg", dosage_form: "comprimido", anticonvulsant: true
});
export const MORPHINE = searchItem({
  id: "ci14", catmat_code: 267507, label: "Morfina, sulfato 10 mg, comprimido", active_ingredient: "sulfato de morfina",
  strength: "10 mg", dosage_form: "comprimido", controlled: true, controlled_list: "A1", in_network: false
});
export const CLONAZEPAM_B1 = searchItem({
  id: "ci3", catmat_code: 269999, label: "Clonazepam 2 mg, comprimido", active_ingredient: "clonazepam",
  strength: "2 mg", dosage_form: "comprimido", controlled: true, controlled_list: "B1", in_network: false
});
export const ISOTRETINOIN = searchItem({
  id: "ci15", catmat_code: 267508, label: "Isotretinoína 20 mg, cápsula", active_ingredient: "isotretinoína",
  strength: "20 mg", dosage_form: "cápsula", controlled: true, controlled_list: "C2", in_network: false
});
export const AMOXICILLIN_19D: MedicationSearchItem = { ...AMOXICILLIN, controlled_list: null, anticonvulsant: false };
// Referência COM marcas (busca, REMUME, protocolo); o item de documento não as tem.
export const SERTRALINE_REF: CatalogItemRef = catalogItem({
  id: "ci10", catmat_code: 267503, label: "Sertralina, cloridrato 50 mg, comprimido", active_ingredient: "cloridrato de sertralina",
  strength: "50 mg", dosage_form: "comprimido", controlled_list: "C1", anticonvulsant: false
});

export function address(over: Partial<SncrAddress> = {}): SncrAddress {
  return { street: "Rua Marechal Deodoro", number: "630", complement: "apto 12", district: "Centro", city: "Curitiba", uf: "PR",
    zip: "80010010", ...over };
}

export function prescriberContact(over: Partial<PrescriberContact> = {}): PrescriberContact {
  return {
    address: { street: "Rua Ouvidor Pardinho", number: "28", district: "Rebouças", city: "Curitiba", uf: "PR", zip: "80230040" },
    phone: "4133501234", ...over
  };
}

export function contact(over: Partial<ProfessionalContact> = {}): ProfessionalContact {
  return { ...prescriberContact(), ...over };
}

export function stock(over: Partial<SncrStock> = {}): SncrStock {
  return {
    rce: { free: 812, used: 180, voided: 8, requests_this_month: 1 },
    ret: { free: 40, used: 960, voided: 0, requests_this_month: 2 },
    low_threshold: 50, simulated: false, ...over
  };
}

function rceContent(over: Partial<PrescriptionContent> = {}): PrescriptionContent {
  return {
    items: [ prescriptionItem({
      catalog_item: catalogItem({
        id: "ci10", catmat_code: 267503, label: "Sertralina, cloridrato 50 mg, comprimido", active_ingredient: "cloridrato de sertralina",
        strength: "50 mg", dosage_form: "comprimido"
      }),
      printed_description: "Cloridrato de sertralina 50 mg — comprimido",
      quantity: 60, dosage_instructions: "1 comprimido pela manhã", duration_days: 60, continuous: true
    }) ],
    antimicrobial: false, copies: 2, valid_until: "2026-11-09", category: "special_control",
    sncr: { kind: "rce", number: "2610.1-41.0001234", simulated: false },
    patient_identification: { cpf: "39053344705", address: address() },
    prescriber_contact: prescriberContact(), ...over
  };
}

export function rceDoc(over: Partial<ClinicalDocument> = {}, content: Partial<PrescriptionContent> = {}): ClinicalDocument {
  return prescriptionDoc({
    id: "doc20", issue_mode: "digital", issued_at: "2026-10-10T09:40:00-03:00", short_code: "R5C8E-2N7K4",
    content: rceContent(content), signature: { mode: "pending", request_id: "sr20" }, paper_reason: null, ...over
  });
}

export function retDoc(over: Partial<ClinicalDocument> = {}): ClinicalDocument {
  return prescriptionDoc({
    id: "doc21", issue_mode: "digital", issued_at: "2026-10-10T09:45:00-03:00", short_code: "T4N9W-2K7R3",
    content: {
      items: [ prescriptionItem({ catalog_item: catalogItem({ id: "ci2", label: "Amoxicilina 500 mg, cápsula" }), antimicrobial: true,
        quantity: 21, quantity_unit: "cápsula", duration_days: 7, continuous: false }) ],
      antimicrobial: true, copies: 2, valid_until: "2026-10-20", category: "antimicrobial",
      sncr: { kind: "ret", number: "2610.2-41.0000501", simulated: false }, prescriber_contact: prescriberContact()
    },
    signature: { mode: "pending", request_id: "sr21" }, paper_reason: null, ...over
  });
}

// Registro da Notificação de papel: sem código, sem link e sem assinatura; o
// item não tem position, continuous nem antimicrobial.
export function notificationDoc(over: Partial<ClinicalDocument> = {}): ClinicalDocument {
  return prescriptionDoc({
    id: "doc22", kind: "controlled_notification_record", issue_mode: "paper", issued_at: "2026-10-10T09:50:00-03:00",
    short_code: null, verification_url: null, signature: null, paper_reason: null,
    content: {
      notification_type: "B", paper_number: "PR0012345", numbering_uf: "PR",
      item: {
        catalog_item: catalogItem({ id: "ci3", catmat_code: 269999, label: "Clonazepam 2 mg, comprimido", active_ingredient: "clonazepam",
          strength: "2 mg", dosage_form: "comprimido" }),
        printed_description: "Clonazepam 2 mg — comprimido", quantity: 30, quantity_unit: "comprimido", route: "oral",
        dosage_instructions: "1 comprimido à noite", duration_days: 30
      }
    },
    ...over
  });
}

export function sncrOverview(over: Partial<SncrOverview> = {}): SncrOverview {
  return {
    professionals: [
      { user_id: "us1", name: "Dra. Helena Prado", rce_free: 812, ret_free: 40, low: true, last_request_at: "2026-10-02T14:10:00-03:00" },
      { user_id: "us2", name: "Dr. Caio Mendes", rce_free: 950, ret_free: 700, low: false, last_request_at: "2026-10-05T09:00:00-03:00" },
      { user_id: "us3", name: "Dra. Bruna Lopes", rce_free: 0, ret_free: 0, low: true, last_request_at: null }
    ],
    simulated: false, ...over
  };
}
