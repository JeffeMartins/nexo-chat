# Contratos de integração

Os schemas de entrada e DTOs estão em `packages/contracts/src/index.ts`. Respostas de erro seguem `{ "error": { "code": "...", "message": "..." } }`. A API aceita JSON até 16 KiB e nunca usa um `senderId` recebido para decidir a identidade.

## HTTP

| Método / caminho                                | Uso                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| POST `/api/auth/register`                       | `{displayName,handle,email,password}`; cria sessão e retorna usuário, CSRF e expiração |
| POST `/api/auth/login`                          | `{email,password}`; cria sessão                                                        |
| GET `/api/auth/me`                              | Sessão atual; token CSRF para a aplicação same-origin                                  |
| POST `/api/auth/logout`                         | Revoga a sessão e desconecta seus sockets                                              |
| GET `/api/users?q=...`                          | Até 30 pessoas por nome/handle; e-mails não são públicos                               |
| GET `/api/presence?ids=uuid,uuid`               | Até 50 presenças; a presença pode ser desconhecida                                     |
| GET `/api/conversations`                        | Até 50 conversas, participantes, última mensagem e não lidas                           |
| POST `/api/conversations/direct`                | `{userId}`; mesma conversa para o par, em ambas as direções                            |
| POST `/api/conversations/groups`                | `{title,memberIds}`; 2–49 convidados além do criador                                   |
| GET `/api/conversations/:id/messages`           | `limit` 1–100, `before` ou `after` exclusivo, nunca ambos                              |
| POST `/api/conversations/:id/read`              | `{sequence}`; cursor de leitura monotônico, limitado ao histórico existente            |
| POST `/api/conversations/:id/members`           | `{userId}`; proprietário adiciona ao grupo                                             |
| DELETE `/api/conversations/:id/members/:userId` | Proprietário remove outro participante                                                 |

Login/cadastro exigem Origin correspondente a `APP_ORIGIN`. As demais mutações também exigem cookie de sessão e header `X-CSRF-Token`. Não há autenticação por query string ou token de longa duração em localStorage.

Exemplo de cadastro em PowerShell, preservando cookie sem imprimir senha real no README:

```powershell
$senha = Read-Host 'Senha de teste (mínimo 12 caracteres)'
$body = @{ displayName='Seu nome'; handle='seu_usuario'; email='voce@example.com'; password=$senha } | ConvertTo-Json
$session = Invoke-RestMethod -Method Post -Uri 'http://localhost:3100/api/auth/register' -Headers @{Origin='http://localhost:3100'} -ContentType 'application/json' -Body $body -SessionVariable chatCookies
Invoke-RestMethod -Uri 'http://localhost:3100/api/conversations' -WebSession $chatCookies
```

Para uma mutação posterior, use `-Headers @{Origin='http://localhost:3100';'X-CSRF-Token'=$session.csrfToken}` junto de `-WebSession $chatCookies`. Em ambiente compartilhado, evite registrar senhas no histórico do terminal; prefira o formulário da aplicação.

## Socket.IO

Conectar à mesma origem, transporte `websocket`, cookie automático do browser e `auth: {csrfToken}`. O token de sessão permanece HttpOnly. Um proxy deve encaminhar `/socket.io/` com HTTP Upgrade.

| Evento                 | Direção                          | Payload / efeito                                                          |
| ---------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| `message:send`         | Cliente → servidor, com ack      | `{conversationId,clientId,body}`; body até 4.000 caracteres               |
| ack                    | Servidor → remetente             | `{ok:true,data:Message}` após commit ou `{ok:false,error:{code,message}}` |
| `message:new`          | Servidor → participantes         | Mensagem persistida com ID, sequência string, autor público, data e texto |
| `typing:start`         | Cliente → servidor               | `{conversationId}`; só participantes, limitado por usuário                |
| `typing:changed`       | Servidor → outros participantes  | Conversa e autor público; indicador temporário                            |
| `presence:changed`     | Servidor → usuários autenticados | `{userId,online}`; complementar com snapshot/lease                        |
| `conversation:changed` | Servidor → usuários afetados     | `{conversationId}`; recarregar a lista autorizada                         |

Não há confirmação de leitura por destinatário na UI: o check no envio significa mensagem salva, não que todos leram. Em falha de confirmação, reenviar com o mesmo `clientId`; o servidor rejeita o mesmo ID com conteúdo diferente. Não há socket de convidado.
