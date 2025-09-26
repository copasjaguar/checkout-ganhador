export default async function handler(req, res) {
  const order = req.query.order; // opcional (?order=1444...)
  const calls = [];

  // GET yampi:last
  calls.push(fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
    body: JSON.stringify({ command: ["GET", "yampi:last"] })
  }).then(r => r.json()));

  // GET order:<order> (se informado)
  if (order) {
    calls.push(fetch(process.env.UPSTASH_REDIS_REST_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
      body: JSON.stringify({ command: ["GET", `order:${order}`] })
    }).then(r => r.json()));
  }

  const [last, ord] = await Promise.all(calls);
  res.status(200).json({
    last_event: last?.result ? JSON.parse(last.result) : null,
    order_key: order ? (ord?.result ?? null) : null
  });
}
