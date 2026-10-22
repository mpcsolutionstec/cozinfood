# COZINFOOD

Painel web responsivo para operação de restaurante, construído com React, Vite, Tailwind CSS e Supabase. O projeto começa em modo de demonstração e troca para leitura/Realtime do Supabase ao fornecer as variáveis públicas do projeto.

## Executar localmente

1. Instale Node.js 20 ou superior.
2. Copie `.env.example` para `.env` e informe `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (chave publicável/anon).
3. Rode `npm install` e `npm run dev`.
4. Execute `supabase/schema.sql` no SQL Editor de um projeto Supabase novo. Cadastre o restaurante e crie usuários em Authentication; associe cada UUID em `profiles` com a unidade e papel correspondentes.

Sem `.env`, a interface carrega amostras locais; ações de escrita não são persistidas. Com Supabase, os hooks assinam mudanças de `order_items` e `tables` usando Postgres Changes. Ative Realtime para essas tabelas no projeto.

## Publicação no GitHub Pages

O workflow `.github/workflows/pages.yml` cria o build e publica em `https://mpcsolutionstec.github.io/cozinfood/` ao enviar commits para `main`. Em Settings → Pages, selecione GitHub Actions. Cadastre `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` como Actions Variables e publique novamente. A chave anon é pública e só é segura com RLS habilitado; nunca use `service_role`, token privado do Mercado Pago ou segredo de webhook no navegador.

O repositório informado não estava presente como checkout nesta pasta e esta sessão não dispõe de conector MCP de GitHub. O workflow está pronto, mas push e ativação no GitHub precisam ocorrer numa cópia autenticada do repositório.

## Escopo funcional desta base

- Dashboard, mapa visual de mesas, fila KDS filtrável por setor, construtor demonstrativo de pizzas e quadro inicial de delivery.
- SQL multi-tenant com entidades operacionais, RLS, Realtime, totalizadores e baixa de ficha técnica ao marcar item como entregue.
- A tela ainda não implementa fluxo de caixa completo, formulário de abertura de pedido, fila offline sincronizada, geração de QR Pix dividido, menu público ou webhook real. Os botões/indicadores que aparecem como demonstração não representam transações concluídas.

## Arquitetura de produção

Hospede somente o frontend no Pages. Use Supabase Auth/RLS para acesso por restaurante e Edge Functions (ou servidor próprio) para operações privilegiadas. Para Pix, a Edge Function cria a preferência/ordem no Mercado Pago com segredo guardado em secret do servidor, grava pagamento com referência idempotente e recebe webhook validado; o navegador só consulta estado no banco. Para WhatsApp, encaminhe eventos de estado para um provedor por função/server. Para QR público, implemente RPC com `SECURITY DEFINER` que valide token da mesa, calcule preços no banco e limite campos graváveis; não abra INSERT anônimo irrestrito nas tabelas de pedidos.

## Pastas

- `src/hooks`: subscriptions do KDS e mesas.
- `src/lib/supabaseClient.js`: cliente Supabase usando chave publicável.
- `supabase/schema.sql`: DDL inicial do banco, enums, índices, triggers e policies.
- `.github/workflows/pages.yml`: build e publicação via GitHub Pages.
