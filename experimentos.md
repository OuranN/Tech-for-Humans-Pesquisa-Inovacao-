# Tabela de Experimentos

Cada linha representa uma ideia aplicada ou pesquisada. Atualizar após cada medição.

| # | Ideia | Hipótese | Fonte | Status | Mediana antes | Mediana depois | Variação | Pastas de resultados | Conclusão |
|---|---|---|---|---|---|---|---|---|---|
| 00 | Linha de base (sem mudanças) | — | — | ✅ Concluída | 900.2 ms | 900.2 ms | — | `resultados/20261108-17*-00-linha-de-base/` | Referência para comparação |
| 01 | Connection pool com `pg.Pool` para eliminação de handshakes repetidos | Substituir `pg.Client` por `pg.Pool` em `api/src/db.js` deve aumentar o throughput geral (req/s) e reduzir o tempo de resposta, porque elimina o overhead de handshake e autenticação (20–30 ms) a cada consulta individual. | [node-postgres pooling](https://node-postgres.com/features/pooling) <br> <br> [prisma.io connection-pooling](https://www.prisma.io/dataguide/database-tools/connection-pooling) | ✅ Concluída | 900.2 ms | 698.4 ms | -22,4% latência, +20,4% req/s, -40,1% latencia para 95% das solicitações, -35.1% para 99% das solicitações | `resultados/20261110-15*-01-connection-pool/` | Redução da latência média das requisições e aumento da taxa de processamento. Também foram observadas melhorias significativas nos percentis de latência. Os resultados demonstram que o reaproveitamento de conexões com o banco de dados eliminou a necessidade de estabelecer novos handshakes a cada requisição, tornando a comunicação mais eficiente, reduzindo o tempo de resposta e melhorando a estabilidade sob carga. Além disso, houve uma redução de mais de 50% na memória média da API, pois o Node.js não precisa mais instanciar e descartar dezenas de objetos Client, sockets TCP e buffers por segundo. |
<br>
> **Legenda de status:**
> - ✅ Concluída — medida e commitada
> - 🔲 Pendente — ainda não aplicada
> - 🔍 Pesquisada, teste futuro — detalhes em `proximos-testes.md`
> - ❌ Descartada — não aplicada (motivo na coluna Conclusão)
