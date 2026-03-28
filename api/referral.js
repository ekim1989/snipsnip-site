const crypto = require('crypto');

const SUPABASE_URL = 'https://ghstrzodoyxokligldqn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdoc3Ryem9kb3l4b2tsaWdsZHFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NDQ3MDgsImV4cCI6MjA4OTEyMDcwOH0.fR6n6sCPphyum5yNxib0GvIWnGKKve4iboTEi7vq-cE';

function getIpHash(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  return crypto.createHash('sha256').update(ip + '_snipsnip_salt').digest('hex').slice(0, 32);
}

async function supabaseQuery(path, method, body) {
  const opts = {
    method,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
  };
  if (method === 'PATCH') opts.headers['Prefer'] = 'return=representation';
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, opts);
  if (r.status === 204) return null;
  return r.json();
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const ipHash = getIpHash(req);

  // POST: Store a pending referral (called from landing page)
  if (req.method === 'POST') {
    try {
      const { share_code } = req.body || {};
      if (!share_code || typeof share_code !== 'string' || share_code.length > 50) {
        return res.status(400).json({ error: 'Invalid share code' });
      }

      // Check if this IP already has a recent pending referral (avoid duplicates)
      const existing = await supabaseQuery(
        'pending_referrals?ip_hash=eq.' + ipHash + '&claimed=eq.false&created_at=gte.' + new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() + '&limit=1',
        'GET'
      );

      if (Array.isArray(existing) && existing.length > 0) {
        // Update the existing one with the latest share code
        await supabaseQuery(
          'pending_referrals?id=eq.' + existing[0].id,
          'PATCH',
          { share_code }
        );
        return res.status(200).json({ ok: true, updated: true });
      }

      // Insert new pending referral
      await supabaseQuery('pending_referrals', 'POST', {
        share_code,
        ip_hash: ipHash,
      });

      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // GET: Claim a pending referral (called from extension on first sign-in)
  if (req.method === 'GET') {
    try {
      // Look for unclaimed pending referral from this IP in the last 48 hours
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const pending = await supabaseQuery(
        'pending_referrals?ip_hash=eq.' + ipHash + '&claimed=eq.false&created_at=gte.' + cutoff + '&order=created_at.desc&limit=1',
        'GET'
      );

      if (!Array.isArray(pending) || pending.length === 0) {
        return res.status(200).json({ share_code: null });
      }

      const ref = pending[0];

      // Mark as claimed
      await supabaseQuery(
        'pending_referrals?id=eq.' + ref.id,
        'PATCH',
        { claimed: true }
      );

      return res.status(200).json({ share_code: ref.share_code });
    } catch (e) {
      return res.status(500).json({ error: 'Server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
