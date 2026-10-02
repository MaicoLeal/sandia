# Estado da entrega — 02/10/2026

- Aplicação local implementada em React, TypeScript, Vite e Tailwind.
- Supabase configurado em `.env.local` (fora do Git).
- Migração aplicada no SQL Editor do projeto `znbtwkhktlldzhkiwodu`, após confirmar que o esquema public estava vazio.
- Organização Cooperativa Agronorte criada com UUID `20000000-0000-4000-8000-000000000001`.
- Primeiro usuário Auth e respectivo perfil administrador: aguardando criação pelo proprietário. A senha deve ser definida no painel pelo usuário.
- Dados de Elias Galeano são fictícios e permanecem locais; não foram inseridos em produção.
- Conferido na interface: classificação 3.000 kg aprovados / 247 kg rejeitados; três pallets de 1.000 kg; expedição fictícia de 3.000 kg para Uruguay.
- Conferido em viewport de 390 × 844: navegação inferior e ausência de rolagem horizontal na tela inicial.
- Logotipo oficial confirmado no Drive e aplicado sem redesenhar o símbolo.
- Testes de domínio e PostgreSQL local cobrem pesos, saldo, correções, auditoria, RLS, token QR, conflito de revisão, expedição e cancelamento.

Ainda precisam de homologação com uma conta real: login Auth, upload/download de Storage, sincronização entre dispositivos e leitura do QR em URL HTTPS publicada. PWA pronta para publicação; APK e integrações de hardware não foram gerados.

Validação final: 15 testes passaram, lint sem erros, build de produção com service worker gerado. As duas migrações foram aplicadas no Supabase real. O primeiro usuário foi adiado por decisão do proprietário. Auditoria npm do lockfile: zero vulnerabilidades reportadas.
