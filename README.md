# Agronorte · Recepción de Sandía

Aplicação React + TypeScript + Vite + Tailwind, em espanhol do Paraguai. Interface para celular e computador, com recepção, pesagem, classificação, pallets, etiquetas QR, expedição, histórico e relatórios.

## Executar

Requisitos: Node.js 22.12 ou superior e npm. Dependências fixadas em `pnpm-lock.yaml`; também pode usar `pnpm install --frozen-lockfile`.

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
3. Aplique o bootstrap de organização/perfil após substituir o UUID do usuário em `supabase/bootstrap.example.sql`. A primeira conta precisa de perfil administrador. Perfis seguintes são atribuídos por SQL administrativo nesta primeira versão.
4. No aplicativo, abra Configuración e inicie sessão. O espaço autenticado começa vazio: os exemplos locais nunca são enviados ao banco de produção.
5. Depois de publicar, configure `VITE_PUBLIC_TRACE_URL` com a URL HTTPS real e gere as etiquetas. QR com localhost não funciona em outro celular.

## Fluxo de uso

- Cadastre produtor e propriedade/parcela, ou use os atalhos dentro da recepção.
- Nueva recepción: escolha produtor e a parcela, quando conhecida, crie ou selecione lote, informe datas/responsável e adicione pesos. O resumo calcula total, contagem, média, mínimo e máximo.
- Parcela, data de colheita, peso bruto e nota de qualidade visual podem ficar sem informação; o sistema não atribui valores fictícios.
- A seleção divide o recebido em aprovado/rejeitado, ambos em kg. Quantidade de frutas é opcional e não interfere no saldo em kg.
- Crie um ou vários pallets iguais por operação, informando o peso líquido; bruto/tara podem ficar pendentes. O sistema verifica o saldo aprovado antes de alocar.
- Consulte/imprima a etiqueta e marque o pallet listo para carga.
- No modo conectado, sincronize os pallets antes de expedir. A expedição exige destino comum e pallets disponíveis; a transação no servidor impede dupla alocação e dupla expedição.
- Informes inclui recepção, produtor, lote, pallet, rejeições, expedição e exportação. CSV abre no Excel; PDF é obtido com “Guardar como PDF” no diálogo de impressão.

## Dados reais e inicialização

O aplicativo abre vazio, sem dados fictícios. Ao atualizar uma instalação anterior, remove somente o antigo espaço `demo`, seus rascunhos e anexos locais. Espaços autenticados e o novo espaço local de dados reais são preservados. Exemplos continuam apenas nas fixtures dos testes e não são carregados pelo aplicativo.

Sem login, os registros reais permanecem exclusivamente neste navegador/dispositivo, com aviso explícito. Baixe um respaldo local antes de limpar dados do navegador. Iniciar sessão abre um espaço separado da organização: esta versão não transfere automaticamente os registros locais para a conta. Essa transferência precisa de procedimento supervisionado, para evitar duplicação e perda de origem.

## Persistência e offline

IndexedDB guarda o espaço, os anexos e rascunhos. A aplicação instalada/cacheada pode ser reaberta offline depois do primeiro acesso. Mudanças autenticadas ficam pendentes e são sincronizadas quando há conexão, com confirmação do servidor. O botão Sincronizar permite tentar novamente. Uma falha não apaga os registros locais.

A sincronização utiliza uma revisão por organização e uma transação completa. Se duas pessoas modificarem a mesma revisão, a segunda recebe conflito e conserva seus dados locais. Esta primeira versão **não mescla automaticamente conflitos**. É necessário conciliar com o gestor, usando uma cópia/exportação local antes de atualizar o espaço. Para operação simultânea de grande volume, evoluir para fila de operações por entidade e resolução de conflitos dedicada; a estrutura atual evita sobrescrita silenciosa.

No navegador, armazenamento local e sessão dependem do acesso ao dispositivo. Sair da conta não elimina a cópia offline, e o navegador pode remover dados por políticas de armazenamento. Use contas e dispositivos controlados pela cooperativa.

## Segurança e auditoria

As tabelas utilizam UUID e organização; FKs compostas impedem ligar entidades de organizações diferentes. RLS permite leitura apenas da organização do perfil ativo. Escritas ocorrem pela RPC transacional, que valida perfil, revisão e integridade; clientes não recebem DELETE nem escrita direta.

O banco preserva o código/nome de lote informado (único por organização) e gera um código quando ele está vazio. Gera os códigos finais dos pallets, datas e auditoria. O operador vê um código provisório local até a sincronização. Auditoria preserva antes/depois e usuário. Correções de peso exigem gestor/administrador e motivo; uma recepção já classificada exige reversão supervisionada, ainda não disponível na interface. Correção de data antes da classificação exige justificativa e gera auditoria. Cancelamento de recepção antes da classificação preserva as pesagens e registra justificativa. Pallets expedidos e vínculos operacionais não podem ser editados diretamente.

Anexos são privados (máximo 10 MB), com leitura autenticada e URLs assinadas. O QR usa token opaco e mostra somente código, produto, peso líquido, destino e status. A solicitação de impressão é auditada; o navegador não confirma que a impressora fisicamente imprimiu.

As políticas seguem a [documentação de RLS do Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security). Os testes PostgreSQL locais simulam Auth/Storage para validar SQL e regras; não substituem a homologação de Auth e Storage no projeto real.

## Identidade

Logotipo `PRINCIPAL.png` confirmado no Drive oficial, preservado em `public/agronorte-logo.png`. Origem: https://drive.google.com/file/d/1KWlf16nK9-xLBVzQP0tJLo_SO3I99fiq/view. Interface verde/branco, com #36741B e #688B11. A fonte de interface utiliza fallback do sistema; Metropolis não foi incluída porque o arquivo/licença da fonte não está no projeto.

## Limites e próximos passos

- Instalação PWA requer publicação HTTPS. APK Capacitor não foi gerado.
- Integrações com balança, leitor de câmera, impressora dedicada, n8n e envio de mensagens não estão conectadas.
- O módulo calcula e documenta a carga; não substitui documentos sanitários, aduaneiros ou requisitos legais de exportação.
- Relatórios usam CSV e impressão/PDF; não geram XLSX nativo ou PDF por biblioteca nesta versão.
- Administração de perfis e reversões de classificação/expedição são feitas por procedimento administrativo; não existe uma tela completa de gestão desses processos.
- Etiqueta padrão é A5; ajuste formato físico e margens para a impressora de etiquetas da operação durante homologação.

## Arquivos principais

`src/App.tsx`: telas e formulários. `src/domain.ts`: cálculos e regras. `src/types.ts`: tipos relacionais. `src/useWorkspace.ts`: persistência e sincronização. `src/services/supabase.ts`: Auth, tabelas, Storage e RPC. `src/services/reports.ts`: exportação e impressão. `supabase/migrations/`: esquema e regras do servidor.
