import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend do Dashboard operacional da cidade (tenant-scoped, municipal_admin).
// Em dev, Vite proxa as rotas de backend para o Rails (apps/api, :3030).
//   /up         → healthcheck do Rails (sem auth), usado pelo health-ping.
//   /admin/api  → Admin::Api::* (read-only).
//   /session    → SessionsController (inclui /session/grant).
//   /passwords  → PasswordsController.
//   /auth       → POST /auth/govbr/start.
//   /setup      → SetupController (aceite de convite).
//   /protocols  → ciclo de vida com assinaturas (ProtocolLifecycleController, PublicationsController).
//   /mfa        → cadastro de TOTP e step-up (MfaController).
//
// Plano 6: changeOrigin FICA FALSE. O Rails resolve a cidade pelo Host da
// requisição (CityCatalog); com changeOrigin: true o proxy reescrevia o Host
// para o alvo (api:3000) e nenhuma cidade chegava. allowedHosts libera
// <slug>.localhost, que o Vite 5.4.12+ bloqueia por padrão.
const proxy = (target: string) => ({ target, changeOrigin: false });
const TARGET = process.env.VITE_API_PROXY_TARGET || "http://localhost:3030";

export default defineConfig({
  plugins: [react()],
  base: "/dashboard/",
  server: {
    port: 5173,
    host: "0.0.0.0",
    allowedHosts: [ ".localhost" ],
    proxy: {
      "/up":        proxy(TARGET),
      "/admin/api": proxy(TARGET),
      "/authoring": proxy(TARGET),
      "/session":   proxy(TARGET),
      "/passwords": proxy(TARGET),
      "/auth":      proxy(TARGET),
      "/setup":     proxy(TARGET),
      "/protocols": proxy(TARGET),
      "/mfa":       proxy(TARGET)
    }
  }
});
