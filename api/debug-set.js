export default async function handler(req, res) {
  const order = (req.query.order || 'TESTE1').toString();
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const h = { Authorization:`Bearer ${token}`, 'Content-Type':'application/json' };

  await fetch(url, { method:'POST', headers:h,
    body: JSON.stringify({ command:['SET', `order:${order}`, 'paid'] })
  });
  await fetch(url, { method:'POST', headers:h,
    body: JSON.stringify({ command:['EXPIRE', `order:${order}`, '86400'] })
  });
  res.status(200).json({ ok:true, order });
}
