export default async function handler(req, res) {
  const { order } = req.query;
  let status = 'pending';

  if (order) {
    const r = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
      body: JSON.stringify({ command: ['GET', `order:${order}`] })
    });
    const j = await r.json();
    if (j.result === 'paid') status = 'paid';
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify({ status }));
}
