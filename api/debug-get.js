export default async function handler(req, res) {
  const order = (req.query.order || 'TESTE1').toString();
  const resp = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ command: ['GET', `order:${order}`] })
  }).then(r => r.json()).catch(e => ({ error: String(e) }));

  res.status(200).json({ order, raw: resp, value: resp?.result ?? null });
}
