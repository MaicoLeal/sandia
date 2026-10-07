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
- **Editar pallet** corrige peso líquido/bruto, quantidade de frutas, data de pesagem, responsável e observações de um pallet disponível. **Cancelar pallet** retira um lançamento indevido da quantidade e do peso ativos, conserva o histórico e devolve a alocação ao saldo da recepção. Para aumentar a quantidade, crie os pallets que faltam; não existe um contador independente dos registros.
- No modo conectado, sincronize os pallets antes de expedir. A expedição exige destino comum e pallets disponíveis; a transação no servidor impede dupla alocação e dupla expedição.
- Informes inclui recepção, produtor, lote, pallet, rejeições, expedição e exportação. CSV abre no Excel; PDF é obtido com “Guardar como PDF” no diálogo de impressão.
- A planilha fitossanitária aparece no histórico do produtor e em **Informes → Instalación de trampas**. O SPE/CAN é apresentado como **Código del productor** no cadastro, histórico, relatório e etiqueta, conforme confirmado pelo proprietário. AGN permanece como **Código interno Agronorte**. O modelo de exportação para Uruguay conserva espécie, origem, colheita, AFIDI, lote, texto SENAVE e QR. Consulte [Referências fitossanitárias](docs/REFERENCIAS-FITOSANITARIAS.md) para importação, campos pendentes e origem documental.
- A etiqueta inclui o nome e endereço do importador, com campos próprios em **Editar etiqueta** e na criação de pallets. Consulte [Importador na etiqueta](docs/IMPORTADOR-ETIQUETAS.md) para ativação e preenchimento dos pallets atuais.
- Na criação de pallets, **Datos de la etiqueta** fica visível. Para Uruguay, uma única combinação completa de AFIDI, importador, endereço, envasado e programa SENAVE em pallets abertos, sem expedição, montados e envasados no mesmo dia do Paraguai preenche os campos editáveis da nova etiqueta. Combinações conflitantes ou de outro dia não são reutilizadas. Código do produtor, origem e colheita vêm exclusivamente da recepção selecionada. Os valores são gravados no próprio pallet; a impressão não inventa campos ausentes nem altera etiquetas antigas por padrão global.

## Dados reais e inicialização

O aplicativo abre vazio, sem dados fictícios. Ao atualizar uma instalação anterior, remove somente o antigo espaço `demo`, seus rascunhos e anexos locais. Espaços autenticados e o novo espaço local de dados reais são preservados. Exemplos continuam apenas nas fixtures dos testes e não são carregados pelo aplicativo.

Sem login, os registros reais permanecem exclusivamente neste navegador/dispositivo, com aviso explícito. Baixe um respaldo local antes de limpar dados do navegador. Iniciar sessão abre um espaço separado da organização: esta versão não transfere automaticamente os registros locais para a conta. Essa transferência precisa de procedimento supervisionado, para evitar duplicação e perda de origem.

Os registros reais iniciais foram transferidos de forma supervisionada para o Supabase, preservando UUIDs, tokens QR e auditoria. As quantidades e datas foram conferidas no banco. Campos ainda não confirmados permanecem pendentes. Esses dados não são sementes da aplicação nem fazem parte do repositório; respaldos e scripts de transferência ficam em diretórios locais ignorados pelo Git.

## Publicação

O workflow `.github/workflows/pages.yml` valida lint, testes e build antes de publicar em `https://maicoleal.github.io/sandia/`. Configure as variáveis do repositório `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com a configuração pública do projeto e habilite GitHub Pages em modo GitHub Actions. A publicação usa `/sandia/`, URL HTTPS para QR e `VITE_REQUIRE_AUTH=true`: o operador precisa entrar na conta para acessar a operação real. O modo local sem login fica disponível apenas na configuração de desenvolvimento, com `VITE_REQUIRE_AUTH=false`.

## Persistência e offline

IndexedDB guarda o espaço, os anexos e rascunhos. A aplicação instalada/cacheada pode ser reaberta offline depois do primeiro acesso. Mudanças autenticadas ficam pendentes e são sincronizadas quando há conexão, com confirmação do servidor. O botão Sincronizar permite tentar novamente. Uma falha não apaga os registros locais.

Na versão **2026.10.07-6**, erros retornados como objetos pelo Supabase mostram a mensagem e, quando disponível, o código SQL/PostgREST. O aviso genérico anterior **Error de sincronización.** ocultava esses detalhes. A correção também cobre falhas ao carregar os dados e guardar recepções, pallets e etiquetas; ela mantém o fluxo de sincronização, a revisão e os registros pendentes. Depois de atualizar o aplicativo, toque em **Sincronizar** e confira a mensagem completa se houver uma falha. Um conflito de revisão requer conciliar os registros do celular com os dados atuais do servidor antes de gravar.

Para instalar a atualização quando a versão antiga bloqueia **Actualizar aplicación** por haver dados pendentes, primeiro guarde qualquer formulário e use **Configuración → Descargar respaldo local**. Depois feche todas as abas desse site e a janela do aplicativo instalado, e reabra com internet. A atualização do código conserva IndexedDB; não limpe os dados do navegador. A impressão definitiva continua exigindo sincronização confirmada.

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
- **Recepción → selecionar entrega → Editar recepción / pesos** permite corrigir data, responsável, observações e a lista de pesos, incluindo recepções já classificadas. Uma pesagem duplicada pode ser retirada; uma faltante pode ser adicionada. O peso aprovado é recalculado pelo total corrigido menos as perdas explicitamente confirmadas, mantendo códigos e origens.
- Aplique `supabase/migrations/20261005165516_recipient_access_reception_edit.sql` depois das seis migrações anteriores. Em instalação existente, aplique somente a migração nova, sem reaplicar inicialização ou importação de dados. Ela habilita as RPCs e o perfil `destinatario`; não cria contas nem concede pallets automaticamente.
- A gestão completa de pesos e cancelamento requer também `20261006163006_reception_management_pallet_tare.sql`, após as atualizações de etiqueta/pallet. Depois de aplicar, sincronize para verificar `reception_management` e `pallet_tare`; o editor mostra uma ação de recuperação enquanto o servidor não confirmar as funções.
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

- Para as novas recepções informadas em 07/10/2026, o procedimento pontual `supabase/operations/20261007_refresh_current_uruguay_labels.sql` completa colheitas confirmadas/compatíveis em lotes atuais e atualiza as etiquetas atuais para Uruguay com AFIDI **1571652**, modelo SENAVE, códigos de produtor reais e envasado pendente **07/10/2026**. O corte é **15:32:35 UTC / 12:32:35 Paraguay**. Ele conserva pesos, datas de recepção, identificadores, QR e campos já confirmados, com auditoria e relatório de pendências. Consulte [Novas recepções e etiquetas](docs/ATUALIZAR-NOVAS-RECEPCOES.md); sincronize e concilie registros locais antes da aplicação manual no Supabase. O arquivo preparado não comprova execução em produção.

- Se o navegador do celular ainda mostrar a etiqueta antiga, salve o trabalho, feche a etiqueta e abra **Configuración → Verificar actualización → Actualizar aplicación**. A versão aparece nesse painel. A aplicação procura atualizações ao recuperar a conexão ou voltar ao primeiro plano; a instalação depende de uma ação do operador e fica bloqueada durante formulários e sincronização pendente. Dados, fotos e rascunhos em IndexedDB são preservados. Em uma versão anterior que ainda não tem o controle, use o aviso **Actualizar aplicación** ou feche todas as abas desse site e reabra após salvar o trabalho. Não limpe os dados do navegador para atualizar.

- **Pallets → selecionar produtor → Etiqueta / QR** mostra o modelo da cooperativa em A4 horizontal (297 × 210 mm), com tabela de espécie, origem, código do produtor SPE/CAN ou código informado, peso líquido do pallet, colheita, envasado e AFIDI. O importador e seu endereço aparecem no cabeçalho quando registrados. QR, código de pallet, lote, recepção, destino e responsável continuam na etiqueta.
- **Descargar PDF A4** gera uma folha com tamanho físico definido, adequada para impressão em escala 100%. **Imprimir A4** valida os dados antes de abrir a impressão do navegador. Textos que ultrapassam o espaço disponível são recusados com uma mensagem para revisão, sem corte silencioso. O pedido de impressão/download do PDF é auditado; isso não confirma a impressão física.
- Aplique `supabase/migrations/20261005225807_pallet_export_label.sql` depois da migração de correções/destinatários. Em instalação existente, execute somente esta atualização. Os campos extras ficam disponíveis quando o servidor confirma a nova função; recarregue e sincronize o aplicativo após aplicar.
- **Productores → Editar productor → Datos para etiqueta de exportación** guarda código de exportação e origem. **Pallets → selecionar produtor → Etiqueta / QR → Editar etiqueta** abre um formulário para importador, endereço, destino, origem, identificação do produtor, colheita, envasado e AFIDI. **Usar fecha de hoy** preenche a data de embalagem com o dia atual no Paraguai; a gravação exige salvar com justificativa. Consulte [Data de embalagem](docs/FECHA-ENVASADO.md) para o preenchimento em lote confirmado de 07/10/2026. Informe os dados confirmados e o motivo, depois toque em **Guardar y ver etiqueta** para revisar a prévia antes de imprimir. Administrador, gestor e packing podem editar pallets disponíveis; pallets vinculados a expedição, expedidos ou cancelados não permitem essa edição.
- A migração `supabase/migrations/20261006131819_pallet_label_details.sql`, aplicada depois das duas atualizações anteriores, habilita a gravação conjunta dos dados da etiqueta e do destino, com justificativa e auditoria. O botão permanece visível para perfis autorizados enquanto a atualização do banco estiver pendente, mas a gravação exige a função confirmada pelo Supabase. Em servidores que têm apenas a atualização anterior de etiquetas, os campos extras podem ser salvos e o destino permanece somente para leitura até aplicar a nova migração.
- Edições remotas exigem conexão, revisão atual e ausência de sincronização pendente. Depois de salvar, a aplicação confirma novamente os dados no servidor, para o mesmo usuário e organização, antes de liberar a impressão. Falha de confirmação exige sincronização; trocar de conta fecha a etiqueta anterior. Peso, códigos, origem das pesagens e token QR são preservados.
- RUC/CI e UUID não substituem o código oficial. Colheita utiliza a data real do lote ou a data explicitamente informada para o pallet. Envasado requer data própria; não usa automaticamente recepção ou montagem. Campos ausentes aparecem como **No informado/a**.
- Marque **Lote incluido en el programa SENAVE para Uruguay** somente após confirmar a inclusão real. Essa confirmação exige destino Uruguay e habilita a declaração do modelo fornecido, com _Anastrepha grandis_ e número do lote. O formato reproduz o modelo da cooperativa; a etiqueta não comprova autorização/certificação por si só. Referências: [resolução DGSA 24/2009 e anexo do MGAP](https://www.gub.uy/ministerio-ganaderia-agricultura-pesca/sites/ministerio-ganaderia-agricultura-pesca/files/2020-07/Resoluci%C3%B3n%2024%20y%20anexo.pdf) e [solicitação AFIDI](https://www.gub.uy/tramites/solicitud-afidi-safidi-solicitud-autorizacion-fitosanitaria-ingreso).
- O QR continua usando o token público e as cinco informações já publicadas; os novos campos não ampliam a consulta pública. Não se pode imprimir/download do PDF/QR enquanto a etiqueta estiver pendente de sincronização.

### Correção e cancelamento de pallets

- Aplique `supabase/migrations/20261006141341_pallet_corrections.sql` depois da atualização de edição de etiquetas/destino. A versão conectada só libera a gravação quando o servidor confirma `pallet_corrections`. Não reinicialize a base nem importe novamente os registros reais.

### Gestão de recepções e tara confirmada — versão 2026.10.06-5

- **Recepción → entrega → Editar recepción / pesos** abre todos os pesos ativos em campos com teclado decimal. Corrija um valor, use **Quitar** para retirar uma duplicata ou **Agregar pesaje** para completar uma entrada. Informe o motivo. Perdas existentes são confirmadas em kg; aprovado = total corrigido − perdas. Qualidade, fotos, região e demais observações da classificação ficam preservadas.
- **Eliminar recepción** retira a entrega dos totais por cancelamento lógico. Se houver pallets de origem exclusiva, seus códigos/pesos aparecem antes da confirmação; o usuário confirma o cancelamento conjunto. Pesagens, classificação, pallets, fotos, vínculos e códigos ficam disponíveis no histórico. **Mostrar recepciones eliminadas** permite encontrá-los depois.
- Se o aprovado corrigido ficaria menor que o já palletizado, primeiro corrija ou cancele o pallet errado. Nenhum peso é redistribuído por estimativa. Pallets expedidos, vinculados à expedição ou com mistura de origens precisam de conciliação específica; o botão genérico não altera uma carga fechada.
- Peso digitado de recepção/pallet é **líquido da melancia**. Tara padrão do pallet: **42 kg**. Bruto calculado = líquido + 42 kg por embalagem. Exemplo: líquido 390 → tara 42 → bruto 432 kg; os 9 pallets com 3.297 kg líquidos têm 378 kg de tara e 3.675 kg brutos calculados. A etiqueta A4 mantém o peso líquido.
- A atualização preenche bruto ausente e tara com auditoria, preservando IDs/códigos/token/estado. Bruto histórico já conhecido permanece conservado; uma correção explícita no editor confirma tara de 42 kg com justificativa. O relatório não interpreta automaticamente um bruto armazenado como pesagem de balança.
- A migração incremental é `supabase/migrations/20261006163006_reception_management_pallet_tare.sql`. Para a instalação Agronorte com atualizações anteriores pendentes, o arquivo local **outputs/ACTIVAR-RECEPCIONES-TARA42-PIRIS-20261006.sql** reúne as atualizações e a concessão previamente autorizada de administrador a Piris, em uma transação. Execute-o no projeto **znbtwkhktlldzhkiwodu**, sem reaplicar a instalação inicial ou importar dados. O resultado deve mostrar perfil `administrador`, `Activo` e funções disponíveis. Esse arquivo gerado fica fora do Git; a migração e a documentação desse fluxo estão versionadas.
- Depois do SQL, sincronize o aplicativo e atualize a versão mobile em **Configuración → Verificar actualización → Actualizar aplicación**, preservando trabalhos pendentes. Criação/correção com tara e gestão completa de recepção exigem confirmação dos recursos do servidor.
- Os relatórios de pallets/expedição consolidam todas as origens e distinguem **Peso_neto_pallet** de **Kg_del_productor**, filtrando pallets de fato pertencentes ao produtor. Cancelados são identificados como histórico e não contribuem para totais ativos; o resumo de recepção separa kg registrados e ativos.
- A varredura completa e as pendências dos demais cadastros estão em `docs/REVISAO-OPERACIONAL-2026-10-06.md`. Esta entrega não acrescenta edição/inativação de parcelas, mudança de origem de lotes, reversão de expedição ou retirada de anexos.
- Administrador e gestor acessam **Pallets → selecionar produtor → Editar pallet / Cancelar pallet**. Informe os valores corretos e uma justificativa. A conexão precisa estar ativa e não pode haver sincronização pendente. A operação no banco valida a revisão da organização e confirma novamente os dados antes de liberar a impressão.
- Se aparecer **Edición pendiente de activar**, a consulta das funções não confirmou a correção de pallets. Esse aviso é diferente do perfil de administrador. Depois de aplicar o SQL, use **Sincronizar y verificar acceso** dentro do formulário para atualizar o perfil e as funções sem fechar os campos preenchidos. Se a revisão dos registros mudar durante a sincronização, feche e abra o pallet novamente para corrigir a partir dos dados atuais.
- A correção de peso líquido modifica o pallet e seu item de origem na mesma transação; exige uma única recepção ativa/classificada e não pode exceder seu saldo aprovado. Pallets com várias origens permitem corrigir os demais campos, mas o peso exige conciliação explícita. Não há distribuição por estimativa. Bruto informado precisa ser maior ou igual ao líquido; datas e quantidade de frutas podem permanecer desconhecidas.
- Peso, quantidade de frutas, data de pesagem ou responsável alterados fazem um pallet etiquetado/pronto voltar para **En armado**, permitindo revisar e reimprimir a etiqueta. Código, token QR, produtor, recepção e metadados de exportação são preservados. Somente observações alteradas conservam o estado.
- O cancelamento preserva o cadastro, itens de origem e auditoria. Pallets expedidos ou vinculados a uma carga não permitem correção/cancelamento. O sincronizador genérico não pode cancelar pallets nem restaurar registros fechados; o cancelamento passa pela função dedicada com autorização e motivo.
- A lista operacional, sua quantidade e seu total em kg excluem cancelados. **Mostrar pallets cancelados (historial)** permite consultar os registros anteriores, sem somá-los ao total ativo. O relatório de pallets também exclui cancelados por padrão, com opção para incluir o histórico. Pallets cancelados não permitem impressão ou download de etiqueta/QR e saem da consulta de destinatários.
- O histórico do produtor mostra separadamente **kg entregados** e **kg en pallets**. Corrigir um pallet não altera as pesagens recebidas nem cria perdas. Se o erro estiver no peso recebido, corrija a pesagem da recepção; recepções já classificadas exigem conciliação supervisionada.
