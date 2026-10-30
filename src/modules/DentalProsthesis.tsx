// Próteses (módulo 28). Tela-portão: o corpo vem nas Tasks 10–12.
import { EmptyState } from "../components/EmptyState";
import { DentalGate } from "./dental/DentalGate";

export function DentalProsthesis() {
  return (
    <DentalGate title="Próteses" sub="pedidos ao laboratório, etapas e instalação" allow={(r) => r.professional}>
      {() => <EmptyState title="Em construção nesta branch." />}
    </DentalGate>
  );
}
