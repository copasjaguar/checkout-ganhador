export default async function handler(req, res) {
  const { order } = req.query; // pode ser id OU number
  let status = 'pending';

  if (order) {
    // tenta direto a chave enviada
    const r1 = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
      body: JSON.stringify({ command: ['GET', `order:${order}`] })
    });
    const j1 = await r1.json();
    if (j1.result === 'paid') {
      status = 'paid';
    } else {
      // (opcional) se você quiser dar uma segunda chance com outro formato, pode colocar aqui.
      // Mas como agora salvamos por id e por number, não deve precisar.
    }
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify({ status }));
}
