export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).send('webhook yampi ok');
  if (req.method !== 'POST') return res.status(405).end();

  const raw = await new Promise(r => { const c=[]; req.on('data',x=>c.push(x)); req.on('end',()=>r(Buffer.concat(c))) });

  // HMAC
  const sig = req.headers['x-yampi-hmac-sha256'] || '';
  const secret = process.env.YAMPI_WEBHOOK_SECRET || '';
  const crypto = await import('node:crypto');
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  const ok = (Buffer.byteLength(sig)===Buffer.byteLength(expected)) &&
             crypto.timingSafeEqual(Buffer.from(sig,'utf8'), Buffer.from(expected,'utf8'));

  // snapshot p/ debug (10 min)
  try {
    await fetch(process.env.UPSTASH_REDIS_REST_URL, {
      method:'POST',
      headers:{ Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ command:['SETEX','yampi:last','600', raw.toString('utf8')] })
    });
  } catch {}

  if (!ok) return res.status(401).send('invalid signature');

  // parse e gravação
  let body={}; try{ body=JSON.parse(raw.toString('utf8')); }catch{}
  const event = body?.event;
  const r = body?.resource||{};
  const id = r?.id, number = r?.number;
  const statusAlias = r?.status?.data?.alias;

  const isPaid = event==='order.paid' || (event==='order.status.updated' && statusAlias==='paid');
  if (isPaid && (id||number)) {
    const pipeline=[];
    if (id)     { pipeline.push(['SET',`order:${id}`,'paid'],     ['EXPIRE',`order:${id}`,'86400']); }
    if (number) { pipeline.push(['SET',`order:${number}`,'paid'], ['EXPIRE',`order:${number}`,'86400']); }

    await fetch(process.env.UPSTASH_REDIS_REST_URL, {
      method:'POST',
      headers:{ Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ pipeline })
    });
  }

  return res.status(200).send('ok');
}
