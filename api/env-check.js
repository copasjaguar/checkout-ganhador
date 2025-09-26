export default async function handler(req, res) {
  const url = process.env.UPSTASH_REDIS_REST_URL || null;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || null;
  res.status(200).json({
    hasUrl: !!url,
    hasToken: !!token,
    urlHost: url ? new URL(url).host : null,
    tokenPreview: token ? (token.slice(0, 6) + "…" + token.slice(-4)) : null
  });
}
