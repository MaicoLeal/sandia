# Estado da entrega — 02/10/2026

- Aplicação implementada em React, TypeScript, Vite e Tailwind.
- Supabase configurado em `.env.local`, fora do Git; organização Cooperativa Agronorte criada.
- Cinco migrações aplicadas no Supabase: esquema inicial, motivos de correção, recepção com campos ainda não informados, correção auditada de data e seleção rápida/data de pesagem/rastreabilidade autenticada.
- Contas Auth criadas no painel pelo proprietário e conferidas. Ainda estão sem perfil e organização vinculados. A vinculação administrativa foi preparada e aguarda confirmação dos acessos pelo proprietário; esse vínculo é necessário para carregar os registros no celular.
- Dados reais iniciais gravados no Supabase; quantidades, soma e datas conferidas. Tokens QR e histórico preservados. Campos desconhecidos não foram presumidos. Os registros operacionais não fazem parte deste repositório público.
- Demonstração removida da aplicação; a inicialização abre um espaço vazio. Atualizações removem somente o antigo espaço demo, seus rascunhos e anexos; dados reais e espaços autenticados são preservados.
- O aplicativo sem login guarda registros reais somente no dispositivo, com aviso explícito. Não há transferência automática desse espaço para uma conta autenticada.
- Nomes operacionais de lotes são preservados; parcela, colheita, qualidade e peso bruto podem ficar pendentes sem valores presumidos.
- Correções de data exigem gestor/administrador, justificativa e auditoria, antes da classificação.
- Logotipo oficial confirmado no Drive e aplicado sem redesenhar o símbolo.
- Navegação mobile já conferida em viewport 390 × 844; rascunhos locais e abertura da PWA compilada após desligar o servidor de prévia verificados.
- Fixtures de teste permanecem isoladas e não são carregadas no aplicativo.

Validação desta atualização: lint sem erros, 21 testes aprovados e build de produção concluído com service worker. Os testes PostgreSQL cobrem RLS, revisão, peso, saldo, auditoria, cancelamento, origem, correção de data, perdas e separação entre QR público e origem autenticada. O agrupamento por produtor foi testado com múltiplas origens, sem duplicar peso.

Pallets agora aparecem em grupos por produtor, com filtros de produtor e busca por código, lote ou peso. Produtor, lote, data, peso e botão "Etiqueta / QR" foram conferidos em viewport de 390 × 844, sem rolagem horizontal. A busca e a abertura do QR foram verificadas usando os registros locais reais, sem criar novos registros.

Ainda precisam de homologação com uma conta real: login Auth, Storage e sincronização entre dispositivos. APK e integrações de hardware não foram gerados.

Aplicativo publicado e aberto com sucesso em https://maicoleal.github.io/sandia/, via GitHub Actions/Pages, com login obrigatório para operar. Workflow de build e deploy concluído com sucesso. Todos os tokens iniciais de QR foram consultados na API real, com códigos e pesos conferidos; uma página de consulta pública também foi validada no navegador. O QR público mantém cinco campos básicos; detalhes de origem exigem sessão da mesma organização.

Código e documentação enviados ao repositório autorizado MaicoLeal/sandia, branch codex/recepcion-sandia. Credenciais, arquivos .env, registros reais e respaldos locais não fazem parte do envio.
