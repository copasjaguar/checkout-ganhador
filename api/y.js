// /api/y.js  — UM ENDPOINT PRA TUDO
export const config = { api: { bodyParser: false } };

function U() {
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return { base, h: { Authorization: `Bearer ${token}` } };
}

async function upstashPath(path) {
  const { base, h } = U();
  const r = await fetch(`${base}/${path}`, { method: 'POST', headers: h });
  return r.json();
}

export default async function handler(req, res) {
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

    // /api/y?op=set&order=123  -> marca pago manualmente
    if (op === 'set') {
      if (!order) return res.status(400).json({ ok: false, error: 'missing order' });
      await upstashPath(`set/${encodeURIComponent('order:'+order)}/paid`);
      await upstashPath(`expire/${encodeURIComponent('order:'+order)}/86400`);
      return res.status(200).json({ ok: true, order });
    }

    // /api/y?op=get&order=123  -> lê a chave bruta
    if (op === 'get') {
      if (!order) return res.status(400).json({ error: 'missing order' });
      const r = await upstashPath(`get/${encodeURIComponent('order:'+order)}`);
      return res.status(200).json({ order, raw: r, value: r?.result ?? null });
    }

    // /api/y?op=status&order=123  -> seu endpoint final de status
    if (op === 'status') {
      if (!order) return res.status(200).json({ status: 'pending' });
      const r = await upstashPath(`get/${encodeURIComponent('order:'+order)}`);
      const value = r?.result ?? null;
      return res.status(200).json({ status: value === 'paid' ? 'paid' : 'pending' });
    }

    // /api/y?op=last  -> ultimo evento salvo (debug)
    if (op === 'last') {
      const last = await upstashPath('get/yampi:last');
      return res.status(200).json({ last_event: last?.result ? JSON.parse(last.result) : null });
    }

    // help
    return res
      .status(200)
      .send(
`y ok
GET  /api/y?op=selfcheck
GET  /api/y?op=set&order=123
GET  /api/y?op=get&order=123
GET  /api/y?op=status&order=123
GET  /api/y?op=last
POST /api/y   (webhook Yampi)`
      );
  }

  // ---------- WEBHOOK (POST) ----------
  if (req.method !== 'POST') return res.status(405).end();

  // Lê corpo bruto (necessário p/ HMAC)
  const raw = await new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

  // Valida HMAC se houver segredo definido
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
    } catch {}
    // salva visor do que chegou (mesmo se inválido)
    try {
      const snap = encodeURIComponent(JSON.stringify({
        sigOk: ok, sigHeaderPresent: !!signature, t: new Date().toISOString()
      }));
      await upstashPath(`setex/yampi:last/600/${snap}`);
    } catch {}
    if (!ok) return res.status(401).send('invalid signature');
  }

  // Parse do payload
  let body = {};
  try { body = JSON.parse(raw.toString('utf8')); } catch {}

  const event       = body?.event ?? null;
  const order       = body?.resource || {};
  const orderId     = order?.id ?? null;
  const orderNumber = order?.number ?? null;
  const statusAlias = order?.status?.data?.alias ?? null;

  // salva visor completo (10 min)
  try {
    const val = encodeURIComponent(JSON.stringify({
      event, orderId, orderNumber, statusAlias, t: new Date().toISOString()
    }));
    await upstashPath(`setex/yampi:last/600/${val}`);
  } catch {}

  // se for pago, grava ID e Number
  const isPaid =
    event === 'order.paid' ||
    (event === 'order.status.updated' && statusAlias === 'paid');

  if (isPaid && (orderId || orderNumber)) {
    if (orderId) {
      await upstashPath(`set/${encodeURIComponent('order:'+orderId)}/paid`);
      await upstashPath(`expire/${encodeURIComponent('order:'+orderId)}/86400`);
    }
    if (orderNumber) {
      await upstashPath(`set/${encodeURIComponent('order:'+orderNumber)}/paid`);
      await upstashPath(`expire/${encodeURIComponent('order:'+orderNumber)}/86400`);
    }
  }

  return res.status(200).send('ok');
}
