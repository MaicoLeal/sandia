# Importador na etiqueta de pallet

Versão 2026.10.07-3. A etiqueta A4 paisagem e seu PDF exibem um bloco **IMPORTADOR** no cabeçalho quando há nome ou endereço registrado. O bloco conserva o logotipo, as sete linhas de identificação da fruta, o QR e a declaração selecionada para Uruguay.

## Registro e correção

Em **Pallets → selecionar produtor → Etiqueta / QR → Editar etiqueta**, preencher **Importador (razón social)** e **Dirección del importador**, com a justificativa do registro ou correção. Os campos também estão disponíveis nos dados opcionais de exportação ao criar pallets. Aceitam até 200 e 400 caracteres, respectivamente. O aplicativo informa quando os dados ultrapassam o espaço disponível para impressão, em vez de cortar o texto.

Os dados pertencem à etiqueta de cada pallet. Não substituem a origem da fruta, a localidade do produtor ou o cadastro de clientes de uma expedição. Campos vazios conservam a apresentação anterior da etiqueta. A alteração utiliza o fluxo existente de auditoria, revisão e sincronização; pallets fechados ou vinculados a uma expedição conservam suas restrições.

## Supabase e compatibilidade

`pallets.metadata.export_label` aceita os campos opcionais `importer_name` e `importer_address`. O servidor publica a capacidade `label_importer_details`. Antes de aplicar a migração, os novos controles permanecem desabilitados, e os formulários continuam enviando os dados antigos. Isso permite atualizar o aplicativo sem impedir o uso de uma base ainda não atualizada.

Migração: `supabase/migrations/20261007135124_label_importer_details.sql`. Template operacional: `supabase/operations/set_current_uruguay_importer.sql`. O SQL preenchido fica localmente em `outputs/ACTIVAR-ETIQUETAS-IMPORTADOR-AGRONORTE-20261007.sql`, junto da fonte fornecida pelo proprietário, fora do Git. Ele reúne as atualizações anteriores e alcança pallets criados até **07/10/2026 13:51:04 UTC**, abertos, com destino Uruguay, sem vínculo com expedição e sem outro importador já informado. Não atribui esse comprador a futuros pallets. A conferência após a execução mostra os dados de importador aplicados. Reaplicar o pacote conserva os campos novos durante a reinstalação das validações antigas, sem duplicar auditorias ou alterar a revisão quando nada mudou.

Depois de aplicar a atualização no SQL Editor do projeto Sandía, atualizar e sincronizar o aplicativo. Conferir a prévia em **Etiqueta / QR** antes de imprimir ou baixar o PDF. A impressão definitiva continua exigindo sincronização confirmada.

## Verificação

Lint, build e 219 testes passaram. As verificações PostgreSQL cobrem limites, perfis, isolamento entre organizações, RPCs atuais e antigos, campos omitidos versus limpeza explícita, auditoria, registros fechados, preenchimento parcial compatível e repetição do SQL completo. O navegador local isolado confirmou edição com justificativa, persistência após reabertura, preservação de pesos/datas/códigos/QR, controles desabilitados em bases antigas e ausência de rolagem horizontal em 375 px. A impressão HTML e o PDF de uma página A4 paisagem foram renderizados e conferidos visualmente, incluindo nome, endereço e acentos. A gravação remota permanece dependente da execução manual no projeto Sandía.
