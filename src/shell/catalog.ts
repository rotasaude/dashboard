// Ícones e descrições dos cards (spec do subprojeto 2, §4.3). Rótulos vêm
// de NAV_GROUPS; aqui só o que o card mostra além do rótulo.
import {
  IconArrowsExchange, IconBuildingCommunity, IconBuildingHospital, IconCalendar, IconCertificate,
  IconChartLine, IconChartPie, IconClipboardList, IconDownload, IconFileCertificate, IconFileDescription,
  IconFilePencil, IconFileText, IconHeartbeat, IconHistory, IconIdBadge2, IconInbox, IconLayoutDashboard,
  IconListCheck, IconLock, IconMapPin, IconMessages, IconNotes, IconPencil, IconPill, IconPlugConnected,
  IconServerCog, IconShieldCheck, IconSignature, IconSpeakerphone, IconStack2, IconStethoscope, IconUpload,
  IconUser, IconUserCircle, IconUsers, IconUsersGroup
} from "@tabler/icons-react";
import type { Catalog } from "./types";

export const CATALOG: Catalog = {
  groups: {
    "Visão geral": { icon: IconLayoutDashboard, description: "Indicadores do dia na cidade" },
    "Aquisição":   { icon: IconInbox, description: "Conversas e consentimentos" },
    "Triagem":     { icon: IconListCheck, description: "Triagens, classificação e relatórios" },
    "Análise":     { icon: IconChartLine, description: "Analytics da cidade" },
    "Governança":  { icon: IconFileCertificate, description: "Protocolos e auditoria" },
    "Operação":    { icon: IconServerCog, description: "Filas e saúde do sistema" },
    "Atendimento": { icon: IconStethoscope, description: "Agenda, prontuário e consultas" },
    "Comunicação": { icon: IconSpeakerphone, description: "Campanhas por SMS" },
    "Equipe":      { icon: IconUsers, description: "Pessoas, papéis e assinaturas" },
    "Cidade":      { icon: IconBuildingCommunity, description: "Território e documentos" },
    "e-SUS":       { icon: IconArrowsExchange, description: "Integrações, CNES e produção" },
    "Conta":       { icon: IconUserCircle, description: "Segurança, perfil e assinatura" }
  },
  screens: {
    "overview": { icon: IconLayoutDashboard, description: "Triagens, filas e alertas de hoje" },
    "ingestion": { icon: IconDownload, description: "Volume de mensagens recebidas" },
    "conversations": { icon: IconMessages, description: "Conversas do canal do cidadão" },
    "consent": { icon: IconShieldCheck, description: "Aceites e revogações do termo" },
    "triages": { icon: IconListCheck, description: "Triagens concluídas e em andamento" },
    "classification": { icon: IconChartPie, description: "Distribuição por risco e prioridade" },
    "reports": { icon: IconFileText, description: "Relatórios entregues ao cidadão" },
    "analytics": { icon: IconChartLine, description: "Tendências por semana e bairro" },
    "protocols": { icon: IconFileCertificate, description: "Versões, assinaturas e ativação" },
    "protocol-editor": { icon: IconPencil, description: "Escrever e revisar rascunhos" },
    "events": { icon: IconHistory, description: "Quem fez o quê e quando" },
    "queues": { icon: IconStack2, description: "Filas de processamento e falhas" },
    "health": { icon: IconHeartbeat, description: "Frescor dos dados e alertas do sistema" },
    "attendance": { icon: IconStethoscope, description: "Fila de chamada e desfecho" },
    "my-agenda": { icon: IconCalendar, description: "Seus horários de hoje e da semana" },
    "signature-pending": { icon: IconSignature, description: "Documentos esperando sua assinatura" },
    "clinical-record": { icon: IconNotes, description: "Histórico clínico do cidadão" },
    "my-consultations": { icon: IconClipboardList, description: "Consultas que você registrou" },
    "professional-consultations": { icon: IconUsersGroup, description: "Consultas da equipe por pessoa" },
    "open-drafts": { icon: IconFilePencil, description: "Consultas iniciadas e não concluídas" },
    "campaigns": { icon: IconSpeakerphone, description: "Criar e enviar campanhas por SMS" },
    "team": { icon: IconUsers, description: "Usuários, convites e papéis" },
    "professionals": { icon: IconIdBadge2, description: "Vínculos, CBO e turnos" },
    "signature-overview": { icon: IconCertificate, description: "Certificados digitais da equipe" },
    "sncr-overview": { icon: IconPill, description: "Numeração de receita controlada da equipe" },
    "territory": { icon: IconMapPin, description: "Bairros e unidades de referência" },
    "clinical-documents-admin": { icon: IconFileDescription, description: "Modelos de atestado e receita" },
    "integrations": { icon: IconPlugConnected, description: "Conexão com o PEC e-SUS" },
    "cnes": { icon: IconBuildingHospital, description: "Estabelecimentos e profissionais do CNES" },
    "production": { icon: IconUpload, description: "Envio da produção ao e-SUS" },
    "security": { icon: IconLock, description: "Senha e verificação em duas etapas" },
    "my-profile": { icon: IconUser, description: "Seus dados profissionais" },
    "signature": { icon: IconCertificate, description: "Seu certificado para assinar" },
    "sncr": { icon: IconPill, description: "Sua numeração de receita controlada" }
  }
};
