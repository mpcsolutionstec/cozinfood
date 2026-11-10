# Convites da equipe por e-mail

O administrador cadastra nome, e-mail e função em **Equipe e acessos → Convidar usuário**. O Supabase Auth envia o convite; ao abrir o link, a pessoa confirma o e-mail e cria a senha no COZINFOOD. O telefone pode ser informado como contato opcional.

## Configuração no Supabase

1. Configure um serviço SMTP (por exemplo, Brevo) em **Authentication → SMTP Settings**. Use o login e a chave SMTP fornecidos pelo serviço, além do host, porta e remetente verificado. O SMTP padrão do Supabase é limitado e não deve ser usado para entrega em produção.
2. Em **Authentication → URL Configuration**, defina o Site URL como `https://cozinfood.vercel.app` e inclua `https://cozinfood.vercel.app/**` em Redirect URLs.
3. Se publicar em outro domínio, inclua também esse endereço nas Redirect URLs e configure `APP_URL` nos segredos da Edge Function `invite-staff` para o domínio escolhido.
4. Publique a Edge Function `invite-staff` atualizada.
5. No COZINFOOD, cadastre o garçom com nome, e-mail e função **Garçom**. O link permitirá que ele confirme o e-mail e crie a senha.

O telefone opcional fica como contato no perfil. O acesso criado pelo convite é por e-mail e senha. A opção Telefone / SMS na tela de login continua disponível para contas com telefone configurado no Supabase Auth; para novos garçons, use o e-mail e a senha definidos no convite.

Não é necessária uma nova migration SQL: o fluxo usa as funções e o campo `profiles.phone` já existentes.
