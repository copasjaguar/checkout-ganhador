// /api/y.js — UM ENDPOINT PRA TUDO (status + dados do cliente)
export const config = { api: { bodyParser: false } };

// ===== Helpers Upstash (REST path-style) =====
function U() {
  const base = process.env.UPSTASH_REDIS_REST_URL;            // ex: https://rich-macaw-11847.upstash.io
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;         // ex: AS5H...
  return { base, h: { Authorization: `Bearer ${token}` } };
}

async function upstashPath(path) {
  const { base, h } = U();
  try {
    const r = await fetch(`${base}/${path}`, { method: 'POST', headers: h });
    const text = await r.text();
    try { return JSON.parse(text); } catch { return { raw: text }; }
  } catch (e) {
    return { error: String(e) };
  }
}

// ===== Handler principal =====
export default async function handler(req, res) {
  // ---------- CORS (permite chamada a partir da Yampi) ----------
  res.setHeader('Access-Control-Allow-Origin', 'https://seguro.ganhador-viva.site'); // use '*' só em teste
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Yampi-Hmac-SHA256');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ---------- UTILITÁRIOS (GET) ----------
  if (req.method === 'GET') {
    const op = (req.query.op || '').toString();
    const order = (req.query.order || '').toString().trim();

    // /api/y?op=selfcheck  -> escreve/lê yampi:last
    if (op === 'selfcheck') {
      const val = encodeURIComponent(JSON.stringify({ ok: true, ts: Date.now() }));
      const write = await upstashPath(`setex/yampi:last/600/${val}`);
      const read  = await upstashPath('get/yampi:last');
      return res.status(200).json({ write, read });
    }

    // /api/y?op=set&order=123  -> marca pago manualmente (debug)
    if (op === 'set') {
      if (!order) return res.status(400).json({ ok: false, error: 'missing order' });
      const k = encodeURIComponent('order:' + order);
      const w1 = await upstashPath(`set/${k}/paid`);
      const w2 = await upstashPath(`expire/${k}/86400`);
      return res.status(200).json({ ok: !w1.error && !w2.error, write: { w1, w2 }, order });
    }

    // /api/y?op=get&order=123  -> lê a chave bruta
    if (op === 'get') {
      if (!order) return res.status(400).json({ error: 'missing order' });
      const r = await upstashPath(`get/${encodeURIComponent('order:'+order)}`);
      return res.status(200).json({ order, raw: r, value: r?.result ?? null });
    }

    // /api/y?op=status&order=123  -> endpoint usado pelo front/script
    if (op === 'status') {
      if (!order) return res.status(200).json({ status: 'pending' });
      const r = await upstashPath(`get/${encodeURIComponent('order:'+order)}`);
      const value = r?.result ?? null;
      return res.status(200).json({ status: value === 'paid' ? 'paid' : 'pending' });
    }

    // /api/y?op=info&order=123  -> retorna dados do cliente/itens (somente se pago)
    if (op === 'info') {
      if (!order) return res.status(400).json({ error: 'missing order' });
      const paid = await upstashPath(`get/${encodeURIComponent('order:'+order)}`);
      if (paid?.result !== 'paid') {
        return res.status(403).json({ paid: false, error: 'not paid' });
      }
      const info = await upstashPath(`get/${encodeURIComponent('info:'+order)}`);
      let data = null;
      try { data = info?.result ? JSON.parse(info.result) : null; } catch {}
      return res.status(200).json({ paid: true, data });
    }

    // /api/y?op=last  -> último evento salvo (debug)
    if (op === 'last') {
      const last = await upstashPath('get/yampi:last');
      let parsed = null;
      try { parsed = last?.result ? JSON.parse(last.result) : null; } catch {}
      return res.status(200).json({ last_event: parsed });
    }

    // /api/y?op=diag -> checa envs e teste de escrita (diagnóstico)
    if (op === 'diag') {
      const { base } = U();
      const hasUrl = !!base;
      const hasToken = !!process.env.UPSTASH_REDIS_REST_TOKEN;
      const test = await upstashPath(`setex/yampi:diag/60/${encodeURIComponent('ok')}`);
      return res.status(200).json({ hasUrl, hasToken, test });
    }

    // help
    return res.status(200).send(
`y ok
GET  /api/y?op=selfcheck
GET  /api/y?op=set&order=123
GET  /api/y?op=get&order=123
GET  /api/y?op=status&order=123
GET  /api/y?op=info&order=123   (nome/email/telefone/itens se pago)
GET  /api/y?op=last
GET  /api/y?op=diag
POST /api/y   (webhook Yampi)`
    );
  }

  // ---------- WEBHOOK (POST) ----------
  if (req.method !== 'POST') return res.status(405).end();

  // Corpo bruto (necessário p/ HMAC)
  const raw = await new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

  // Validação HMAC (se houver segredo definido)
  const secret = process.env.YAMPI_WEBHOOK_SECRET || '';
  if (secret) {
    const signature = req.headers['x-yampi-hmac-sha256'] || '';
    const crypto = await import('node:crypto');
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('base64');

    let ok = false;
    try {
      const a = Buffer.from(signature, 'utf8');
      const b = Buffer.from(expected, 'utf8');
      ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { ok = false; }

    // snapshot (mesmo se inválido) — útil pra debug
    const snap = encodeURIComponent(JSON.stringify({
      sigOk: ok, sigHeaderPresent: !!signature, t: new Date().toISOString()
    }));
    await upstashPath(`setex/yampi:last/600/${snap}`);

    if (!ok) return res.status(401).send('invalid signature');
  }

  // Parse do payload
  let body = {};
  try { body = JSON.parse(raw.toString('utf8')); } catch {}

  const event       = body?.event ?? null;
  const resource    = body?.resource || {};
  const orderId     = resource?.id ?? null;
  const orderNumber = resource?.number ?? null;
  const statusAlias = resource?.status?.data?.alias ?? null;

  // ===== Extrai dados do cliente e itens (se vierem) =====
  const cust = resource?.customer?.data || {};
  const name = (cust?.name || `${cust?.first_name ?? ''} ${cust?.last_name ?? ''}`.trim()) || null;
  const email = cust?.email || null;
  const phone = cust?.phone?.formated_number || cust?.phone?.full_number || null;

  const itemsRaw = Array.isArray(resource?.items?.data) ? resource.items.data : [];
  const items = itemsRaw.map((it) => ({
    id: it?.id ?? null,
    sku: it?.sku?.data?.sku ?? null,
    title: it?.sku?.data?.title ?? null,
    quantity: it?.quantity ?? null,
    price: it?.price ?? null
  }));

  const infoPayload = {
    orderId, orderNumber,
    name, email, phone, items
  };

  // salva visor completo (10 min)
  const visor = encodeURIComponent(JSON.stringify({
    event, orderId, orderNumber, statusAlias, t: new Date().toISOString()
  }));
  await upstashPath(`setex/yampi:last/600/${visor}`);

  // TTL para chaves (24h)
  const ttl = 60 * 60 * 24;

  // Sempre salvar info:<id>/<number> (se existir), indep. do status
  async function saveInfoFor(key) {
    const kInfo = encodeURIComponent('info:' + key);
    const payload = encodeURIComponent(JSON.stringify(infoPayload));
    await upstashPath(`setex/${kInfo}/${ttl}/${payload}`);
  }
  if (orderId)     await saveInfoFor(orderId);
  if (orderNumber) await saveInfoFor(orderNumber);

  // pago?
  const isPaid =
    event === 'order.paid' ||
    (event === 'order.status.updated' && statusAlias === 'paid');

  if (isPaid && (orderId || orderNumber)) {
    if (orderId) {
      const k = encodeURIComponent('order:' + orderId);
      await upstashPath(`set/${k}/paid`);
      await upstashPath(`expire/${k}/${ttl}`);
    }
    if (orderNumber) {
      const k2 = encodeURIComponent('order:' + orderNumber);
      await upstashPath(`set/${k2}/paid`);
      await upstashPath(`expire/${k2}/${ttl}`);
    }
  }

  return res.status(200).send('ok');
}
