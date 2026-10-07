# Revisão das etiquetas — 07/10/2026

A versão **2026.10.07-8 · Revisión de etiquetas y datos** acrescenta a revisão de campos antes de imprimir e durante a edição da etiqueta. Mostra pendências de origem, código do produtor, datas, AFIDI, importador, destino e procedência. O operador pode corrigir os campos no editor existente; datas válidas confirmadas continuam visíveis, mesmo quando há um aviso de cronologia. Datas impossíveis não são apresentadas como válidas.

O formato continua A4 paisagem, com identidade Agronorte, espécie, origem, referência SPE/CAN do produtor, peso líquido, colheita, envasado, AFIDI, importador/endereço, lote, código do pallet, recepção, destino, responsável, declaração SENAVE e QR. O código AGN é uma identificação interna adicional. A revisão fica fora da área impressa. Não se estabelece AFIDI, importador ou data como padrão para cargas futuras.

## Operações administrativas pontuais

- `20261007_confirm_elias_export_labels.sql`: somente os nove pallets do lote 01102026 de Elias Galeano, com os pesos líquidos confirmados e soma 3.297 kg. Registra Uruguay, RINALIR SOCIEDAD ANÓNIMA, BATLLE Y ORDÓÑEZ 534, TACUAREMBÓ, URUGUAY, AFIDI 1571652, origem confirmada, código SPE/CAN e envasado 07/10/2026.
- `20261007_correct_current_label_sources.sql`: modelo com payload privado para vincular uma fonte verificada ao produtor correto e corrigir exclusivamente três erros de tara identificados na auditoria. Embalagem 42 kg; bruto = líquido + 42 kg. O peso líquido não recebe novo desconto. O arquivo público não contém identificadores dos registros privados.
- `20261007_harmonize_current_uruguay_labels.sql`: completa campos ausentes de etiquetas atuais para Uruguay com as informações já confirmadas, até 07/10/2026 18:13:45 UTC. Preserva datas e códigos explícitos, comprador próprio, pesos e QR. Não altera pallets expedidos ou vinculados à expedição.

Cada operação verifica a organização, as dependências e a auditoria, usa transação e bloqueio da revisão, e grava antes/depois com motivo e a identidade real da sessão. Nenhum registro operacional é apagado. As etiquetas alteradas voltam a En armado para reimpressão. As cópias de execução e resultados administrativos ficam em `outputs/label-audit`, fora do Git.

## Datas reconfirmadas de Elias

O proprietário reconfirmou **colheita 02/10/2026** e **recepção 01/10/2026**. Essa decisão substitui a pendência anterior registrada em ATUALIZAR-NOVAS-RECEPCOES.md: a colheita agora é explícita e confirmada, e ambas as datas são preservadas. Há aviso de colheita posterior à recepção; nenhuma data foi estimada para eliminar a diferença. Envasado 07/10/2026 foi confirmado separadamente.

## Atualização nos dispositivos

Guarde formulários abertos. Em Configuración, use Verificar actualización e, quando oferecido, Actualizar aplicación. Confira a versão 2026.10.07-12. No computador, Ctrl + Shift + R também carrega a publicação atual. Entre com a conta e abra Pallets → produtor → Etiqueta / QR. Não é necessário limpar o armazenamento do celular.

## Conferência real e impressão imediata

As operações pontuais foram aplicadas no projeto correto e verificadas em 07/10/2026 às 19:01 UTC, revisão 87: 22 produtores ativos, 34 pallets atuais para Uruguay, 12.470 kg líquidos, 34 taras de 42 kg, AFIDI 1571652 e envasado 07/10/2026 em todos. Não faltam código do produtor, origem, colheita ou importador nas etiquetas atuais. Cirila está vinculada ao SPE-GUA-017-SAN. Os pesos líquidos e vínculos das recepções permanecem iguais. A diferença cronológica dos nove pallets de Elias permanece explícita.

A versão **2026.10.07-9** acrescenta somente **Actualizar datos para imprimir** para recuperar uma sessão de impressão que ficou com revisão antiga. Carrega os registros atuais do servidor, guarda uma cópia local antes da troca e bloqueia a recuperação quando há novos registros operacionais pendentes. Não envia o conteúdo antigo por cima do banco. O proprietário confirmou que o erro atual ocorreu ao abrir/imprimir dados já salvos. Para imprimir imediatamente sem a sessão antiga, uma janela anônima permite entrar na conta e ler os dados atuais.

## Correção do total recebido do produtor

A versão **2026.10.07-11** coloca **Corregir total recibido** ao lado do total na ficha do produtor. Em Productores, abra o produtor e toque nesse botão. Com uma entrega ativa, o editor abre diretamente; com várias, escolha pelo peso, data e lote. O total do produtor é a soma das recepções e será recalculado depois de salvar a correção. Por orientação expressa do proprietário, a edição não pede justificativa: registra automaticamente erro de digitação, usuário, data e valores anteriores/novos na auditoria. Cancelar uma recepção mantém seu fluxo separado.

Uma única pesagem aparece como **Total recibido (kg)**. Para uma recepção com várias pesagens, **Corregir por total** permite informar um único total corrigido: os pesos anteriores ficam cancelados no histórico e um novo registro representa o total informado. Também é possível continuar corrigindo pesagens individuais. O modo escolhido não altera os pesos dos pallets nem distribui valores por estimativa. Perdas e saldo são recalculados pela regra existente; uma redução abaixo dos kg já palletizados exige corrigir os pallets correspondentes primeiro. O teclado numérico aceita vírgula ou ponto. A correção usa a função auditada de recepções já instalada; não requer novo SQL.

## Novas recepções pendentes em outro aparelho

O proprietário informou total recebido de **21.310 kg** e confirmou que os novos recebimentos ficaram em um celular ou outro computador. A consulta real ao Supabase às **19:30 UTC de 07/10/2026** mostrou sete recepções, somando **12.489 kg**. A diferença de **8.821 kg** não foi inserida como um lançamento sem origem: é necessário enviar os registros do aparelho em que foram cadastrados.

Na versão **2026.10.07-11**, **Sincronizar** pode recuperar o conflito de revisão para novas recepções comprovadas pelo histórico local. Consulta o servidor atual, conserva os dados remotos e acrescenta as novas recepções e seus vínculos. A soma das pesagens deve coincidir com o total original auditado; classificação, perdas, pallets e anexos seguem suas validações. Correções de registros antigos, origem ausente, duplicatas ou operações fora desse escopo continuam pendentes para revisão. Nunca substitui os pesos ou metadados atuais do servidor por uma cópia antiga.

Antes de reenviar, guarda uma cópia do espaço, arquivos locais e rascunhos em uma transação IndexedDB. A tentativa usa a revisão atual e é repetida somente uma vez; uma nova concorrência permanece protegida pela função do banco. As trocas de cache verificam também alterações em outra aba. Após um envio confirmado e falha na leitura, mantém a revisão confirmada e tenta somente consultar, evitando reenviar os mesmos registros.

No aparelho de origem, use **Configuración → Descargar respaldo local**, salve formulários abertos e carregue a versão atual. No computador, **Ctrl + Shift + R** atualiza a página; no aplicativo do celular, feche as janelas do sistema e abra novamente com internet. Toque **Sincronizar** no mesmo aparelho em que os novos dados foram lançados. O computador recebe os registros depois que o envio for confirmado. Não limpe o armazenamento nem use **Actualizar datos para imprimir** para descartar entradas novas: essa recuperação continua bloqueada quando há novos registros locais.

## Gravação pela conta e impressão — versão 2026.10.07-12

Por orientação do proprietário, o fluxo atual usa os registros do Supabase vinculados à conta e organização. Novos lançamentos online só retornam sucesso depois da confirmação do servidor; não exigem o botão Sincronizar. O botão passa a Atualizar datos. O aplicativo consulta novamente os dados ao recuperar foco e a cada minuto enquanto está visível. Para salvar com a conta é necessária conexão; formulários de recepção continuam com respaldo do rascunho.

O cache account:<user> é separado da cópia anterior cloud:<user>. A cópia anterior não é apagada, substituída ou reenviada automaticamente. Se contém registros pendentes, o sistema avisa que o respaldo existe e oferece seu download em Configuración. Isso permite editar os registros confirmados sem impor uma conciliação à sessão de impressão. A separação não transforma registros anteriores sem envio em recebimentos confirmados no servidor.

Corregir total recibido abre diretamente Total recibido (kg), com foco e teclado decimal; em várias recepções, o usuário escolhe a entrega correta. Guardar total recibido usa a revisão atual do servidor e não solicita justificativa. Conserva o histórico e os dados remotos que não foram modificados no formulário, recalcula perdas/saldo e preserva pesos e QR dos pallets. A seleção de recepção e os limites de saldo/expedição continuam aplicáveis.

Imprimir A4, Descargar PDF A4 e Descargar QR ficam disponíveis sem esperar uma sincronização. Pallets cancelados e perfis sem permissão continuam protegidos. A solicitação de impressão é guardada separadamente e auditada em segundo plano por record_pallet_label_print, idempotente por intenção/conta/pallet. Não envia snapshots do aparelho. A atualização SQL de auditoria foi aplicada diretamente no projeto Sandía e verificou-se acesso autenticado, ausência de acesso anônimo e conservação dos 34 pallets e 12.489 kg existentes.

Validações: lint, TypeScript/build, testes unitários e de banco; QA isolado a 375 px para edição direta, revisão fresca, campos remotos preservados, impressão com rede indisponível/pendências/operação em curso e permissões. Esses testes usam dados fictícios isolados; não lançam recebimentos ou correções no banco de produção.