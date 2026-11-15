# Próximos Testes (Ideias Pesquisadas e Testes Futuros)

    Gargalos remanescentes identificados na medição `02-indices`:
    - `top-produtos`: mediana de **10263.6 ms** e p95 de **12759.8 ms** e p99 de **13022.8 ms**
    - `vendas-por-dia`: mediana de **7900.4 ms** e p95 de **12.519.0 ms** e p99 de **12968.5 ms **
    - `pedidos-por-status`: p95 de **11086.0 ms** e p99 de **15075.4 ms**
    ---

    ## PT-01: Cache em Memória com Redis no Docker Compose
    * **Alvo direto:** `GET /relatorios/top-produtos` (10,263s) e `GET /relatorios/vendas-por-dia` (7,9s).
    * **Hipótese:** Adicionar um container `redis` ao `docker-compose.yml` e cachear o JSON de resposta dessas duas rotas de relatório com um TTL de 60 segundos reduzirá a latência dessas rotas de ~10 segundos para menos de 5 ms, aliviando quase 100% da CPU do banco gasta em agregações pesadas.

    * **Fontes:** 
      - [Redis cache-aside](https://redis.io/docs/latest/develop/use-cases/cache-aside/?utm_source=chatgpt.com).
      - [Caching: A Dive into In-Memory and Redis Caches](https://medium.com/the-modern-scientist/caching-a-dive-into-in-memory-and-redis-caches-7b9491a1fa1b).
      

    ---

    ## PT-02: Visão Materializada com Atualização Agendada (`banco/04-materialized-view.sql`)
    * **Alvo direto:** `GET /relatorios/top-produtos` (mediana de 10263.6 ms).
    * **Hipótese:** Criar uma `MATERIALIZED VIEW` que pré-computa `sum(quantidade)` e `sum(quantidade * preco_unitario_centavos)` por produto agrupa os 1,5M registros em linhas pré-calculadas, transformando uma consulta de 10 segundos em uma leitura instantânea de índice de menos de 10 ms.
    * **Fontes:** 
      - [What are Materialized Views](https://www.databricks.com/blog/what-are-materialized-views) 
      - [O que é uma visão materializada - aws](https://aws.amazon.com/what-is/materialized-view/) 
      - [Materialized Views- Postgresql](https://www.postgresql.org/docs/current/rules-materializedviews.html)   
      - [Working with Materialized Views](https://docs.snowflake.com/en/user-guide/views-materialized)
    