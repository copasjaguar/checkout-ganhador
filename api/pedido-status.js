export default async function handler(req, res) {
  const order = (req.query.order || '').toString().trim();
  if (!order) return res.status(200).json({ status:'pending' });

  const r = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method:'POST',
    headers:{ Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ command:['GET', `order:${order}`] })
  }).then(r=>r.json()).catch(()=>null);

  const value = r?.result ?? null;
  res.status(200).json({ status: value === 'paid' ? 'paid' : 'pending' });
}
