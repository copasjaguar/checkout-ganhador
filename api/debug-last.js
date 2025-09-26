export default async function handler(req, res) {
  const order = req.query.order;

  const last = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ command: ["GET", "yampi:last"] })
  }).then(r => r.json());

  let ord = null;
  if (order) {
    ord = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ command: ["GET", `order:${order}`] })
    }).then(r => r.json());
  }

  res.status(200).json({
    last_event: last?.result ? JSON.parse(last.result) : null,
    order_key: ord ? (ord?.result ?? null) : null
  });
}
