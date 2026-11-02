# Configuração do PDV híbrido

## Banco de dados

No projeto Supabase, abra **SQL Editor → New query**, cole o conteúdo de
`migrations/20261102110000_hybrid_pos_cash_register.sql` e execute. A instalação
usa `orders`, `order_items`, `products`, `tables` e `payments` já existentes;
ela cria `cash_registers` e `payments_log`, acrescenta o campo de código de
barras e instala as funções transacionais do PDV.

Execute este script depois do schema base e das migrações anteriores do
COZINFOOD, especialmente a migração de pagamentos Pix das comandas.

## Pix dinâmico

Publique a função `create-pos-pix` no Supabase e mantenha configurado o segredo
`MERCADO_PAGO_ACCESS_TOKEN` nas secrets das Edge Functions. A função valida o
usuário e o caixa no servidor, cria a cobrança no Mercado Pago e devolve o QR
Code ao PDV. O webhook `mercadopago-webhook` atualiza o pagamento e o estado da
comanda. O token do Mercado Pago nunca fica no código do navegador.

Com a Supabase CLI autenticada e vinculada ao projeto, o comando de publicação é:

```powershell
npx supabase functions deploy create-pos-pix
```

## Operação

- O perfil `admin` ou `caixa` abre e fecha o caixa, recebe pagamentos e consulta
  o dinheiro contado. Só pode haver um caixa aberto por restaurante.
- O perfil `garcom` usa o modo Salão para lançar itens; o KDS continua controlando
  o preparo e a baixa de estoque já existente.
- No balcão, o caixa pode receber dinheiro, crédito, débito ou pagamentos mistos.
  Pix é uma cobrança separada e só é confirmado quando o Mercado Pago notifica o
  webhook.
- Os atalhos são `F2` para busca, `F3` para alternar modo, `F4` para pagamento e
  `Esc` para remover o último item do carrinho.
