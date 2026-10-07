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

Guarde formulários abertos e sincronize as entradas pendentes. Em Configuración, use Verificar actualización e, quando oferecido, Actualizar aplicación. Confira a versão 2026.10.07-8. Depois atualize os dados e abra Pallets → produtor → Etiqueta / QR. Confira a revisão de campos e gere novamente as etiquetas alteradas. Não é necessário limpar o armazenamento do celular.
