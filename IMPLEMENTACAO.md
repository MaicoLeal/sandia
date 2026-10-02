# Recepción de Sandía — especificação de integração

Estado: especificação de referência para a aplicação criada nesta pasta. A implementação e os limites da primeira versão estão descritos em README.md. A migração foi aplicada ao projeto Supabase fornecido em 02/10/2026; a ativação do primeiro usuário administrador depende da criação de sua conta Auth.

## Escopo

Módulo React/TypeScript/Vite/Tailwind, em espanhol do Paraguai, com persistência Supabase e interface mobile. Navegação: Inicio, Recepción, Productores, Pallets, Expedición, Informes. A integração deve reutilizar autenticação, organizações, componentes e padrões do sistema existente.

## Modelo e integridade

- producers → farms → plots → field_lots → receptions → reception_weights/classifications → pallet_items → pallets → shipment_pallets → shipments.
- Uma parcela pertence a uma propriedade e ao mesmo produtor do lote. Uma recepção referencia um lote; produtor e parcela são derivados da origem para evitar divergências.
- Cada entidade terá UUID, organização, criação, atualização, responsável e status. Anexos e auditoria devem compartilhar a organização do registro relacionado.
- Pesos em kg com precisão decimal fixa. Entrada deve aceitar vírgula decimal e rejeitar valores vazios, negativos e não numéricos.
- Classificação registra explicitamente a unidade: kg, frutas ou caixas. Não subtrair contagem de frutas de um peso em kg.
- Separar peso bruto, tara e peso líquido. O saldo palletizável é o peso líquido aprovado, descontadas as alocações ativas em pallet_items. Não permitir dupla alocação nem saldo negativo.
- Registrar perdas, rejeições e saldo não palletizado; não exigir que todo o recebido seja exportado.
- Expedição exige pallets disponíveis, sem vínculo com outra expedição ativa. Finalização e alterações de status devem ocorrer numa transação no servidor.
- Usar timestamptz; apresentação e limites de dias/semana no fuso America/Asuncion. Datas agrícolas sem hora usam date.
- Códigos de lote/pallet gerados no servidor com restrição única por organização. UUIDs locais funcionam como chaves de idempotência para sincronização.

## Segurança e auditoria

- RLS por organização e perfil em todas as tabelas e Storage. As permissões devem ser aplicadas no banco, além da interface.
- Administrador gerencia cadastros; recepção/pesagem registra suas operações; packing monta pallets; gestor faz correções justificadas; auditor apenas consulta.
- Pesagens e registros operacionais não são apagados fisicamente. Cancelamento e correção preservam antes/depois, ator, instante e motivo. Auditoria deve ser produzida no servidor e não editável pelo operador.
- Separar profiles dos usuários Supabase Auth; não copiar senhas para tabelas próprias.
- QR usa token público opaco revogável. A consulta pública mostra somente dados autorizados do pallet, sem documento, telefone, anexos privados ou identificadores internos.
- Anexos em bucket privado, com acesso autenticado ou URL assinada; validação de tamanho e tipo.

## Fluxos e telas

1. Inicio: totais do dia/semana, pendências, rejeições, pallets prontos/expedidos e atalhos grandes.
2. Recepción: produtor existente ou cadastro rápido; parcela/lote; data/responsável; pesos sequenciais; resumo automático; salvar rascunho ou confirmar.
3. Selección: aprovado/rejeitado com unidade, calibre, qualidade e motivo; fotos opcionais.
4. Pesaje: histórico numerado; correção autorizada com motivo obrigatório; versões anteriores consultáveis.
5. Pallets: criação, alocação do saldo, destino e pesos; etiqueta, QR e status.
6. Expedición: cliente, país, transporte, motorista, placa, saída e pallets; resumo de carga e origens.
7. Productores: cadastro, parcelas, entregas, lotes, pallets, destinos e evolução por período.
8. Lote: linha do tempo de eventos e rastreabilidade até a expedição.
9. Informes: filtros por data, produtor, lote, pallet, destino e rejeição; CSV e impressão/PDF.

## Offline e integrações

IndexedDB para rascunhos e fila de operações, com status visível: borrador, pendiente de sincronización, sincronizado, conflicto. Sincronização idempotente; conflitos de alocação e correção precisam de resolução explícita. Não exibir sucesso remoto antes da confirmação Supabase. Expedição final exige validação de disponibilidade no servidor. Preparar adaptadores para balança, impressora, leitor QR e eventos para n8n; não enviar mensagens externas automaticamente sem configuração autorizada.

## Identidade visual

Usar verde/branco conforme pedido. Confirmar manual e arquivos oficiais antes de incorporar logotipo e tipografia. Não redesenhar o símbolo da cooperativa. Priorizar contraste, campos curtos, alvos de toque amplos e navegação inferior, com adaptação para desktop.

## Dados fictícios e validação

Elias Galeano; Sandía; recepção em 01/10/2026; destino Uruguay. Pesos: 340, 410, 381, 395, 394, 389, 343, 397, 198 kg.

Resultado conferido: 9 pesagens; total 3247 kg; média 360,777777… kg (exibir 360,78); mínimo 198 kg; máximo 410 kg. Dados devem ser identificados como demonstração e não inseridos automaticamente em produção.

## Critérios de entrega

- Executar npm run lint e npm run build no projeto integrado e corrigir erros.
- Validar os cálculos, saldo palletizado, correção auditada, isolamento entre organizações, permissões e idempotência.
- Conferir navegação e formulários em celular, rascunho offline e sincronização após reconexão.
- Conferir impressão da etiqueta, leitura real do QR e conteúdo público permitido.
- Confirmar relatórios, rastreabilidade nos dois sentidos e demonstração separada de produção.
- Informar quais migrações foram apenas preparadas e quais foram efetivamente aplicadas, sem tratar configuração ausente como integração concluída.
