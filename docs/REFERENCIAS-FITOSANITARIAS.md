# Códigos de produtor SPE/CAN e modelo de etiqueta para Uruguay

Versão 2026.10.07-2. A planilha enviada pelo proprietário é o formulário SENAVE **FOR-DVF-013 — Planilla de instalación de trampas**, emissor **DPV-DVF**, versão **01**, vigência **13/08/2025**, dependência **Oficina Regional San Pedro**. O programa informado é vigilância fitossanitária de moscas das frutas e o plano de exportação de cucurbitáceas para Uruguay. O responsável registrado é **Ing. Amancio Coronel**.

O documento contém 23 instalações, 22 linhas com nomes de produtores e 21 produtores distintos; Richard aparece em duas instalações. São 20 instalações em 12/08/2026 e três em 25/08/2026. **Essas datas são de instalação e não de colheita, recepção ou embalagem.** O documento não registra capturas, diagnóstico de pragas ou perdas. As coordenadas são guardadas literalmente como valores U.T.M da fonte; não são convertidas para GPS, pois zona e datum não foram informados.

## Uso no aplicativo

- Em **Productores**, os cards, o histórico e a edição apresentam o SPE/CAN como **Código del productor**, conforme confirmado pelo proprietário na versão **2026.10.07-4**. A pesquisa aceita esse código. A seção **Instalaciones de trampas** conserva os dados de cada instalação em um card expansível apropriado para celular.
- Em **Informes → Instalación de trampas**, pode-se filtrar por produtor, data de instalação, código, nome ou localidade, consultar todos os registros e exportar CSV/Excel ou imprimir um resumo A4 paisagem. O CSV identifica o código vinculado em **Código_productor** e conserva o valor original em **Código_en_planilla**, inclusive nas linhas sem produtor. Os campos originais e notas de revisão são preservados.
- A área é apresentada por instalação. As duas áreas de Richard não são somadas como se comprovassem duas propriedades diferentes.
- O registro **TRAMPA ADCIONAL**, com hospedante MELON, fica sem produtor e continua consultável em Informes, pesquisando “Sin productor”. Ele não cria um produtor fictício nem fornece código à etiqueta de Sandía.

A vinculação usa nomes normalizados e somente as variações confirmadas pelo proprietário: Richard Llamosas → Richar Llamosas; Matias Alarcon → Matia Alarcon; Cirila Salinas → Ciria Salinas; Agustin Vera Tapari → Agustin Vera. Nomes sem correspondência ou com mais de um cadastro compatível ficam sem vínculo e recebem uma nota. Não se criam produtores, propriedades ou parcelas por suposição.

Na linha de Raquel, os valores **SPE-GUA-01-SAN** e **730323,86** são mantidos exatamente como constam na fonte, com notas de revisão. Para Agustin, a origem da fonte é **Canindeyú / Maracaná / Pindoju**. A importação preenche a origem quando ausente e corrige o antigo valor genérico “Depto. de San Pedro – Paraguay” nesse cadastro; uma origem personalizada previamente preenchida é preservada. Localidade é preenchida somente quando o cadastro está vazio.

## Etiqueta A4 paisagem

A etiqueta e seu PDF usam os mesmos campos: _Citrullus lanatus_ (sandía), origem, código do produtor SPE/CAN, peso líquido, data real de colheita, data confirmada de embalagem, AFIDI e rastreabilidade por QR/lote/pallet. O modelo mantém a identidade visual da Agronorte.

Conforme a identificação escolhida pelo proprietário, **CÓDIGO DEL PRODUCTOR** segue esta ordem:

1. Valor específico preenchido em **Editar etiqueta**.
2. Código(s) do produtor SPE/CAN das instalações ativas de Sandía vinculadas ao cadastro.
3. Código de exportação anteriormente registrado, quando não houver SPE/CAN.

O proprietário confirmou que o código da coluna de armadilha é o **CÓDIGO DEL PRODUCTOR** a apresentar. AGN continua no cabeçalho como **Código interno Agronorte**, e `export_code` permanece armazenado. Richard imprime ambos os códigos SPE/CAN, pois a planilha não informa qual deles corresponde à origem de cada pallet. A correção de nomenclatura não altera a importação, os identificadores armazenados ou o conteúdo dos QR Codes e não exige um novo SQL.

O modelo enviado em 07/10/2026 inclui o texto “FRUTA DE EXPORTACIÓN A URUGUAY - SENAVE - PROGRAMA DE CERTIFICACIÓN DE FRUTAS PROVENIENTES DEL SISTEMA INTEGRADO DE MEDIDAS DE MITIGACIÓN DE RIESGO PARA”, seguido de _Anastrepha grandis._ e **LOTE N°**. Esse texto integra a renderização HTML/PDF e pode ser conferido em **Editar etiqueta → Ver texto del modelo para Uruguay**. A atualização aplica o modelo aos pallets atuais para Uruguay com AFIDI **1571652**, sem vínculo com expedição, criados até **07/10/2026 13:07:38 UTC**, e registra a seleção do texto em `export_label.senave_program`. Pallets futuros recebem seus dados confirmados no formulário, sem AFIDI ou declaração automaticamente atribuídos pela importação.

Campos desconhecidos continuam como **No informado/No informada**. A etiqueta requer sincronização confirmada antes da impressão definitiva. QR continua usando apenas o token de rastreabilidade; documento de produtor, coordenadas, armadilhas e histórico não são expostos ao acesso público ou ao destinatário de Uruguay.

## Datas de colheita da imagem de 07/10/2026

A imagem “WhatsApp Image 2026-10-07 at 9.42.27 AM.jpeg” contém 22 produtores, 15 datas e sete campos vazios. O ano 2026 foi tomado do contexto da safra, pois a imagem mostra dia e mês. O proprietário recebeu uma pergunta sobre as duas datas incompatíveis com os registros atuais:

- Roberto Isasi: **29/10/2026**, futura em relação a 07/10/2026.
- Elias Galeano: **02/10/2026**, posterior à recepção de **01/10/2026** do lote **01102026**.

Essas duas datas são conservadas como referência **Pendiente de confirmar** e não preenchem lotes nem etiquetas. As sete células vazias preservam os dados existentes. As 13 datas utilizáveis foram transcritas para o SQL preenchido em `outputs`, fora do Git. A transcrição completa e a imagem permanecem locais; os testes publicados usam cadastros de prova para verificar as mesmas condições.

O SQL preenchido incorpora a fonte em `producers.metadata.harvest_reference`, com data, safra, status, documento e notas. A ficha, o card e o formulário do produtor mostram a referência informada. O preenchimento de lotes alcança apenas lotes atuais abertos sem data de colheita, cuja recepção não anteceda a data indicada, e preserva lotes e pallets fechados ou vinculados a expedição. A operação conserva datas já preenchidas nos lotes, datas específicas das etiquetas e campos pessoais.

Na etiqueta, a data específica do pallet tem prioridade, seguida pela data do lote. Quando ambas faltam, usa-se a referência confirmada do produtor somente na mesma safra e quando a colheita ocorre até a data da recepção. Essa herança é limitada aos pallets abertos sem expedição. Se um pallet misturar origens e alguma não tiver uma data utilizável, a impressão apresenta **No informada** e o editor exige preenchimento explícito; não apresenta uma data parcial como se fosse de toda a carga.

Template genérico: `supabase/operations/import_producer_harvest_dates.sql`. Fonte preenchida: `outputs/IMPORTAR-COLHEITAS-AGRONORTE-20261007.sql`, incluída no SQL único desta versão. Não há criação de produtor, lote ou recepção para acomodar uma data da imagem. Correspondências ausentes ou ambíguas são apresentadas no resultado de conferência da operação.

## Importação e ativação no Supabase

Migração: `supabase/migrations/20261007125340_trap_installations.sql`, criada pela CLI oficial. A nova tabela tem UUID, organização, datas, autor e status, vínculo opcional ao produtor, proveniência, campos originais e notas. Somente perfis internos ativos da mesma organização podem consultar. Não há escrita direta por clientes, nem leitura pública ou por destinatários.

As referências em `producers.metadata.trap_reference_codes` são derivadas no servidor. Clientes antigos ou alterações manuais do payload não podem substituir essas referências. A tabela é carregada em `Workspace.trapInstallations`, separada do payload gravável de `sync_workspace`, e sua consulta é condicionada à capacidade publicada pelo servidor para manter compatibilidade com bases ainda não atualizadas.

Template genérico: `supabase/operations/import_trap_installations.sql`. **Não executar o template vazio**: o importador exige exatamente as 23 linhas verificadas. O arquivo local preenchido, incluindo as atualizações anteriores autorizadas e o modelo de etiqueta, é **outputs/ACTIVAR-TRAMPAS-ETIQUETAS-AGRONORTE-20261007.sql**. Executar completo no SQL Editor do projeto **znbtwkhktlldzhkiwodu**. Ele valida a organização, o usuário Piris das atualizações anteriores e a auditoria, e usa uma única transação.

O PDF original e a transcrição completa ficam fora do Git em `outputs/trampas-source`. A importação das armadilhas conserva pesos, datas de lotes e recepções, códigos de pallet, QR e dados de expedições encerradas. O preenchimento de colheitas segue as condições descritas acima, sem substituir datas existentes. As operações registram as alterações na auditoria, preservam valores anteriores, atualizam a revisão da organização e marcam as etiquetas modificadas para reimpressão. Reexecutar não duplica instalações nem renumera produtores.

O conector Supabase disponível não possui acesso ao projeto Sandía. A aplicação remota e o número final de vínculos só podem ser confirmados pela consulta retornada após a execução manual. Depois, atualizar e sincronizar o aplicativo antes de reimprimir.

## Verificação

A suíte completa de 204 testes, lint e build da versão passaram. Os testes PostgreSQL usam as migrações reais e verificam permissões, aliases, nomes duplicados, isolamento entre organizações, auditabilidade, preservação de códigos/pesos/QR e repetição sem duplicidade. A operação com as 23 linhas reais também foi executada em banco PostgreSQL isolado, conferindo as duas referências de Richard, o registro sem produtor, as anomalias originais e a origem de Agustin. Os testes de colheita verificam campos vazios, datas pendentes, conflitos com recepções, lotes fechados e preservação das datas existentes. O SQL completo foi validado em transação única, incluindo rollback nos projetos ou usuários incorretos.

O navegador local de teste, com Supabase desativado, confirmou o histórico por produtor, os 23 registros no relatório, buscas por código/nome, instalação adicional, filtro por data de instalação, download do CSV e texto/campos da etiqueta e do editor. A largura de 375 px passou sem rolagem horizontal no histórico e o controle expansível tem 91 px de altura. Os testes de PDF confirmam uma página A4 paisagem de 297 × 210 mm com referências SPE/CAN, AGN, AFIDI e QR.
