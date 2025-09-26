export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // RAW body p/ HMAC
  const raw = await new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

  // Valida assinatura
  const signature = req.headers['x-yampi-hmac-sha256'] || '';
  const secret = process.env.YAMPI_WEBHOOK_SECRET;
  const crypto = await import('node:crypto');
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).send('invalid signature');
  }

  // Parse
  const body = JSON.parse(raw.toString('utf8'));
  const event = body?.event;
  const orderId = body?.resource?.id;
  const statusAlias = body?.resource?.status?.data?.alias; // ex.: 'paid'

  // Considera pago em dois cenários:
  const isPaid =
    event === 'order.paid' ||
    (event === 'order.status.updated' && statusAlias === 'paid');

  // Grava no Upstash
  if (isPaid && orderId) {
    await fetch(process.env.UPSTASH_REDIS_REST_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
      body: JSON.stringify({
        pipeline: [
          ["SET", `order:${orderId}`, "paid"],
          ["EXPIRE", `order:${orderId}`, 86400]
        ]
      })
    });
  }

  return res.status(200).send('ok');
}
