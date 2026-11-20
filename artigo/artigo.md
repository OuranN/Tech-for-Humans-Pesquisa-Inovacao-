# Otimização de API Node.js e PostgreSQL: de 2,75 req/s para 366 req/s eliminando gargalos de I/O, varreduras e agregações repetitivas

## 1. Resumo
Uma API de comércio eletrônico desenvolvida em Node.js e PostgreSQL apresentava desempenho crítico sob carga de 20 usuários concorrentes: apenas 2,75 req/s, p95 de 29,5 segundos e CPU saturada. Em seis ciclos de otimização orientados por hipóteses e medições, foram eliminados handshakes repetitivos, criados índices estratégicos, implementadas visões materializadas, corrigido o antipadrão N+1 e introduzido cache em memória com single-flight. Como resultado, a vazão aumentou aproximadamente 133 vezes, alcançando 366,27 req/s, enquanto o p95 caiu 99,63%, chegando a 107 ms, sem alterações no contrato HTTP.

## 2. Contexto e diagnóstico
A API oferece consultas de clientes e pedidos, buscas de produtos e relatórios de vendas. Sob 20 usuários concorrentes, /relatorios/top-produtos superava 17 segundos de mediana, /pedidos ultrapassava 7 segundos e /clientes/:id/pedidos excedia 20 segundos. A análise de db.js e rotas.js identificou conexões repetitivas e consultas sequenciais em loops.

Hipótese de causa:
* Conexões efêmeras: criação de pg.Client a cada requisição, repetindo conexões TCP e autenticações.
* Ausência de índices: varreduras sequenciais em tabelas com milhões de registros.
* Agregações repetitivas: execução de JOIN, agrupamento e ordenação sobre 1,5 milhão de linhas a cada consulta analítica.
* Antipadrão N+1: consultas sequenciais em loops para recuperar pedidos, itens e produtos.
* Contagem recorrente: execução de COUNT(*) sobre pedidos a cada listagem paginada.

## 3. Estado da arte
### Gerenciamento de conexões e pooling
Connection pooling mantém conexões abertas para reutilização, evitando o custo de estabelecer novas conexões a cada consulta. A documentação do PostgreSQL destaca o consumo de recursos associado às conexões simultâneas, enquanto o node-postgres apresenta pools como estratégia de gerenciamento e reutilização dessas conexões.

### Indexação especializada e estruturas relacionais
Índices reduzem a necessidade de varreduras completas nas tabelas. O PostgreSQL documenta estruturas B-tree para buscas, comparações e ordenações, além de índices de expressão para consultas que utilizam funções sobre colunas. Para buscas textuais parciais, a extensão pg_trgm oferece índices GIN e GiST (PostgreSQL Global Development Group).

### Pré-computação analítica com visões materializadas
Visões materializadas armazenam resultados de consultas para reutilização, reduzindo o processamento de agregações e junções recorrentes. Gupta e Mumick (1995) discutem técnicas e desafios de manutenção dessas estruturas. AWS e Databricks também apresentam sua aplicação na otimização de consultas analíticas. Entretanto, sua utilização exige atualizações para refletir alterações nos dados de origem.

### Eliminação de consultas em cascata e padrão Single-Flight
O thundering herd ocorre quando requisições concorrentes executam simultaneamente a mesma operação, aumentando a pressão sobre os recursos do sistema (Tessier, 2026). O padrão single-flight evita duplicidade ao compartilhar uma operação em andamento entre chamadas com a mesma chave. Já Promise.all() permite executar operações assíncronas independentes concorrentemente, reduzindo esperas sequenciais (Mozilla Developer Network).

## 4. Alternativas consideradas
| Alternativa | Custo | Desempenho | Risco | Esforço |
|---|---|---|---|---|
| A. Verticalização de hardware (aumento de CPU/RAM) | Alto  | Baixo a Médio | Baixo | Mínimo |
| B. Cache externo distribuído com Redis | Médio | Muito Alto | Médio | Médio |
| C. Otimização combinada de banco e aplicação (Pool + Índices + MVs + Single-flight) | Mínimo | Alto | Baixo | Médio |

## 5. Solução escolhida e por quê
A verticalização foi descartada por não resolver as ineficiências da aplicação, e o Redis, por adicionar complexidade à infraestrutura. Optou-se pela alternativa C, utilizando recursos nativos do PostgreSQL e Node.js.

A implementação envolveu cinco etapas:
1. Conexões: substituição de pg.Client por pg.Pool.
2. Índices: criação de estruturas B-tree, composta, de expressão e trigram.
3. Análise: criação das visões materializadas mv_top_produtos e mv_vendas_por_dia.
4. Consultas: substituição de N+1 por um único JOIN.
5. Concorrência: cache com TTL, single-flight e Promise.all() em /pedidos.

A estratégia preservou o contrato HTTP e não exigiu novos serviços na infraestrutura.

## 6. Experimento e resultado
| Mudança | Hipótese | p95 antes → depois | req/s antes → depois | CPU/memória | Pastas de resultados | Conclusão |
|---|---|---|---|---|---|---|
| 01-connection-pool | Substituir pg.Client por pg.Pool em api/src/db.js deve aumentar o throughput geral (req/s) e reduzir o tempo de resposta, porque elimina o overhead de handshake e autenticação (20–30 ms) a cada consulta individual. | 29.511 ms → 17.665,1 ms | 2,75 → 3,31 | Banco: 77,5% CPU / 399 MiB<br>API: 5,3% CPU / 31,7 MiB | `resultados/20261110-15*-01-connection-pool/` | O pool eliminou handshakes repetitivos e reduziu em mais de 50% a memória média da API, devido ao reaproveitamento de conexões e sockets TCP. |
| 02-indices | Criar índices B-tree nas chaves estrangeiras (cliente_id, pedido_id, produto_id), composto em pedidos(status, criado_em DESC, id DESC), expressional em clientes(lower(email)) e trigram em produtos(nome) deve reduzir a latência das rotas de pedidos e clientes, porque substitui varreduras sequenciais completas por buscas diretas por índice. | 17.665,1 ms → 8310,1 ms | 3,31 → 17,77 | Banco: 93,4% CPU / 405,4 MiB<br>API: 21,1% CPU / 122,9 MiB | `resultados/20261114-20*-02-indices/` | Os índices elevaram a vazão em 436,9% e reduziram a latência mediana global em 86,2%. Na rota /clientes/:id/pedidos, o tempo caiu de aproximadamente 15 segundos para 184 ms. |
| 03-materialized-view | Criar uma MATERIALIZED VIEW com as agregações por produto deve reduzir o processamento de 1,5 milhão de registros e acelerar a rota top-produtos. | 8.310,1 ms → 1817,5 ms | 17,77 → 43,78 | Banco: 99,1% CPU / 462,9 MiB<br>API: 38,3% CPU / 96,4 MiB | `resultados/20261115-11*-03-materialized-view/` | A visão mv_top_produtos pré-computou agregações sobre 1,5 milhão de registros de itens_pedido, reduzindo em 99,5% o tempo da rota top-produtos. vendas-por-dia também melhorou. Entretanto, o aumento da carga evidenciou o gargalo N+1 em pedidos-do-cliente, cuja mediana subiu de 184,2 para 799,6 ms, enquanto o banco atingiu 99,1% de CPU.|
| 04-Join-instead-for |Substituir as consultas N+1 por um único JOIN deve reduzir a latência de pedidos-do-cliente, eliminando consultas sequenciais ao banco. | 1.817,5 ms → 2.721,2 ms | 43,78 → 42,31 | Banco: 94,1% CPU / 448,8 MiB<br>API: 34,3% CPU / 133 MiB | `resultados/20261116-16*-04-Join-instead-for` | O JOIN reduziu a mediana de pedidos-do-cliente de 799,6 para 175,2 ms e o p95 de 1.791,7 para 481,1 ms. Apesar da melhora na rota-alvo, os percentis globais pioraram, assim como a mediana de vendas-por-dia. A hipótese é que a redistribuição da carga aumentou a disputa pela CPU do banco. A alteração foi mantida por eliminar o gargalo N+1, embora o banco continuasse sendo o principal limitador. |
| 05-materialized-view-vendas-dia | Substituir o join com agregação em JS por uma leitura de mv_vendas_por_dia deve reduzir a mediana e o p95 de vendas-por-dia e liberar CPU do banco para as demais rotas, porque o custo do join e da soma é pago uma vez no REFRESH e não a cada requisição. | 2.721,2 ms → 501,2 ms | 42,31 → 143,61 | Banco: 99,8% CPU / 438,9 MiB<br>API: 12,4% CPU / 27,1 MiB | `resultados/20261116-17*-05-materialized-view-vendas-dia` |  A mv_vendas_por_dia reduziu a mediana da rota de 3.030,6 para 6 ms e o p95 de 5.991,3 para 98,4 ms. A API passou a processar menos dados, reduzindo seu consumo de CPU e memória e beneficiando outras rotas. Mesmo com a vazão global 3,3 vezes maior, o banco permaneceu próximo da saturação (99,8% de CPU). Como limitação, os dados dependem de atualização manual da visão. |
| 06-cache-contagem-status |  A combinação de cache em memória com TTL, single-flight e Promise.all() deve reduzir consultas repetidas de COUNT(*), evitar execuções simultâneas duplicadas e paralelizar a contagem com a busca paginada. Espera-se reduzir a latência de /pedidos e aumentar a vazão global. | 501,2 ms → 107 ms | 143,61 → 366,27 | Banco: 98,8% CPU / 444,1 MiB<br>API: 24,1% CPU / 27,5 MiB | `resultados/20261118-11*-06-cache-contagem-status` | Cache com TTL, single-flight e execução paralela elevaram a vazão para 366,27 req/s e reduziram o p95 global para 107 ms. Na rota pedidos-por-status, a mediana caiu 69,87%, o p95 46,10% e o p99 62,19%. Mais de 20.400 requisições foram processadas sem erros. O banco permaneceu próximo da saturação (98,8% de CPU), e o TTL pode causar defasagem temporária na contagem durante períodos de alta escrita.|

## 7. Limites e testes futuros
A solução ainda exige avaliar três aspectos: atualização das visões materializadas sem sobrecarregar o banco; sincronização do cache entre réplicas, possivelmente com Redis; e impacto de operações de escrita na manutenção dos índices e na invalidação do cache.

## 8. Referências

1. PostgreSQL Global Development Group. *Runtime config connection*. PostgreSQL 16 Documentation. Disponível em: <https://www.postgresql.org/docs/16/runtime-config-connection.html>. Acesso em: 10 nov. 2026.

2. Brian C. *node-postgres: Pooling*. Disponível em: <https://node-postgres.com/features/pooling>. Acesso em: 10 nov. 2026.

3. PostgreSQL Global Development Group. *Indexes: B-Tree and Expressional Indexes*. PostgreSQL 16 Documentation. Disponível em: <https://www.postgresql.org/docs/16/indexes.html>. Acesso em: 14 nov. 2026.

4. PostgreSQL Global Development Group. *pg_trgm: support for similarity of text using trigram matching*. PostgreSQL 16 Documentation. Disponível em: <https://www.postgresql.org/docs/16/pgtrgm.html>. Acesso em: 14 nov. 2026.

5. Amazon Web Services (AWS). *O que é uma visão materializada?*. AWS Architecture Center. Disponível em: <https://aws.amazon.com/what-is/materialized-view>. Acesso em: 15 nov. 2026.

6. Databricks Staff. *What are Materialized Views?*. Databricks Engineering Blog. Disponível em: <https://www.databricks.com/blog/what-are-materialized-views>. Acesso em: 15 nov. 2026.

7. Gupta, Ashish; Mumick, Inderpal Singh. *Maintenance of Materialized Views: Problems, Techniques, and Applications*. Disponível em: <https://homepages.inf.ed.ac.uk/wenfei/qsx/reading/gupta95maintenance.pdf>. Acesso em: 15 nov. 2026.

8.  Tessier, James. *How to tame the thundering herd problem*. Redis Engineering Blog. Disponível em: <https://redis.io/blog/how-to-tame-the-thundering-herd-problem/>. Acesso em: 18 nov. 2026.

9. Mozilla Developer Network (MDN). *Promise.all()*. MDN Web Docs. Disponível em: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all>. Acesso em: 18 nov. 2026.

10. pawankumargali. *Single Flight: Avoiding Duplicate Work in Backend Systems*. Disponível em: <https://levelup.gitconnected.com/single-flight-avoiding-duplicate-work-in-backend-systems-158576d81c6a>. Acesso em: 18 nov. 2026.

## 9. Uso de IA
A IA apoiou a exploração de hipóteses e o diagnóstico de antipadrões. Alterações, consultas SQL e métricas foram validadas manualmente.