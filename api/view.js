const crypto = require('crypto');

const SUPABASE_URL = 'https://ghstrzodoyxokligldqn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdoc3Ryem9kb3l4b2tsaWdsZHFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NDQ3MDgsImV4cCI6MjA4OTEyMDcwOH0.fR6n6sCPphyum5yNxib0GvIWnGKKve4iboTEi7vq-cE';

function getIpHash(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  return crypto.createHash('sha256').update(ip + '_ss_pv_salt').digest('hex').slice(0, 16);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { page, referrer } = req.body || {};
    const ipHash = getIpHash(req);
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    // Check if this IP already has a view in the last 30 minutes
    const checkResp = await fetch(
      SUPABASE_URL + '/rest/v1/page_views?ip_hash=eq.' + ipHash + '&page=eq.' + (page || 'landing') + '&created_at=gte.' + cutoff + '&limit=1',
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY } }
    );
    const existing = await checkResp.json();

    if (Array.isArray(existing) && existing.length > 0) {
      return res.status(200).json({ ok: true, deduped: true });
    }

    await fetch(SUPABASE_URL + '/rest/v1/page_views', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        page: page || 'landing',
        referrer: referrer || null,
        ip_hash: ipHash,
      }),
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
};
