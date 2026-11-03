# Validação da demonstração

Execução local em 03/11/2026: Windows, Node.js 24.22.1, Docker Desktop/engine Linux. Aplicações executadas em imagens de produção; PostgreSQL 17 e Redis 7.4 reais. O browser foi Chromium gerenciado por Playwright.

## Resultados

- Build TypeScript strict dos contratos/API e build de produção Vite/React concluídos.
- ESLint, React Hooks e formatação Prettier verificados.
- Três testes unitários: contratos rejeitam mensagem/identidade não permitida, cadastro/grupo inválidos; reconciliação deduplica ack/event/histórico e ordena sequências maiores que o limite seguro de number em JavaScript.
- Nove testes HTTP/Socket.IO com duas instâncias reais da API: rejeição de eventos não suportados, rotação de sessão, origem/CSRF, conversa privada única, entrega entre processos via Redis, idempotência, replay de mensagens após desconexão, autorização e remoção de membros, múltiplas abas, logout entre instâncias e cursor de leitura monotônico.
- Quatro cenários Playwright: cadastro/logout, conversa em navegadores independentes com presença e reload, grupo de três pessoas com remoção de participante, acessibilidade automatizada e layout móvel.
- Auditoria axe WCAG A/AA passou nos cenários de login e workspace testados; viewport móvel sem overflow horizontal. Não é uma certificação de acessibilidade nem validação completa com leitores de tela.
- Redis foi reiniciado e, depois da recuperação, as duas APIs passaram novamente no cenário de entrega entre processos. Não foi simulada toda combinação de partições de rede e crashes possíveis.
- Auditoria npm não encontrou vulnerabilidades conhecidas na execução final. Não equivale a pentest ou análise completa das imagens e do host.
- Configuração Compose de produção foi validada com hostname fictício e Caddy validou seu arquivo de configuração. Nenhum certificado público foi emitido e nenhum domínio foi publicado.

As contas de testes usam dados sintéticos em um banco local isolado. As screenshots foram feitas com contas e mensagens fictícias criadas para a demonstração, sem dados de terceiros. Testes não dependem de serviços pagos ou de um provedor de e-mail.

## Limites das evidências

São testes funcionais, de autorização e integração. Não houve ensaio de capacidade com milhares de conexões, benchmark de latência, auditoria externa de segurança ou teste de disponibilidade prolongado. Nenhum número de throughput/SLA é prometido.

O banco guarda mensagens em texto e não implementa E2EE. E-mail não é verificado, recuperação de senha/moderação não estão implementadas e mensagens pendentes do navegador não sobrevivem a refresh. Essas limitações devem ser consideradas ao abrir um servidor público de testes.
