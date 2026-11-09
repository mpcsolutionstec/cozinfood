# Usuários e funções da equipe

Para habilitar a tela **Equipe e acessos** no projeto Supabase:

1. Aplique `migrations/20261109130000_staff_profile_management.sql` no banco.
2. Publique a Edge Function `invite-staff` com `supabase functions deploy invite-staff`.
3. Confirme em **Authentication → URL Configuration** que `https://cozinfood.vercel.app/` está permitido como URL de redirecionamento. A função usa `APP_URL` se esse segredo estiver configurado; caso contrário, usa o domínio acima.

A Edge Function usa `SUPABASE_SERVICE_ROLE_KEY` somente no servidor. Não adicione essa chave às variáveis `VITE_*` nem ao frontend.

Administradores podem convidar perfis `admin`, `garcom` e `caixa`, editar os dados dos usuários e desativar acessos. O banco impede remover o último administrador ativo.
