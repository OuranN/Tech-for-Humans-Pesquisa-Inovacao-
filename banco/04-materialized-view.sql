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