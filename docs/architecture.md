# Decisões de arquitetura

## Por que Node.js e Socket.IO

O trabalho principal é manter conexões e aguardar I/O de mensagens, banco e Redis. Node.js com TypeScript permite compartilhar contratos com React e oferece um ecossistema direto para esse fluxo. Express 5 mantém a API pequena; Socket.IO oferece eventos, acknowledgements, reconexão e adaptadores. Não é uma afirmação de que outra linguagem não serviria: esta escolha atende o objetivo de explorar uma stack diferente de Java.

## Persistir antes de confirmar

O cliente gera `clientId` UUID. Em uma transação o servidor bloqueia a conversa, verifica participação, insere a mensagem e registra uma entrada na outbox. Só depois do commit devolve o ack. A restrição `(sender_id,client_id)` evita duplicação e uma chave já utilizada com outro corpo/conversa produz conflito. Um advisory lock serializa tentativas concorrentes do mesmo identificador, inclusive entre conversas.

`seq` é um BIGINT global usado como cursor, serializado em string para não perder precisão no JavaScript. O bloqueio da conversa serializa gravações dentro dela. A UI ordena os eventos por sequência, porque eventos de diferentes processos podem chegar em ordens diferentes. Ordenação de chegada não é a autoridade do histórico.

A outbox é processada em lotes com `FOR UPDATE SKIP LOCKED`, permitindo vários workers dentro dos processos de API. Crash entre emissão e marcação pode repetir um evento; o cliente deduplica pelo ID persistido. `published_at` registra tentativa de publicação, não prova entrega a todos os destinatários. Redis Pub/Sub não persiste eventos para navegadores desconectados.

## Recuperação sem prometer exactly once

Socket.IO oferece entrega padrão at-most-once. Usamos ack após commit, identificador idempotente, histórico por cursor e reconciliação HTTP para recuperar o estado. O adapter Redis comum não implementa connection-state recovery: não ativamos nem anunciamos essa funcionalidade.

O navegador mantém um cursor de sincronização HTTP separado da última mensagem recebida ao vivo. Eventos posteriores não avançam esse cursor: isso permite encontrar lacunas em uma reconciliação posterior. A cada seis segundos e na reconexão, o cliente consulta os próximos registros persistidos em páginas limitadas. Uma atualização da página abre o histórico recente, com paginação para mensagens anteriores. Pendências de envio são mantidas só em memória; não há garantia de preservar rascunhos/reenvios após fechar ou atualizar a aba.

## Presença é uma aproximação

Cada conexão tem identificador próprio em sorted set Redis com lease de 45 segundos e heartbeat de 15 segundos. Fechar uma aba remove só aquela conexão; o usuário continua online se outra lease estiver ativa. Chaves expiram para evitar crescimento indefinido. Um crash pode manter presença antiga por até o prazo da lease; snapshots HTTP a cada 20 segundos atualizam a UI. Não há promessa de detecção instantânea de queda.

Quando Redis falha, a UI não deve tratar a ausência de confirmação como uma prova de offline. A consulta de presença falha ou fica desconhecida. Limites de segurança dependem de Redis e operações protegidas recusam requests durante indisponibilidade: optamos por falhar fechado, preservando mensagens já salvas no banco.

## Autorização e revogação

Sockets entram apenas em salas de usuário e sessão, definidas pelo servidor. Não existe evento que aceite qualquer nome de sala enviado pelo cliente. Cada leitura, envio, digitação e alteração de participantes verifica a participação no banco. Eventos de mensagens vão apenas aos usuários membros consultados pelo servidor. O proprietário gerencia o grupo; um membro comum não promove a si mesmo nem remove outros.

Sessões são verificadas no handshake e em cada pacote. O cookie não é exposto ao JavaScript; o token CSRF é um segredo separado da sessão, entregue por uma leitura autenticada same-origin e guardado em memória no frontend. Origem é validada mesmo para conexões WebSocket, que não ficam protegidas apenas por CORS.

## Performance e limites

Pool PostgreSQL de oito conexões por processo, índices por conversa/sequência, cursores e tamanhos máximos de resposta. A listagem de conversas faz uma consulta SQL com agregados/subconsultas indexadas, evitando uma ida ao banco por conversa. O hash Argon2 é concorrente até duas operações por processo, sem fila ilimitada. Os limites de tentativas/mensagens são compartilhados via Redis.

Essas escolhas limitam recursos, mas não são um benchmark ou SLA. Com muitas réplicas, o tamanho total dos pools e a capacidade Redis/PostgreSQL precisam ser medidos. Para volumes maiores, considerar armazenamento de agregados de não lidas, worker de outbox separado, índices baseados no plano real e virtualização mais ampla da lista. Não adicionar Kafka ou microserviços para uma demonstração sem essa necessidade.

Fontes: [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/), [Redis adapter](https://socket.io/docs/v4/redis-adapter/), [OWASP WebSocket Security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html).
