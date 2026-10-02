# Estado da entrega — 02/10/2026

- Aplicação implementada em React, TypeScript, Vite e Tailwind.
- Supabase configurado em `.env.local`, fora do Git; organização Cooperativa Agronorte criada.
- Cinco migrações aplicadas no Supabase: esquema inicial, motivos de correção, recepção com campos ainda não informados, correção auditada de data e seleção rápida/data de pesagem/rastreabilidade autenticada.
- Primeira conta solicitada pelo proprietário. Formulário Auth preparado; criação depende da senha definida pelo proprietário no painel. Vinculação do perfil administrador será feita após a criação.
- Dados reais iniciais gravados no Supabase; quantidades, soma e datas conferidas. Tokens QR e histórico preservados. Campos desconhecidos não foram presumidos. Os registros operacionais não fazem parte deste repositório público.
- Demonstração removida da aplicação; a inicialização abre um espaço vazio. Atualizações removem somente o antigo espaço demo, seus rascunhos e anexos; dados reais e espaços autenticados são preservados.
- O aplicativo sem login guarda registros reais somente no dispositivo, com aviso explícito. Não há transferência automática desse espaço para uma conta autenticada.
- Nomes operacionais de lotes são preservados; parcela, colheita, qualidade e peso bruto podem ficar pendentes sem valores presumidos.
- Correções de data exigem gestor/administrador, justificativa e auditoria, antes da classificação.
- Logotipo oficial confirmado no Drive e aplicado sem redesenhar o símbolo.
- Navegação mobile já conferida em viewport 390 × 844; rascunhos locais e abertura da PWA compilada após desligar o servidor de prévia verificados.
- Fixtures de teste permanecem isoladas e não são carregadas no aplicativo.

Validação desta atualização: lint sem erros, 20 testes aprovados e build de produção concluído com service worker. Os testes PostgreSQL cobrem RLS, revisão, peso, saldo, auditoria, cancelamento, origem, correção de data, perdas e separação entre QR público e origem autenticada.

Ainda precisam de homologação com uma conta real: login Auth, Storage e sincronização entre dispositivos. APK e integrações de hardware não foram gerados.

Publicação preparada via GitHub Actions/Pages em https://maicoleal.github.io/sandia/, com login obrigatório para operar. O QR público mantém cinco campos básicos; detalhes de origem exigem sessão da mesma organização.

Código e documentação enviados ao repositório autorizado MaicoLeal/sandia, branch codex/recepcion-sandia. Credenciais, arquivos .env, registros reais e respaldos locais não fazem parte do envio.
