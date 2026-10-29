# Pix individual na divisão da conta

## 1. Atualizar o banco

No Supabase, abra **SQL Editor**, cole e execute o conteúdo de `migrations/20261030100000_table_bill_splitting_pix.sql`.

## 2. Cadastrar as chaves protegidas

No Supabase, acesse **Project Settings → Edge Functions → Secrets** e cadastre:

- `MERCADO_PAGO_ACCESS_TOKEN`: access token da aplicação Mercado Pago (use credencial de teste para validar e credencial de produção quando liberar pagamentos).
- `MERCADO_PAGO_WEBHOOK_SECRET`: assinatura secreta de Webhooks da aplicação Mercado Pago.

Não coloque essas chaves no GitHub Pages nem em variáveis `VITE_*`.

## 3. Publicar as Edge Functions

Com o Supabase CLI instalado e autenticado, na raiz do projeto:

```powershell
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase functions deploy create-split-pix
supabase functions deploy mercadopago-webhook
```

As funções usam o segredo `SUPABASE_SERVICE_ROLE_KEY` provisionado pelo Supabase e o access token do Mercado Pago configurado no passo anterior. A função de Pix aceita chamadas públicas apenas com o token aleatório, longo e não enumerável da parte da conta.

## 4. Configurar notificações no Mercado Pago

Na aplicação do Mercado Pago, configure Webhooks para pagamentos e copie a chave secreta gerada para `MERCADO_PAGO_WEBHOOK_SECRET`. A URL da função é:

```text
https://SEU_PROJECT_REF.supabase.co/functions/v1/mercadopago-webhook
```

A criação de cada Pix também envia essa URL como `notification_url`. A função consulta o pagamento na API do Mercado Pago e valida a assinatura antes de atualizar a divisão.

O botão **Dividir conta / Pix** aparece na comanda aberta da mesa. Cada participante precisa informar e-mail, exigido pela API do Mercado Pago. A opção por itens gera uma cobrança para cada item escolhido; a divisão por pessoas divide o valor total e ajusta os centavos restantes na última parte.
