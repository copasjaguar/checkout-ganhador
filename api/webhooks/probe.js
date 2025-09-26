export default async function handler(req, res) {
  if (req.method === 'GET') {
    // GET só pra você testar no navegador
    return res.status(200).send('probe ok');
  }
  if (req.method !== 'POST') return res.status(405).end();

  // pega o corpo bruto
  const raw = await new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

  // guarda por 10 min pra inspecionar depois
  await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
    body: JSON.stringify({
      command: ["SETEX","yampi:last","600", raw.toString("utf8")]
    })
  });

  return res.status(200).send('ok');
}
