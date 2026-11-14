 -- Busca de clientes por email
CREATE INDEX idx_clientes_lower_email ON clientes (lower(email));

-- Pedidos de um cliente
CREATE INDEX idx_pedidos_cliente_id ON pedidos (cliente_id, criado_em DESC, id DESC);

-- Pedidos por status com paginação
CREATE INDEX idx_pedidos_status_criado_em ON pedidos (status, criado_em DESC, id DESC);

--  Itens de um pedido
CREATE INDEX idx_itens_pedido_pedido_id ON itens_pedido (pedido_id, id);

--  Itens por produto
CREATE INDEX idx_itens_pedido_produto_id ON itens_pedido (produto_id);

--  Busca textual de produtos
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_produtos_nome_trgm ON produtos USING gin (nome gin_trgm_ops);