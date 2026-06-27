# dashboard

Frontend da cidade do Rota Saúde, tenant-scoped (ADR 0002). Vite + React + TypeScript.
Consome a API do Rails (repo `rotasaude/api`) via proxy do Vite.

Decisões arquiteturais em rotasaude/docs.

## Desenvolvimento

Pré-requisito: o `api` de pé em `http://localhost:3030` (ver repo `rotasaude/api`).

```bash
cp .env.example .env
npm install
npm run dev
```

Acesso: http://localhost:5175/dashboard/. O Vite proxa as chamadas de API para
`VITE_API_PROXY_TARGET` (default `http://localhost:3030`).
