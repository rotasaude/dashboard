# Rota Saúde — Dashboard da cidade

Painel operacional e de governança de **uma prefeitura**. Cada cidade tem o
próprio banco, e o dashboard vive no host dela
(`<cidade>.rotasaude.app/dashboard/`). O subdomínio diz ao Rails qual cidade
servir.

Vite + React + TypeScript + React Query. Consome o `api` (Rails, repo
`rotasaude/api`). Decisões arquiteturais em `rotasaude/docs` (ADRs 0010, 0011,
0012, 0016, 0017, 0018 e a spec do banco por cidade).

## Papel no ecossistema

| App | Quem usa | Alcance |
|---|---|---|
| **dashboard** (este) | Equipe da prefeitura | Uma cidade |
| `admin` | Operador da plataforma | Catálogo de cidades, provisionamento, entrada nas cidades via grant |
| `maintenance` | Mantenedor (superusuário) | Todas as cidades, só em development/staging |
| `wpda` | Cidadão | Uma cidade (`<cidade>.rotasaude.app/wpda/`) |

## Módulos

A navegação (`src/shell/modules.ts`) é filtrada pelos papéis da sessão
(`navGroupsFor`):

| Grupo | Módulos | Quem vê |
|---|---|---|
| Visão geral | Visão geral (KPIs) | todos |
| Aquisição | Ingestão, Conversas, Consentimento | todos |
| Triagem | Triagens, Classificação, Relatórios | todos |
| Governança | Protocolos, Editor de protocolo, Eventos & auditoria | todos |
| Operação | Filas & jobs, Saúde | todos |
| Atendimento | Validação presencial, check-in, atendimentos abertos, unidades (ADR 0018) | `municipal_admin`, `citizen_verifier` |
| Equipe | Convidar membros, conceder e revogar papéis | `municipal_admin` |
| Conta | Segurança: autenticador TOTP, recovery codes, senha | usuários da cidade (não o operador) |

O que a API recusaria (403) fica fora do menu. Equipe e Atendimento só
aparecem depois que a sessão diz o papel.

**Protocolos** seguem o ciclo assinado do ADR 0016: duas revisoras por
publicação e por ativação. As ações (assinar, publicar, ativar, aposentar,
reverter) aparecem conforme o estado da versão. A reversão mostra a versão-alvo
("deve voltar", que é uma previsão) e, depois, a versão que de fato passou a
valer.

## Entrada e autenticação

Sessão por cookie HttpOnly, **host-only** (sem `domain:`), contra `User` no
banco da cidade. Entradas pela URL (`src/lib/entry.ts`), na ordem:

- `?grant=`: operador vindo do console `admin`, ou usuário voltando do gov.br.
  O grant vale 60 s e é de uso único.
- `?invite=`: aceite de convite (`/setup`).
- `?reset=`: link de redefinição de senha (`/passwords`).

O login oferece e-mail e senha ou **Entrar com gov.br**. O gov.br é da cidade:
o callback é único e devolve para cá com o mesmo mecanismo de grant.

**Ações sensíveis** (papéis na Equipe, ciclo de protocolo) exigem **step-up**:
um TOTP dos últimos 5 min (`MfaStepUp::STEP_UP_WINDOW` no api). O componente
`SensitiveAction` é o único lugar que conhece step-up, repetição e tradução de
erro; as telas só dizem qual ação rodar. O operador que entra por grant não tem
a tela Conta.

## Como rodar em dev

O app roda como o serviço `dashboard` do `docker-compose.yml` da raiz do
monorepo:

```bash
docker compose up -d api dashboard
docker compose exec api bin/rails db:seed
```

Abra em **http://curitiba.localhost:5175/dashboard/** (ou `maringa`). Em
`localhost` puro nenhuma cidade é resolvida.

A semente cria, em cada cidade, contas com senha `dev-password` e TOTP de
segredo fixo (o `otpauth://` sai no log do seed):

| Conta | Papel |
|---|---|
| `admin@<slug>.demo` | `municipal_admin` |
| `autor@<slug>.demo` | `protocol_author` |
| `revisora1@<slug>.demo`, `revisora2@<slug>.demo` | `protocol_reviewer` |
| `publisher@<slug>.demo` | `protocol_publisher` |

Com esse elenco e o rascunho semeado dá para rodar o ciclo assinado inteiro no
navegador.

Fora do Docker:

```bash
cp .env.example .env
npm install
npm run dev        # porta 5173; o compose publica em 5175
```

O Vite proxa `/up`, `/admin/api`, `/authoring`, `/session`, `/passwords`,
`/auth`, `/setup`, `/protocols`, `/mfa` e `/attendance` para
`VITE_API_PROXY_TARGET` com `changeOrigin: false`. **Não troque para `true`**:
o proxy reescreveria o Host para o alvo e nenhuma cidade chegaria ao Rails.

| Var | Default | Uso |
|---|---|---|
| `VITE_API_PROXY_TARGET` | `http://localhost:3030` (`http://api:3000` no compose) | alvo do proxy em dev |

## Estrutura

```
src/
├── main.tsx          ← AuthProvider + roteamento por entrada/estado de sessão
├── App.tsx           ← AppShell e módulo ativo
├── shell/            ← AppHeader, NavDropdown, NotificationCenter, modules.ts (navegação por papel)
├── lib/
│   ├── api.ts        ← fetch e endpoints
│   ├── auth.tsx      ← AuthContext
│   ├── entry.ts, use_grant_entry.ts ← ?grant= / ?invite= / ?reset=
│   ├── stepUp.ts, useStepUp.ts      ← janela de step-up
│   ├── protocolLifecycle.ts, editor.ts ← ações e editor de protocolo
│   ├── team.ts, attendance.ts, actionErrors.ts, tier.ts, format.ts, scope.ts
├── modules/          ← uma tela por módulo; attendance/ tem as subtelas do balcão
├── hooks/            ← um hook de React Query por endpoint de leitura
├── components/       ← primitivos (Panel, DataTable, SensitiveAction, StatTile…)
└── theme/            ← tokens e CSS global
```

## Testes e CI

```bash
npm run typecheck
npm test           # vitest: lib, componentes e telas (*.test.ts[x])
npm run build
```

A CI (`.github/workflows/ci.yml`) roda os três em todo push para `main` e em
todo PR.

## Build de produção

O `Dockerfile` gera a SPA e a serve com nginx sob `/dashboard/`
(`nginx.conf`).

## Princípios

- **Uma cidade por host.** Nada aqui cruza cidades; o isolamento vem do banco
  da cidade, e não de filtro no frontend.
- **Não ofereça porta trancada.** O item que a API recusaria para o papel fica
  fora do menu.
- **O TOTP nunca persiste.** O código vive em estado local e é limpo antes de
  cada chamada.
- **Estados de carregando, erro e vazio sempre explícitos.** Nunca exiba `0`
  como se fosse dado.
