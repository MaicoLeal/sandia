# Novas recepções e etiquetas — 07/10/2026

O proprietário informou novas recepções e autorizou atualizar os registros atuais com os códigos de produtor, datas de colheita confirmadas e AFIDI **1571652** para Uruguay. Confirmou **07/10/2026** como `Fecha de envasado` dos novos pallets. A operação pontual está em `supabase/operations/20261007_refresh_current_uruguay_labels.sql`.

## Escopo e dados utilizados

O corte desta autorização é **07/10/2026 15:32:35 UTC**, equivalente a **12:32:35 no Paraguai**. Lotes e pallets posteriores ao corte ficam para uma próxima confirmação. O procedimento se limita à organização Cooperativa Agronorte (`20000000-0000-4000-8000-000000000001`) no projeto **znbtwkhktlldzhkiwodu**.

Nos lotes abertos atuais, inclusive nas recepções ainda sem pallet, a colheita só é preenchida quando está vazia e existe uma referência de produtor `Confirmado`, da safra 2026, compatível com a data da recepção. Datas já registradas são conservadas. A referência de Elias Galeano de 02/10/2026 continua pendente nos registros cuja recepção é de 01/10/2026; a referência de Roberto Isasi de 29/10/2026 continua pendente porque é futura. O procedimento não transforma essas referências em colheitas realizadas.

Nas etiquetas, o ajuste alcança os pallets atuais com destino confirmado Uruguay, em `En armado`, `Etiquetado` ou `Listo para carga`, sem vínculo com expedição. O AFIDI fica em cada pallet, junto da seleção do modelo SENAVE/Uruguay já solicitado. A embalagem de 07/10/2026 completa somente campos pendentes e compatíveis com a cronologia; datas de embalagem preenchidas são preservadas.

O `CÓDIGO DEL PRODUCTOR` usa os códigos SPE/CAN reais dos produtores vinculados. Códigos oficiais já preenchidos na própria etiqueta são conservados. Um código composto somente por identificadores internos AGN pode ser substituído pelos SPE/CAN vinculados; AGN não é tratado como código oficial. Quando falta um código real, existe uma origem incompleta ou a união ultrapassa o tamanho aceito pela etiqueta, a pendência é informada. Os números internos permanentes dos produtores continuam preservados.

Uma data única de colheita na etiqueta só é preenchida quando todas as origens do pallet têm a mesma data confirmada e compatível. Pallets com datas distintas mantêm suas origens para conferência no aplicativo. O resultado do SQL mostra as pendências e os dados encontrados.

Pesos líquidos, brutos, tara, quantidade de frutas, datas de recepção, códigos de lote/pallet e tokens do QR são preservados. Lotes encerrados, pallets expedidos ou vinculados a expedição e registros de outras organizações são conservados. Cada alteração usa a auditoria existente, com antes/depois, motivo e identidade real da sessão SQL; a revisão da organização avança uma vez quando há mudanças. Etiquetas alteradas voltam a `En armado` para nova impressão.

## Aplicação e conferência

1. Guarde formulários abertos e use **Configuración → Descargar respaldo local** nos dispositivos com novas entradas.
2. Confirme que as entradas foram sincronizadas. Se aparecer erro, use a versão **2026.10.07-6** e registre a mensagem completa com código. Concilie um eventual conflito de revisão antes de executar uma nova alteração administrativa; não apague o cache e não force a revisão.
3. No SQL Editor do projeto **znbtwkhktlldzhkiwodu**, execute a operação completa, incluindo sua transação e consultas finais. Ela verifica as dependências e a auditoria antes de atualizar. Se indicar uma dependência ausente, aplique o pacote completo preparado para esta instalação, em vez de executar partes fora de ordem.
4. Confira no resultado os pallets incluídos, o AFIDI **1571652**, a embalagem **2026-10-07**, o código do produtor e as pendências de colheita/código. Os totais e pesos devem corresponder aos lançamentos feitos no aplicativo.
5. Atualize os dados no aplicativo e abra **Pallets → produtor → Etiqueta / QR**. Confira a prévia e gere novamente a impressão A4 paisagem ou o PDF das etiquetas alteradas. O QR continua com o mesmo identificador.

O arquivo isolado local é **outputs/ATUALIZAR-NOVAS-RECEPCOES-ETIQUETAS-20261007.sql**. O pacote com as atualizações anteriores autorizadas é **outputs/ACTIVAR-NOVAS-RECEPCOES-ETIQUETAS-20261007.sql**. Escolha um arquivo conforme a situação da base; não execute os dois por rotina. Ambos são arquivos locais fora do Git.

Preparar e validar o SQL localmente não confirma gravação na base de produção. O conector disponível nesta sessão não tem acesso ao projeto Sandía, e o proprietário escolheu a execução manual pelo painel. A execução real e a consulta final permanecem necessárias.
