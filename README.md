# Agronorte · Recepción de Sandía

Aplicação React + TypeScript + Vite + Tailwind, em espanhol do Paraguai. Interface para celular e computador, com recepção, pesagem, classificação, pallets, etiquetas QR, expedição, histórico e relatórios.

## Executar

Requisitos: Node.js 22.12 ou superior e npm. Use `npm ci` com `package-lock.json`; também pode usar `pnpm install --frozen-lockfile`.

```sh
npm install
npm run dev
npm run lint
npm run test
npm run build
```

Nesta máquina o npm foi instalado como ferramenta de desenvolvimento. Se não houver `npm` no PATH:

```sh
node .toolchain/npm/bin/npm-cli.js run dev
```

Abra http://127.0.0.1:5173. Não abra `index.html` diretamente pelo Explorador. Para testar PWA/cache, utilize a aplicação compilada (`npm run build` e `npm run preview`), pois o service worker não é habilitado no servidor de desenvolvimento.

## Configuração Supabase

Copie `.env.example` para `.env.local` e preencha a URL e a chave pública/publishable do projeto. A configuração local fornecida pelo proprietário já está em `.env.local`, ignorado pelo Git. Nunca use service_role no cliente.

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA
VITE_PUBLIC_TRACE_URL=https://SEU-DOMINIO/
```

1. Aplique as migrações de `supabase/migrations/` em ordem de nome, em um projeto novo, pelo SQL Editor ou pelo fluxo de migrações Supabase.
2. Crie o usuário em Authentication > Users, com senha definida pelo próprio usuário. A conta do painel Supabase é diferente de um usuário Auth do aplicativo.
3. Aplique o bootstrap de organização/perfil após substituir o UUID do usuário em `supabase/bootstrap.example.sql`. A primeira conta precisa de perfil administrador. Perfis internos seguintes são atribuídos por SQL administrativo; contas de destinatários e seus pallets são vinculados pela tela descrita abaixo.
4. No aplicativo, inicie sessão. O espaço autenticado carrega os registros da organização; exemplos de teste nunca são enviados ao banco de produção.
5. Depois de publicar, configure `VITE_PUBLIC_TRACE_URL` com a URL HTTPS real e gere as etiquetas. QR com localhost não funciona em outro celular.

## Fluxo de uso

- Cadastre produtor e propriedade/parcela, ou use os atalhos dentro da recepção.
- Nueva recepción: escolha produtor e a parcela, quando conhecida, crie ou selecione lote, informe datas/responsável e adicione pesos. O resumo calcula total, contagem, média, mínimo e máximo.
- Parcela, data de colheita, peso bruto e nota de qualidade visual podem ficar sem informação; o sistema não atribui valores fictícios.
- Na própria recepção, marque seleção e informe perdas em kg e motivo; a soma aprovada é calculada automaticamente. Desmarque essa opção quando ainda estiver pesando, para classificar depois. Fotos da carga/perda são opcionais e ficam no rascunho antes da confirmação. Quantidade de frutas é opcional e não interfere no saldo em kg.
- Crie um ou vários pallets iguais por operação, informando o peso líquido; bruto/tara podem ficar pendentes. O sistema verifica o saldo aprovado antes de alocar.
- Consulte/imprima a etiqueta e marque o pallet listo para carga.
- Em Pallets, selecione o produtor para exibir somente seus pallets, com quantidade e peso filtrados. A tela começa sem cards e a busca por código, lote ou peso fica disponível após a escolha. Trocar o produtor limpa a busca anterior. Um link QR abre diretamente o pallet e identifica seu produtor; “Ver pallets de este productor” amplia a consulta somente para esse produtor. O botão "Etiqueta / QR" abre a impressão e o download do QR também no celular.
- No modo conectado, sincronize os pallets antes de expedir. A expedição exige destino comum e pallets disponíveis; a transação no servidor impede dupla alocação e dupla expedição.
- Informes inclui recepção, produtor, lote, pallet, rejeições, expedição e exportação. CSV abre no Excel; PDF é obtido com “Guardar como PDF” no diálogo de impressão.

## Dados reais e inicialização

O aplicativo abre vazio, sem dados fictícios. Ao atualizar uma instalação anterior, remove somente o antigo espaço `demo`, seus rascunhos e anexos locais. Espaços autenticados e o novo espaço local de dados reais são preservados. Exemplos continuam apenas nas fixtures dos testes e não são carregados pelo aplicativo.

Sem login, os registros reais permanecem exclusivamente neste navegador/dispositivo, com aviso explícito. Baixe um respaldo local antes de limpar dados do navegador. Iniciar sessão abre um espaço separado da organização: esta versão não transfere automaticamente os registros locais para a conta. Essa transferência precisa de procedimento supervisionado, para evitar duplicação e perda de origem.

Os registros reais iniciais foram transferidos de forma supervisionada para o Supabase, preservando UUIDs, tokens QR e auditoria. As quantidades e datas foram conferidas no banco. Campos ainda não confirmados permanecem pendentes. Esses dados não são sementes da aplicação nem fazem parte do repositório; respaldos e scripts de transferência ficam em diretórios locais ignorados pelo Git.

## Publicação

O workflow `.github/workflows/pages.yml` valida lint, testes e build antes de publicar em `https://maicoleal.github.io/sandia/`. Configure as variáveis do repositório `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com a configuração pública do projeto e habilite GitHub Pages em modo GitHub Actions. A publicação usa `/sandia/`, URL HTTPS para QR e `VITE_REQUIRE_AUTH=true`: o operador precisa entrar na conta para acessar a operação real. O modo local sem login fica disponível apenas na configuração de desenvolvimento, com `VITE_REQUIRE_AUTH=false`.

## Persistência e offline

IndexedDB guarda o espaço, os anexos e rascunhos. A aplicação instalada/cacheada pode ser reaberta offline depois do primeiro acesso. Mudanças autenticadas ficam pendentes e são sincronizadas quando há conexão, com confirmação do servidor. O botão Sincronizar permite tentar novamente. Uma falha não apaga os registros locais.

Quando houver uma nova versão, salve o trabalho e toque em "Actualizar aplicación" para ativar a atualização da PWA. Instalações antigas que ainda não exibem esse botão precisam fechar as abas do aplicativo e reabri-lo para receber a primeira atualização.

A sincronização utiliza uma revisão por organização e uma transação completa. Se duas pessoas modificarem a mesma revisão, a segunda recebe conflito e conserva seus dados locais. Esta primeira versão **não mescla automaticamente conflitos**. É necessário conciliar com o gestor, usando uma cópia/exportação local antes de atualizar o espaço. Para operação simultânea de grande volume, evoluir para fila de operações por entidade e resolução de conflitos dedicada; a estrutura atual evita sobrescrita silenciosa.

No navegador, armazenamento local e sessão dependem do acesso ao dispositivo. Sair da conta não elimina a cópia offline, e o navegador pode remover dados por políticas de armazenamento. Use contas e dispositivos controlados pela cooperativa.

## Segurança e auditoria

As tabelas utilizam UUID e organização; FKs compostas impedem ligar entidades de organizações diferentes. RLS permite leitura apenas da organização do perfil ativo. Escritas ocorrem pela RPC transacional, que valida perfil, revisão e integridade; clientes não recebem DELETE nem escrita direta.

O banco preserva o código/nome de lote informado (único por organização) e gera um código quando ele está vazio. Gera os códigos finais dos pallets, datas e auditoria. O operador vê um código provisório local até a sincronização. Auditoria preserva antes/depois e usuário. Correções de peso exigem gestor/administrador e motivo; uma recepção já classificada exige reversão supervisionada, ainda não disponível na interface. Data, responsável e observações da recepção podem ser corrigidos com justificativa mesmo depois da classificação e palletização, sem alterar origem, pesagens ou vínculos. Cancelamento de recepção antes da classificação preserva as pesagens e registra justificativa. Pallets expedidos e vínculos operacionais não podem ser editados diretamente.

Anexos são privados (máximo 10 MB), com leitura autenticada e URLs assinadas. O QR usa token opaco e mostra publicamente somente código, produto, peso líquido, destino e status. Uma sessão da mesma organização permite consultar também produtor, lote, parcela/localidade, data de recepção, data de pesagem e peso alocado, pela RPC privada. O botão de detalhe abre diretamente o pallet escaneado. A solicitação de impressão é auditada; o navegador não confirma que a impressora fisicamente imprimiu.

As políticas seguem a [documentação de RLS do Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security). Os testes PostgreSQL locais simulam Auth/Storage para validar SQL e regras; não substituem a homologação de Auth e Storage no projeto real.

## Identidade

Logotipo `PRINCIPAL.png` confirmado no Drive oficial, preservado em `public/agronorte-logo.png`. Origem: https://drive.google.com/file/d/1KWlf16nK9-xLBVzQP0tJLo_SO3I99fiq/view. Interface verde/branco, com #36741B e #688B11. A fonte de interface utiliza fallback do sistema; Metropolis não foi incluída porque o arquivo/licença da fonte não está no projeto.

## Limites e próximos passos

- Instalação PWA requer publicação HTTPS. APK Capacitor não foi gerado.
- Integrações com balança, leitor de câmera, impressora dedicada, n8n e envio de mensagens não estão conectadas.
- O módulo calcula e documenta a carga; não substitui documentos sanitários, aduaneiros ou requisitos legais de exportação.
- Relatórios usam CSV e impressão/PDF; não geram XLSX nativo. Etiquetas também têm download de PDF A4 por biblioteca.
- Administração de perfis e reversões de classificação/expedição são feitas por procedimento administrativo; não existe uma tela completa de gestão desses processos.
- Etiqueta padrão é A4 horizontal, uma etiqueta por folha; confirme papel A4, orientação paisagem, escala 100% e ausência de cabeçalhos/rodapés na impressora da operação.

## Arquivos principais

`src/App.tsx`: telas e formulários. `src/domain.ts`: cálculos e regras. `src/types.ts`: tipos relacionais. `src/useWorkspace.ts`: persistência e sincronização. `src/services/supabase.ts`: Auth, tabelas, Storage e RPC. `src/services/reports.ts`: exportação e impressão. `supabase/migrations/`: esquema e regras do servidor.

### Correções e consulta para destinatários

- **Productores → selecionar produtor → Editar productor** abre os dados existentes: nome, documento, telefone, comunidade, endereço, estado e observações. Gestor/administrador informa o motivo; o histórico preserva valores anteriores e novos.
- **Recepción → selecionar entrega → Editar recepción** permite corrigir data, responsável e observações. Alterações de peso continuam em **Pesajes → Corregir**. Os registros do lote, da seleção e dos pallets permanecem vinculados à mesma recepção.
- Aplique `supabase/migrations/20261005165516_recipient_access_reception_edit.sql` depois das seis migrações anteriores. Em instalação existente, aplique somente a migração nova, sem reaplicar inicialização ou importação de dados. Ela habilita as RPCs e o perfil `destinatario`; não cria contas nem concede pallets automaticamente.
- Depois de aplicar a migração, recarregue/sincronize o aplicativo. **Editar recepción** fica indisponível em uma conexão cujo banco ainda não recebeu a atualização.
- Crie uma conta distinta para o destinatário em **Supabase → Authentication → Users**, com senha definida pelo usuário ou pelo administrador no painel. Anote o e-mail e o UUID, sem compartilhar a senha no chat. Uma conta interna existente não pode ser convertida em destinatário pela tela.
- Entre no aplicativo com administrador e abra **Pallets → Acceso de destinatarios**. Informe nome, e-mail e UUID da conta; selecione somente os pallets que ela deve consultar e salve. Só pallets sincronizados e não cancelados podem ser liberados. Ao editar a conta, a seleção substitui a anterior; desmarcar todos revoga todos os pallets.
- A conta destinatária usa o mesmo endereço e login, mas recebe **Mis pallets de sandía**, com busca e atualização. Consulta somente os pallets concedidos: produto, códigos de pallet/lote, peso líquido/bruto, estado, destino, datas de recepção/pesagem/montagem e dados básicos da expedição (destino, país e saída).
- O destinatário não carrega o espaço interno, cadastro/identidade dos produtores, parcelas, fotos, documentos, responsáveis, observações, auditoria ou relatórios da cooperativa. As regras no PostgreSQL bloqueiam leitura direta, Storage, sincronização e consulta privada do QR. O QR público continua contendo somente as cinco informações já publicadas; códigos de lote e datas adicionais exigem a conta autorizada.
- A consulta do destinatário requer internet e não guarda uma cópia offline dos pallets. Atualizar ou retomar a tela verifica novamente as concessões. As edições internas continuam com rascunho local e sincronização auditada; mudanças de conta limpam imediatamente o espaço exibido.

### Entrada mobile e acompanhamento de perdas

- Pesos, perdas e área usam teclado decimal (`inputMode=decimal`), aceitam vírgula ou ponto e selecionam o valor ao tocar. Quantidades inteiras usam teclado numérico. Ao adicionar um peso, o foco retorna ao campo para o próximo valor.
- Em **Productores → histórico**, há acesso a **Nueva recepción de este productor** e **Registrar pérdidas / selección**. A seleção registra a perda em kg, motivo e aprovação automática; uma recepção já classificada preserva seu histórico e não recebe uma classificação duplicada.
- Na recepção e na seleção posterior, **Región y observaciones de campo** permite comunidade, possível praga e sinais observados. Fotos ficam vinculadas à recepção; na entrada rápida elas também são mantidas no rascunho local.
- **Informes → Pérdidas por región** reúne peso recebido, peso avaliado, perdas, índice, produtores e cobertura da seleção por período. O denominador do índice inclui apenas recepções selecionadas. Registros cancelados são excluídos.
- A referência de revisão começa em 5% e pode ser ajustada no relatório. Não é um limiar agronômico validado. A indicação discreta **Revisar registros** exige região informada e ao menos duas entregas selecionadas; não diagnostica pragas e não gera aviso no dashboard.
- A migração `202610020006_regional_loss_observations.sql` adiciona três campos opcionais a `classifications`, preservando compatibilidade com clientes anteriores, auditoria, imutabilidade da seleção e proteção por organização.

### Etiqueta A4 de exportação

- Se o navegador do celular ainda mostrar a etiqueta antiga, salve o trabalho, feche a etiqueta e abra **Configuración → Verificar actualización → Actualizar aplicación**. A versão aparece nesse painel. A aplicação procura atualizações ao recuperar a conexão ou voltar ao primeiro plano; a instalação depende de uma ação do operador e fica bloqueada durante formulários e sincronização pendente. Dados, fotos e rascunhos em IndexedDB são preservados. Em uma versão anterior que ainda não tem o controle, use o aviso **Actualizar aplicación** ou feche todas as abas desse site e reabra após salvar o trabalho. Não limpe os dados do navegador para atualizar.

- **Pallets → selecionar produtor → Etiqueta / QR** mostra o modelo da cooperativa em A4 horizontal (297 × 210 mm), com tabela de espécie, origem, código oficial do produtor, peso líquido do pallet, colheita, envasado e AFIDI. QR, código de pallet, lote, recepção, destino e responsável continuam na etiqueta.
- **Descargar PDF A4** gera uma folha com tamanho físico definido, adequada para impressão em escala 100%. **Imprimir A4** valida os dados antes de abrir a impressão do navegador. Textos que ultrapassam o espaço disponível são recusados com uma mensagem para revisão, sem corte silencioso. O pedido de impressão/download do PDF é auditado; isso não confirma a impressão física.
- Aplique `supabase/migrations/20261005225807_pallet_export_label.sql` depois da migração de correções/destinatários. Em instalação existente, execute somente esta atualização. Os campos extras ficam disponíveis quando o servidor confirma a nova função; recarregue e sincronize o aplicativo após aplicar.
- **Productores → Editar productor → Datos para etiqueta de exportación** guarda código oficial e origem. **Datos de la etiqueta**, no pallet aberto, permite AFIDI, data de envasado e dados específicos de colheita/origem/código, com justificativa e auditoria. Administrador, gestor e packing podem editar a etiqueta; mudanças remotas exigem conexão, revisão atual e ausência de sincronização pendente.
- RUC/CI e UUID não substituem o código oficial. Colheita utiliza a data real do lote ou a data explicitamente informada para o pallet. Envasado requer data própria; não usa automaticamente recepção ou montagem. Campos ausentes aparecem como **No informado/a**.
- Marque **Lote incluido en el programa SENAVE para Uruguay** somente após confirmar a inclusão real. Essa confirmação exige destino Uruguay e habilita a declaração do modelo fornecido, com _Anastrepha grandis_ e número do lote. O formato reproduz o modelo da cooperativa; a etiqueta não comprova autorização/certificação por si só. Referências: [resolução DGSA 24/2009 e anexo do MGAP](https://www.gub.uy/ministerio-ganaderia-agricultura-pesca/sites/ministerio-ganaderia-agricultura-pesca/files/2020-07/Resoluci%C3%B3n%2024%20y%20anexo.pdf) e [solicitação AFIDI](https://www.gub.uy/tramites/solicitud-afidi-safidi-solicitud-autorizacion-fitosanitaria-ingreso).
- O QR continua usando o token público e as cinco informações já publicadas; os novos campos não ampliam a consulta pública. Não se pode imprimir/download do PDF/QR enquanto a etiqueta estiver pendente de sincronização.
