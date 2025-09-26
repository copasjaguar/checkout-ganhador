export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).send('webhook yampi ok');
  if (req.method !== 'POST') return res.status(405).end();

  const raw = await new Promise(r=>{const c=[]; req.on('data',x=>c.push(x)); req.on('end',()=>r(Buffer.concat(c)))});
  let body={}; try{ body=JSON.parse(raw.toString('utf8')); }catch{}

  const event = body?.event;
  const rsc = body?.resource || {};
  const id = rsc?.id, number = rsc?.number;
  const statusAlias = rsc?.status?.data?.alias;

  const isPaid = event==='order.paid' || (event==='order.status.updated' && statusAlias==='paid');
  if (isPaid && (id || number)) {
    const h = { Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type':'application/json' };
    const pipeline = [];
    if (id)     { pipeline.push(['SET',`order:${id}`,'paid'],     ['EXPIRE',`order:${id}`,'86400']); }
    if (number) { pipeline.push(['SET',`order:${number}`,'paid'], ['EXPIRE',`order:${number}`,'86400']); }
    await fetch(process.env.UPSTASH_REDIS_REST_URL, { method:'POST', headers:h, body: JSON.stringify({ pipeline }) });
  }

  // salva um visor do último corpo pra debug por 10min
  await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method:'POST',
    headers:{ Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ command:['SETEX','yampi:last','600', raw.toString('utf8')] })
  }).catch(()=>{});

  res.status(200).send('ok');
}
