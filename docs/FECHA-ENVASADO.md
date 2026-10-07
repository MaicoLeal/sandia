# Data de embalagem na etiqueta

Na versão **2026.10.07-5**, o formulário **Pallets → selecionar produtor → Etiqueta / QR → Editar etiqueta** oferece **Usar fecha de hoy** junto de **Fecha de envasado confirmada**. O botão calcula a data de `America/Asuncion` no momento do toque. O operador pode continuar digitando outra data confirmada; a data só é gravada ao salvar com justificativa, pelo fluxo existente de auditoria e sincronização.

O proprietário confirmou **07/10/2026** para preencher as datas de embalagem pendentes dos pallets atuais para Uruguay. A data fica em `pallets.metadata.export_label.packaged_date` e a etiqueta HTML/PDF usa esse valor registrado. Abrir ou imprimir uma etiqueta não atribui uma data automaticamente.

## Preenchimento dos registros atuais

Operação: `supabase/operations/20261007_current_uruguay_packaged_date.sql`. A operação alcança somente a organização Cooperativa Agronorte, pallets criados até **07/10/2026 14:37:55 UTC**, destino Uruguay, estados `En armado`, `Etiquetado` ou `Listo para carga`, sem vínculo com expedição e sem data de embalagem preenchida.

Datas já registradas são conservadas. A operação valida as datas de colheita confirmadas na etiqueta/lote e as recepções antes de atualizar qualquer pallet. Se alguma delas for posterior a 07/10/2026, a transação interrompe com uma mensagem para corrigir o registro. Peso líquido/bruto, tara, código do produtor/pallet, QR, AFIDI, importador e demais campos são preservados.

Cada alteração registra antes/depois e motivo na auditoria existente. A revisão da organização avança uma vez por aplicação com mudanças; as etiquetas alteradas voltam a `En armado` para nova impressão. Reexecutar não altera datas preenchidas nem duplica alterações.

O arquivo local **outputs/ACTIVAR-ENVASADO-AGRONORTE-20261007.sql** reúne as atualizações anteriores autorizadas e essa operação em uma transação única. A versão isolada fica em **outputs/FECHA-ENVASADO-URUGUAY-20261007.sql** para bases já atualizadas. Executar o arquivo escolhido completo no SQL Editor do projeto **znbtwkhktlldzhkiwodu**; depois sincronizar o aplicativo e conferir **FECHA DE ENVASADO** na prévia antes de imprimir.

O preparo e a verificação local do SQL não comprovam gravação em produção. O conector desta sessão não possui acesso autorizado ao projeto Sandía; a execução remota permanece manual, conforme a preferência do proprietário.
