# Códigos internos de produtores Agronorte

O cadastro passa a ter um código interno permanente no formato **AGN-0001**, **AGN-0002** e assim por diante. A atualização atribui códigos aos produtores que já estão no banco da Cooperativa Agronorte, incluindo os inativos, sem criar novos cadastros nem alterar dados pessoais ou entregas.

Os códigos são gerados no servidor, com bloqueio por organização e unicidade no banco, para dois celulares não receberem o mesmo número. Produtores novos recebem o código na primeira sincronização. Alterar nome, telefone ou outros dados não altera o código, e o histórico preserva os códigos dos cadastros inativos. Códigos internos que já existirem são mantidos.

## Onde aparece

- No card e na ficha do produtor, com pesquisa pelo código.
- Na seleção do produtor durante a recepção e na consulta de pallets.
- Na identificação da etiqueta A4 paisagem e no PDF, junto ao produtor, como **Código interno Agronorte**.

O código de exportação fica no campo separado `export_code`. Na versão **2026.10.07-4**, conforme a correção do proprietário, o SPE/CAN da planilha é identificado como **Código del productor** nos cards, histórico e edição do cadastro, assim como na etiqueta. A linha **CÓDIGO DEL PRODUCTOR** usa o valor específico da etiqueta, quando informado; caso contrário, usa os códigos SPE/CAN vinculados ao produtor e então o código de exportação disponível. O código interno AGN continua separado como **Código interno Agronorte** e não usa RUC, CI, telefone ou UUID como identificação impressa. Esta correção de nomenclatura reutiliza os dados já importados e não exige uma nova atualização SQL. Consulte `docs/REFERENCIAS-FITOSANITARIAS.md` para a importação dos registros reais.

Para pallets com mais de um produtor, a identificação da etiqueta apresenta os códigos internos vinculados às origens, sem repetir o mesmo código. O AFIDI, o QR, os pesos, o lote e os demais campos de exportação permanecem disponíveis.

## Ativação

A migração é `supabase/migrations/20261007121008_producer_internal_codes.sql`, criada pela CLI do Supabase. Ela verifica a base, o suporte às etiquetas e a auditoria antes de alterar dados. O preenchimento inicial alcança somente a organização Agronorte autorizada; outros cadastros de organizações existentes ficam intactos.

Para execução manual foi preparado `outputs/ACTIVAR-CODIGOS-PRODUCTORES-AGRONORTE-20261007.sql`. O arquivo reúne esta migração com as atualizações anteriores já autorizadas de recepções, tara de 42 kg, administrador Piris e AFIDI 1571652. Executar o arquivo completo no SQL Editor do projeto **znbtwkhktlldzhkiwodu**. O resultado final lista os nomes reais dos produtores, seus códigos internos e eventuais códigos oficiais.

Não é necessário copiar código produtor por produtor. Reexecutar o arquivo não renumera códigos já atribuídos. A operação registra antes/depois e motivo na auditoria, além de atualizar a revisão da organização para que outros dispositivos detectem os dados antigos.

Após a execução, sincronizar o aplicativo, abrir **Productores** e conferir os códigos. Em **Pallets**, selecionar o produtor e abrir **Etiqueta / QR** para gerar a nova impressão. Pallets ativos já etiquetados ou prontos, sem vínculo com expedição e cuja identificação mudou, voltam a **En armado** para reimpressão. Registros expedidos conservam seu estado e os códigos de pallets/QR não são recriados.

O conector Supabase não possui acesso ao projeto Sandía nesta sessão. A ativação remota depende da execução manual e da consulta de verificação; o deploy do aplicativo, por si só, não grava os códigos nos cadastros reais.

## Verificação da versão 2026.10.07-1

`npm run lint`, `npm run build` e a suíte completa de **149 testes** passaram. A cobertura inclui o SQL real em PostgreSQL local, criação de dois produtores na sincronização, proteção contra troca ou remoção do código, compatibilidade com clientes que omitem metadados, preservação de dados oficiais, sequência acima de 9999, isolamento por organização, permissões, auditoria e reexecução sem alterações duplicadas. Os testes de etiqueta confirmam o código interno e o AFIDI no PDF de uma página A4 paisagem, sem substituir a linha do código oficial. O arquivo SQL combinado passou na verificação atômica de projeto, usuário administrador e preservação dos registros operacionais.
