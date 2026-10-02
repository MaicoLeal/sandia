# Estado da entrega — 02/10/2026

- Aplicação implementada em React, TypeScript, Vite e Tailwind.
- Supabase configurado em `.env.local`, fora do Git; organização Cooperativa Agronorte criada.
- Quatro migrações aplicadas no Supabase: esquema inicial, motivos de correção, recepção com campos ainda não informados e correção auditada de data.
- Primeiro usuário Auth e perfil administrador: adiado por decisão do proprietário.
- Demonstração removida da aplicação; a inicialização abre um espaço vazio. Atualizações removem somente o antigo espaço demo, seus rascunhos e anexos; dados reais e espaços autenticados são preservados.
- O aplicativo sem login guarda registros reais somente no dispositivo, com aviso explícito. Não há transferência automática desse espaço para uma conta autenticada.
- Nomes operacionais de lotes são preservados; parcela, colheita, qualidade e peso bruto podem ficar pendentes sem valores presumidos.
- Correções de data exigem gestor/administrador, justificativa e auditoria, antes da classificação.
- Logotipo oficial confirmado no Drive e aplicado sem redesenhar o símbolo.
- Navegação mobile já conferida em viewport 390 × 844; rascunhos locais e abertura da PWA compilada após desligar o servidor de prévia verificados.
- Fixtures de teste permanecem isoladas e não são carregadas no aplicativo.

Validação desta atualização: lint sem erros, 19 testes aprovados e build de produção concluído com service worker. Os testes PostgreSQL cobrem RLS, revisão, peso, saldo, auditoria, cancelamento, origem e correção de data.

Ainda precisam de homologação com uma conta real: login Auth, Storage, sincronização entre dispositivos e leitura do QR em URL HTTPS publicada. APK e integrações de hardware não foram gerados.

Código e documentação enviados ao repositório autorizado MaicoLeal/sandia, branch codex/recepcion-sandia. Credenciais, arquivos .env, registros reais e respaldos locais não fazem parte do envio.
