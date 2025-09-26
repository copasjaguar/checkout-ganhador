export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).send('webhook yampi ok');
  }
  if (req.method !== 'POST') return res.status(405).end();

  // RAW body p/ HMAC
  const raw = await new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

  // Validação HMAC
  const signature = req.headers['x-yampi-hmac-sha256'] || '';
  const secret = process.env.YAMPI_WEBHOOK_SECRET;
  const crypto = await import('node:crypto');
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  const ok = (a.length === b.length) && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).send('invalid signature');

  // Parse do payload
  const body = JSON.parse(raw.toString('utf8'));
  const event = body?.event;
  const order = body?.resource || {};
  const orderId = order?.id;                 // ID interno
  const orderNumber = order?.number;         // número público
  const statusAlias = order?.status?.data?.alias; // 'paid', etc.

  // Considera pago por 2 caminhos
  const isPaid = event === 'order.paid' ||
                 (event === 'order.status.updated' && statusAlias === 'paid');

  // Visor do último evento (debug opcional, expira em 10min)
  try {
    await fetch(process.env.UPSTASH_REDIS_REST_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
      body: JSON.stringify({ command: ["SETEX", "yampi:last", "600", JSON.stringify({
        event, orderId, orderNumber, statusAlias, t: new Date().toISOString()
      })] })
    });
  } catch {}

  if (isPaid && (orderId || orderNumber)) {
    const pipeline = [];
    if (orderId)     { pipeline.push(['SET', `order:${orderId}`, 'paid'],     ['EXPIRE', `order:${orderId}`, 86400]); }
    if (orderNumber) { pipeline.push(['SET', `order:${orderNumber}`, 'paid'], ['EXPIRE', `order:${orderNumber}`, 86400]); }
    if (pipeline.length) {
      await fetch(process.env.UPSTASH_REDIS_REST_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
        body: JSON.stringify({ pipeline })
      });
    }
  }

  return res.status(200).send('ok');
}
