export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  // GET só pra testar no navegador
  if (req.method === 'GET') {
    return res.status(200).send('webhook yampi ok');
  }
  if (req.method !== 'POST') return res.status(405).end();

  // 1) RAW body (obrigatório p/ HMAC)
  const raw = await new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

  // 2) Validação HMAC (header já vem minúsculo no Node)
  const signature = req.headers['x-yampi-hmac-sha256'] || '';
  const secret = process.env.YAMPI_WEBHOOK_SECRET || '';
  const crypto = await import('node:crypto');
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('base64');

  // timingSafeEqual só funciona com buffers do MESMO tamanho
  let sigOk = false;
  try {
    const a = Buffer.from(signature, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    sigOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { sigOk = false; }

  // 3) Parse seguro do payload
  let body = {};
  try { body = JSON.parse(raw.toString('utf8')); } catch {}

  const event       = body?.event ?? null;
  const order       = body?.resource || {};
  const orderId     = order?.id ?? null;          // ID interno
  const orderNumber = order?.number ?? null;      // número público
  const statusAlias = order?.status?.data?.alias ?? null; // p/ status.updated

  // 4) Sempre grava um "visor" do último evento (10 min) — ajuda debug
  try {
    await fetch(process.env.UPSTASH_REDIS_REST_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command: [
          'SETEX',
          'yampi:last',
          '600', // segundos como string
          JSON.stringify({
            method: req.method,
            sigHeaderPresent: Boolean(signature),
            sigOk,
            event,
            orderId,
            orderNumber,
            statusAlias,
            t: new Date().toISOString(),
          }),
        ],
      }),
    });
  } catch {}

  // 5) Se assinatura inválida, retorna 401
  if (!sigOk) return res.status(401).send('invalid signature');

  // 6) Considera pago em dois cenários (cobre PIX à vista)
  const isPaid =
    event === 'order.paid' ||
    (event === 'order.status.updated' && statusAlias === 'paid');

  // 7) Grava por ID e por Número (24h) usando pipeline
  if (isPaid && (orderId || orderNumber)) {
    const pipeline = [];
    if (orderId) {
      pipeline.push(['SET', `order:${orderId}`, 'paid']);
      pipeline.push(['EXPIRE', `order:${orderId}`, '86400']); // string
    }
    if (orderNumber) {
      pipeline.push(['SET', `order:${orderNumber}`, 'paid']);
      pipeline.push(['EXPIRE', `order:${orderNumber}`, '86400']); // string
    }

    if (pipeline.length) {
      await fetch(process.env.UPSTASH_REDIS_REST_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pipeline }),
      });
    }
  }

  // 8) Sempre responda 200 rápido
  return res.status(200).send('ok');
}
