export default async function handler(req, res) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const w = await fetch(url, { method:'POST', headers:h,
    body: JSON.stringify({ command: ['SETEX','yampi:last','600', JSON.stringify({ ok:true, ts:Date.now() })] })
  }).then(r=>r.json()).catch(e=>({error:String(e)}));

  const r = await fetch(url, { method:'POST', headers:h,
    body: JSON.stringify({ command: ['GET','yampi:last'] })
  }).then(r=>r.json()).catch(e=>({error:String(e)}));

  res.status(200).json({ write:w, read:r });
}
