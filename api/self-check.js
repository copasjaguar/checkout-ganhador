export default async function handler(req, res) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  let write = null, read = null, err = null;

  try {
    const w = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        command: ["SETEX", "yampi:last", "600", JSON.stringify({ selfcheck: true, ts: Date.now() })]
      })
    });
    write = await w.json();

    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ command: ["GET", "yampi:last"] })
    });
    read = await r.json();
  } catch (e) { err = String(e); }

  res.status(200).json({ ok: !err, write, read, err });
}
