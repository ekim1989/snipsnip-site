const SUPABASE_URL = 'https://ghstrzodoyxokligldqn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdoc3Ryem9kb3l4b2tsaWdsZHFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NDQ3MDgsImV4cCI6MjA4OTEyMDcwOH0.fR6n6sCPphyum5yNxib0GvIWnGKKve4iboTEi7vq-cE';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured' });

  try {
    const { user_id } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });

    // Look up Stripe customer ID from subscriptions table
    const key = process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
    const subResp = await fetch(
      SUPABASE_URL + '/rest/v1/subscriptions?user_id=eq.' + user_id + '&select=stripe_customer_id&order=created_at.desc&limit=1',
      { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } }
    );
    const subs = await subResp.json();

    if (!Array.isArray(subs) || subs.length === 0 || !subs[0].stripe_customer_id) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    const customerId = subs[0].stripe_customer_id;

    // Create Stripe billing portal session
    const portalResp = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(STRIPE_SECRET_KEY + ':').toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'customer=' + encodeURIComponent(customerId) + '&return_url=' + encodeURIComponent('https://snipsnip.ai'),
    });

    const portal = await portalResp.json();

    if (portal.url) {
      return res.status(200).json({ url: portal.url });
    } else {
      return res.status(500).json({ error: 'Failed to create portal session', detail: portal.error?.message });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
};
