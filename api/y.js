// /api/y.js — UM ENDPOINT PRA TUDO (com dados do cliente)
export const config = { api: { bodyParser: false } };

// ===== Helpers Upstash (REST path-style) =====
function U() {
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return { base, h: { Authorization: `Bearer ${token}` } };
}
async function upstashPath(path) {
  const { base, h } = U();
  const r = await fetch(`${base}/${path}`, { method: 'POST', headers: h });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { raw: t }; }
}

// ===== Envio para Telegram — Pagamento confirmado =====
async function sendTelegram(info) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const text = `
✅ *Pagamento confirmado!*

📦 Pedido: ${info.orderNumber || info.orderId}
👤 Nome: ${info.name || "-"}
📧 Email: ${info.email || "-"}
📞 Telefone: ${info.phone || "-"}
🪪 CPF: ${info.cpf || "-"}

*Itens:*
${(info.items || [])
  .map(it => `- ${it.title} (SKU: ${it.sku}) x${it.quantity} — R$ ${it.price}`)
  .join("\n")}
    `;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown"
      })
    });
  } catch (e) {
    console.error("Erro ao enviar Telegram:", e);
  }
}

// ===== Envio para Telegram — Carrinho abandonado =====
async function sendTelegramCart(info) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const text = `
🛒 *Carrinho abandonado*

👤 Nome: ${info.name || "-"}
📧 Email: ${info.email || "-"}
📞 Telefone: ${info.phone || "-"}
🪪 CPF: ${info.cpf || "-"}

*Itens:*
${(info.items || [])
  .map(it => `- ${it.title} (SKU: ${it.sku}) x${it.quantity} — R$ ${it.price}`)
  .join("\n")}
    `;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
    });
  } catch (e) {
    console.error("Erro ao enviar Telegram (cart.reminder):", e);
  }
}

// ===== Handler principal =====
export default async function handler(req, res) {
  // CORS (permite Yampi)
  res.setHeader('Access-Control-Allow-Origin', 'https://seguro.ganhador-viva.site');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Yampi-Hmac-SHA256');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ---------- UTILITÁRIOS (GET) ----------
  if (req.method === 'GET') {
    const op = (req.query.op || '').toString();
    const order = (req.query.order || '').toString().trim();

    if (op === 'selfcheck') {
      const val = encodeURIComponent(JSON.stringify({ ok: true, ts: Date.now() }));
      const write = await upstashPath(`setex/yampi:last/600/${val}`);
      const read  = await upstashPath('get/yampi:last');
      return res.status(200).json({ write, read });
    }

    if (op === 'set') { // marca pago manualmente (debug)
      if (!order) return res.status(400).json({ ok: false, error: 'missing order' });
      const k = encodeURIComponent('order:' + order);
      const w1 = await upstashPath(`set/${k}/paid`);
      const w2 = await upstashPath(`expire/${k}/86400`);
      return res.status(200).json({ ok: !w1.error && !w2.error, write: { w1, w2 }, order });
    }

    if (op === 'get') { // lê valor cru
      if (!order) return res.status(400).json({ error: 'missing order' });
      const r = await upstashPath(`get/${encodeURIComponent('order:'+order)}`);
      return res.status(200).json({ order, raw: r, value: r?.result ?? null });
    }

    if (op === 'status') { // endpoint que o front consulta
      if (!order) return res.status(200).json({ status: 'pending' });
      const r = await upstashPath(`get/${encodeURIComponent('order:'+order)}`);
      const value = r?.result ?? null;
      return res.status(200).json({ status: value === 'paid' ? 'paid' : 'pending' });
    }

    if (op === 'info') { // nome/email/telefone/itens — só se pago
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

    if (op === 'last') {
      const last = await upstashPath('get/yampi:last');
      let parsed = null;
      try { parsed = last?.result ? JSON.parse(last.result) : null; } catch {}
      return res.status(200).json({ last_event: parsed });
    }

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

  // RAW body (p/ HMAC)
  const raw = await new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

  // HMAC (se tiver segredo)
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
    const snap = encodeURIComponent(JSON.stringify({
      sigOk: ok, sigHeaderPresent: !!signature, t: new Date().toISOString()
    }));
    await upstashPath(`setex/yampi:last/600/${snap}`);
    if (!ok) return res.status(401).send('invalid signature');
  }

  // Parse payload
  let body = {};
  try { body = JSON.parse(raw.toString('utf8')); } catch {}

  const event       = body?.event ?? null;
  const resource    = body?.resource || {};
  const orderId     = resource?.id ?? null;
  const orderNumber = resource?.number ?? null;
  const statusAlias = resource?.status?.data?.alias ?? null;

  // ---- Extrair dados de cliente/itens ----
  const cust = resource?.customer?.data || {};
  const name  = (cust?.name || `${cust?.first_name ?? ''} ${cust?.last_name ?? ''}`.trim()) || null;
  const email = cust?.email || null;
  const phone = cust?.phone?.formated_number || cust?.phone?.full_number || null;
  const cpf   = cust?.cpf ?? null;

  const itemsRaw = Array.isArray(resource?.items?.data) ? resource.items.data : [];
  const items = itemsRaw.map(it => ({
    id: it?.id ?? null,
    sku: it?.sku?.data?.sku ?? null,
    title: it?.sku?.data?.title ?? null,
    quantity: it?.quantity ?? null,
    price: it?.price ?? null
  }));

  const infoPayload = { orderId, orderNumber, name, email, phone, cpf, items };

  // Snapshot do evento
  const visor = encodeURIComponent(JSON.stringify({
    event, orderId, orderNumber, statusAlias, t: new Date().toISOString()
  }));
  await upstashPath(`setex/yampi:last/600/${visor}`);

  // Se for carrinho abandonado, notifica no Telegram (sem dedupe)
  if (event === 'cart.reminder') {
    await sendTelegramCart(infoPayload);
  }

  // Regras de pago
  const isPaid =
    event === 'order.paid' ||
    (event === 'order.status.updated' && statusAlias === 'paid');

  // Sempre salvar INFO
  const ttl = 60 * 60 * 24; // 24h
  async function saveInfoFor(key) {
    const kInfo = encodeURIComponent('info:' + key);
    const payload = encodeURIComponent(JSON.stringify(infoPayload));
    await upstashPath(`setex/${kInfo}/${ttl}/${payload}`);
  }
  if (orderId)     await saveInfoFor(orderId);
  if (orderNumber) await saveInfoFor(orderNumber);

  // Se pago, libera chaves e envia Telegram (com dedupe por pedido)
  if (isPaid && (orderId || orderNumber)) {
    const dedupKey = encodeURIComponent(`sent:${orderId || orderNumber}`);
    const alreadySent = await upstashPath(`get/${dedupKey}`);

    if (!alreadySent?.result) {
      await upstashPath(`setex/${dedupKey}/${ttl}/1`);

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
      // Envia mensagem para o Telegram
      await sendTelegram(infoPayload);
    }
  }

  return res.status(200).send('ok');
}
