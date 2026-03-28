const crypto = require('crypto');

const SUPABASE_URL = 'https://ghstrzodoyxokligldqn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdoc3Ryem9kb3l4b2tsaWdsZHFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NDQ3MDgsImV4cCI6MjA4OTEyMDcwOH0.fR6n6sCPphyum5yNxib0GvIWnGKKve4iboTEi7vq-cE';
const WEBHOOK_SECRET = 'whsec_K71G6YXzHJVKMhNzzmQRnij1SUjT0sbt';

const HANDLED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'customer.created',
  'customer.subscription.paused',
  'customer.subscription.resumed',
];

function verifySignature(rawBody, sigHeader) {
  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [key, val] = part.split('=');
    acc[key] = val;
    return acc;
  }, {});
  const timestamp = parts['t'];
  const signature = parts['v1'];
  if (!timestamp || !signature) return false;
  const signedPayload = timestamp + '.' + rawBody;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(signedPayload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

async function sb(path, method, body) {
  const opts = {
    method: method || 'GET',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(SUPABASE_URL + '/rest/v1/' + path, opts);
  if (method === 'GET' || (method === 'POST' && opts.headers.Prefer === 'return=representation')) {
    return resp.json();
  }
  return resp;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');

    const sigHeader = req.headers['stripe-signature'];
    if (!sigHeader || !verifySignature(rawBody, sigHeader)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(rawBody);
    if (!HANDLED_EVENTS.includes(event.type)) {
      return res.status(200).json({ received: true, skipped: true });
    }

    const obj = event.data.object;

    if (event.type === 'checkout.session.completed') {
      const userId = obj.client_reference_id;
      const customerId = obj.customer;
      const subscriptionId = obj.subscription;

      if (userId && subscriptionId) {
        await sb('profiles?id=eq.' + userId, 'PATCH', { tier: 'pro' });
        await sb('subscriptions', 'POST', {
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          tier: 'pro',
          status: 'active',
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (event.type === 'customer.subscription.updated') {
      const subId = obj.id;
      const status = obj.status;
      const periodEnd = obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null;

      await sb('subscriptions?stripe_subscription_id=eq.' + subId, 'PATCH', {
        status: status,
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      });

      if (status === 'active') {
        const subs = await sb('subscriptions?stripe_subscription_id=eq.' + subId + '&select=user_id', 'GET');
        if (Array.isArray(subs) && subs.length > 0) {
          await sb('profiles?id=eq.' + subs[0].user_id, 'PATCH', { tier: 'pro' });
        }
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const subId = obj.id;
      await sb('subscriptions?stripe_subscription_id=eq.' + subId, 'PATCH', {
        status: 'canceled',
        updated_at: new Date().toISOString(),
      });

      const subs = await sb('subscriptions?stripe_subscription_id=eq.' + subId + '&select=user_id', 'GET');
      if (Array.isArray(subs) && subs.length > 0) {
        await sb('profiles?id=eq.' + subs[0].user_id, 'PATCH', { tier: 'free' });
      }
    }

    if (event.type === 'invoice.payment_failed') {
      const subId = obj.subscription;
      if (subId) {
        await sb('subscriptions?stripe_subscription_id=eq.' + subId, 'PATCH', {
          status: 'past_due',
          updated_at: new Date().toISOString(),
        });
      }
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('Stripe webhook error:', e);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
};
