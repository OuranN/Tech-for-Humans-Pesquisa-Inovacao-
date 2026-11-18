const express = require('express');
const { consultar } = require('./db');

const rotas = express.Router();

const STATUS_VALIDOS = ['pago', 'entregue', 'cancelado', 'pendente'];
const TAMANHO_PAGINA = 20;
const MAX_DIAS_RELATORIO = 31;

const TTL_TOTAL_MS = 60000;
const cacheTotal = new Map();


function totalPorStatus(status) {
  const entrada = cacheTotal.get(status);
  if (entrada && entrada.valor !== undefined && entrada.expira > Date.now()) {
    return Promise.resolve(entrada.valor);
  }
  if (entrada && entrada.promessa) return entrada.promessa;


  const promessa = consultar('SELECT count(*) AS total FROM pedidos WHERE status = $1', [status])
    .then(([linha]) => {
      const valor = Number(linha.total);
      cacheTotal.set(status, { valor, expira: Date.now() + TTL_TOTAL_MS });
      return valor;
    })
    .catch((erro) => {
      cacheTotal.delete(status);
      throw erro;
    });


  cacheTotal.set(status, { ...(entrada || {}), promessa });
  return promessa;
}


function inteiroPositivo(valor) {
  if (typeof valor !== 'string' || !/^\d+$/.test(valor)) return null;
  const numero = Number(valor);
  return numero > 0 && Number.isSafeInteger(numero) ? numero : null;
}

function dataValida(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const data = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor ? data : null;
}

function assincrono(manipulador) {
  return (req, res, next) => manipulador(req, res).catch(next);
}

function formatarCliente(linha) {
  return {
    id: linha.id,
    nome: linha.nome,
    email: linha.email,
    cidade: linha.cidade,
    criado_em: linha.criado_em,
  };
}

rotas.get('/saude', (req, res) => {
  res.json({ status: 'ok' });
});

rotas.get('/clientes', assincrono(async (req, res) => {
  const email = req.query.email;
  if (typeof email !== 'string' || email.trim() === '') {
    return res.status(400).json({ erro: 'informe o parametro email' });
  }

  const linhas = await consultar(
    'SELECT * FROM clientes WHERE lower(email) = lower($1) ORDER BY id',
    [email.trim()],
  );
  res.json(linhas.map(formatarCliente));
}));

rotas.get('/clientes/:id', assincrono(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (id === null) return res.status(400).json({ erro: 'id invalido' });

  const linhas = await consultar('SELECT * FROM clientes WHERE id = $1', [id]);
  if (linhas.length === 0) return res.status(404).json({ erro: 'cliente nao encontrado' });
  res.json(formatarCliente(linhas[0]));
}));

rotas.get('/clientes/:id/pedidos', assincrono(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  

  if (id === null) {
    return res.status(400).json({ erro: 'id invalido' });
  }


  const clientes = await consultar(
    'SELECT id FROM clientes WHERE id = $1',
    [id],
  );


  if (clientes.length === 0) {
    return res.status(404).json({
      erro: 'cliente nao encontrado',
    });
  }


  // Buscar pedidos, itens e produtos em uma única consulta
  const linhas = await consultar(
    `
      SELECT
        p.id AS pedido_id,
        p.status,
        p.criado_em,
        ip.id AS item_id,
        ip.produto_id,
        pr.nome AS produto_nome,
        ip.quantidade,
        ip.preco_unitario_centavos
      FROM pedidos p
      INNER JOIN itens_pedido ip
        ON ip.pedido_id = p.id
      INNER JOIN produtos pr
        ON pr.id = ip.produto_id
      WHERE p.cliente_id = $1
      ORDER BY
        p.criado_em DESC,
        p.id DESC,
        ip.id ASC
    `,
    [id],
  );


  // 3. Agrupa os itens por pedido
  const pedidosMap = new Map();


  for (const linha of linhas) {
    if (!pedidosMap.has(linha.pedido_id)) {
      pedidosMap.set(linha.pedido_id, {
        id: linha.pedido_id,
        status: linha.status,
        criado_em: linha.criado_em,
        total_centavos: 0,
        itens: [],
      });
    }

    const pedido = pedidosMap.get(linha.pedido_id);

    pedido.itens.push({
      produto_id: linha.produto_id,
      produto_nome: linha.produto_nome,
      quantidade: linha.quantidade,
      preco_unitario_centavos: linha.preco_unitario_centavos,
    });


    pedido.total_centavos +=
      linha.quantidade * linha.preco_unitario_centavos;
  }
  const resposta = Array.from(pedidosMap.values());

  res.json(resposta);
}));

rotas.get('/pedidos', assincrono(async (req, res) => {
  const status = req.query.status;
  if (!STATUS_VALIDOS.includes(status)) {
    return res.status(400).json({ erro: `status deve ser um de: ${STATUS_VALIDOS.join(', ')}` });
  }

  const pagina = req.query.pagina === undefined ? 1 : inteiroPositivo(req.query.pagina);
  if (pagina === null) return res.status(400).json({ erro: 'pagina invalida' });

    const [total, linhas] = await Promise.all([
  totalPorStatus(status),
  consultar(
    `SELECT id, cliente_id, status, criado_em
       FROM pedidos
      WHERE status = $1
      ORDER BY criado_em DESC, id DESC
      LIMIT $2 OFFSET $3`,
    [status, TAMANHO_PAGINA, (pagina - 1) * TAMANHO_PAGINA],
  ),
]);


  res.json({
    pagina,
    tamanho_pagina: TAMANHO_PAGINA,
    total,
    pedidos: linhas.map((linha) => ({
      id: linha.id,
      cliente_id: linha.cliente_id,
      status: linha.status,
      criado_em: linha.criado_em,
    })),
  });
}));

rotas.get('/produtos/busca', assincrono(async (req, res) => {
  const termo = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (termo.length < 3) return res.status(400).json({ erro: 'o termo de busca precisa ter pelo menos 3 caracteres' });

  const linhas = await consultar(
    "SELECT * FROM produtos WHERE nome ILIKE '%' || $1 || '%' ORDER BY nome, id LIMIT 20",
    [termo],
  );
  res.json(linhas.map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    categoria: linha.categoria,
    preco_centavos: linha.preco_centavos,
  })));
}));

rotas.get('/relatorios/vendas-por-dia', assincrono(async (req, res) => {
  const inicio = dataValida(req.query.inicio);
  const fim = dataValida(req.query.fim);
  if (inicio === null || fim === null) {
    return res.status(400).json({ erro: 'informe inicio e fim no formato AAAA-MM-DD' });
  }
  const dias = (fim - inicio) / 86400000 + 1;
  if (dias < 1 || dias > MAX_DIAS_RELATORIO) {
    return res.status(400).json({ erro: `o periodo deve ter entre 1 e ${MAX_DIAS_RELATORIO} dias` });
  }

  const linhas = await consultar(
  `SELECT to_char(dia, 'YYYY-MM-DD') AS dia, pedidos, itens, receita_centavos
     FROM mv_vendas_por_dia
    WHERE dia BETWEEN $1::date AND $2::date
    ORDER BY dia`,
  [req.query.inicio, req.query.fim],
);


res.json(linhas.map((linha) => ({
  dia: linha.dia,
  pedidos: Number(linha.pedidos),
  itens: Number(linha.itens),
  receita_centavos: Number(linha.receita_centavos),
})));

}));

rotas.get('/relatorios/top-produtos', assincrono(async (req, res) => {
  const limite = req.query.limite === undefined ? 10 : inteiroPositivo(req.query.limite);
  if (limite === null || limite > 50) return res.status(400).json({ erro: 'limite deve ser um inteiro entre 1 e 50' });

  const linhas = await consultar(
 `SELECT id, nome, categoria, unidades, receita_centavos
         FROM mv_top_produtos
        ORDER BY receita_centavos DESC, id
        LIMIT $1`,
    [limite],
  );

  res.json(linhas.map((linha) => ({
    produto_id: linha.id,
    nome: linha.nome,
    categoria: linha.categoria,
    unidades: Number(linha.unidades),
    receita_centavos: Number(linha.receita_centavos),
  })));
}));

module.exports = rotas;