-- Criação da visão materializada com os dados pré-agregados
CREATE MATERIALIZED VIEW mv_top_produtos AS
SELECT pr.id, pr.nome, pr.categoria,
        sum(i.quantidade) AS unidades,
        sum(i.quantidade * i.preco_unitario_centavos) AS receita_centavos
  FROM itens_pedido i
  JOIN pedidos p ON p.id = i.pedido_id
  JOIN produtos pr ON pr.id = i.produto_id
  WHERE p.status <> 'cancelado'
  GROUP BY pr.id, pr.nome, pr.categoria
  ORDER BY receita_centavos DESC, pr.id;

-- Índice para entrega 
CREATE INDEX idx_mv_top_produtos_ranking ON mv_top_produtos (receita_centavos DESC, id);

CREATE MATERIALIZED VIEW mv_vendas_por_dia AS
SELECT p.criado_em::date AS dia,
       count(DISTINCT p.id) AS pedidos,
       sum(i.quantidade) AS itens,
       sum(i.quantidade * i.preco_unitario_centavos) AS receita_centavos
  FROM pedidos p
  JOIN itens_pedido i ON i.pedido_id = p.id
 WHERE p.status <> 'cancelado'
 GROUP BY 1;


CREATE UNIQUE INDEX idx_mv_vendas_por_dia ON mv_vendas_por_dia (dia);
