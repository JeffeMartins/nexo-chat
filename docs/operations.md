# Operação e diagnóstico

## Serviços

`web` serve os assets e faz proxy HTTP/WebSocket; `api` executa migração e servidor; PostgreSQL armazena usuários, sessões, conversas, participantes, mensagens e outbox. Redis tem senha, não publica porta e usa `noeviction` para não remover silenciosamente chaves de rate limit/presença. Não é o banco permanente de mensagens.

Liveness mostra o processo; readiness exige banco e clientes Redis conectados. O Docker verifica readiness. Containers API têm limite de 512 MiB, PostgreSQL 384 MiB, Redis 192 MiB e web 96 MiB. Ajustar após medição, não presumir capacidade a partir desses números.

```bash
docker compose ps
docker compose logs --tail 100 api web
curl http://localhost:8100/health/ready
```

As migrations são SQL versionado com checksum e advisory lock transacional. Réplicas podem iniciar juntas sem aplicar uma migration duas vezes. Não alterar migration já aplicada; adicionar arquivo numerado. Logs não contêm texto das mensagens, senha, cookie ou token CSRF.

## Validação multi-instância

```bash
docker compose --profile scale-test up --build -d --wait --wait-timeout 180
npm run test:integration
```

Os clientes Node dos testes conectam um usuário na porta 8100 e outro na 8101. A segunda API compartilha PostgreSQL e Redis, não memória de processo. O frontend padrão continua apontando à primeira API. Em um servidor com balanceamento, distribuir conexões WebSocket entre as réplicas e manter os segredos/origem consistentes; como long polling está desabilitado, o transporte não exige afinidade HTTP para múltiplos polls.

Para parar também a segunda instância, usar `docker compose --profile scale-test down` sem `-v`.

## Queda de Redis ou API

Redis indisponível faz readiness e operações protegidas falharem de forma explícita. Nenhuma mensagem é confirmada como salva se a transação falhou. Mensagens anteriormente salvas permanecem no PostgreSQL. Depois da recuperação, os clientes reconectam/reconciliam histórico; uma outbox pendente volta a ser tentada. Não há promessa de entrega se banco, fila e cliente estiverem simultaneamente indisponíveis.

Presença pode ficar antiga por até a lease expirar. Logout revoga a sessão no banco e solicita desconexão às réplicas; verificação de sessão por evento impede nova escrita mesmo se um evento de desconexão entre instâncias se perder. A senha do Redis e a rede privada não devem ser compartilhadas com aplicações externas sem ACL/isolamento adequado.

## Próximas evoluções

Medição de carga com quantidade de sockets, duração, tamanho de mensagens, CPU/memória e latências registradas; métricas/tracing; recuperação de senha/e-mail; bloqueio/moderação; expiração/retention de mensagens e sessões; convites com consentimento; transferência de propriedade e saída de grupos; backup/restauração testados. A demonstração não afirma atender esses requisitos ainda.
