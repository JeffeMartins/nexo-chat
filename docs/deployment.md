# Publicar em um servidor de testes

A demonstração atual funciona em localhost e no GitHub. Este guia prepara um caminho futuro; não existe domínio ou hospedagem já provisionados. É necessário um host que suporte conexões WebSocket persistentes e volumes para PostgreSQL. Conferir limites, compatibilidade e custos do provedor no momento da publicação; hospedagem de frontend estático, por si só, não executa o backend do chat.

Em Linux com Docker/Compose atual, obter o projeto, gerar credenciais exclusivas com `node scripts/setup.mjs` e configurar no `.env`:

```dotenv
CHAT_DOMAIN=chat.seu-dominio.com
```

Não copiar as senhas do seu computador para um repositório. Configure DNS A/AAAA para o servidor e libere apenas os acessos necessários: HTTP/HTTPS e SSH administrativo restrito. PostgreSQL e Redis permanecem privados.

```bash
docker compose -f compose.yaml -f compose.production.yaml config --quiet
docker compose -f compose.yaml -f compose.production.yaml up --build -d --wait --wait-timeout 180
```

O overlay remove os binds locais de API/web e expõe somente o proxy Caddy em 80/443. `APP_ORIGIN` das APIs passa a ser a URL HTTPS real e o cookie usa Secure. Caddy encaminha upgrades WebSocket e gerencia certificados/redirect HTTP→HTTPS. Seus dados de certificado ficam em volumes persistentes; DNS válido, portas acessíveis e armazenamento são requisitos para emissão.

O proxy Nginx interno sobrescreve X-Forwarded-For com o endereço do cliente que o conectou. Com Caddy à frente, esse endereço será o proxy: o limite por IP de login poderá ser compartilhado entre visitantes. Antes de ampliar uma instalação pública, definir explicitamente a cadeia de proxies confiáveis e a extração segura do IP real. Não confiar em um X-Forwarded-For enviado diretamente pelo visitante.

Validação após publicar: criar duas contas fictícias, conversar por navegadores/redes diferentes, criar grupo, testar logout, cookies Secure, origem rejeitada, HTTPS e recuperação do histórico. Testar backup/restore do PostgreSQL. O cadastro não verifica e-mail e não oferece recuperação de senha ou moderação; considerar isso antes de abrir a desconhecidos. Não usar conversas sensíveis como dados de demonstração.

A configuração foi preparada para servidor próprio/de testes, não como promessa de SLA ou segurança comercial completa. Nenhum recurso externo é criado por esses arquivos automaticamente.

Fontes: [Compose merge/reset](https://docs.docker.com/reference/compose-file/merge/) e [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https).
