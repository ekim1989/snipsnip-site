const crypto = require('crypto');

const SUPABASE_URL = 'https://ghstrzodoyxokligldqn.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdoc3Ryem9kb3l4b2tsaWdsZHFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NDQ3MDgsImV4cCI6MjA4OTEyMDcwOH0.fR6n6sCPphyum5yNxib0GvIWnGKKve4iboTEi7vq-cE';
const WEBHOOK_SECRET = 'whsec_K71G6YXzHJVKMhNzzmQRnij1SUjT0sbt';

const HANDLED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.created',
  'customer.subscription.trial_will_end',
  'charge.refunded',
];

function verifySignature(payload, sigHeader) {
  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [key, val] = part.split('=');
    acc[key] = val;
    return acc;
  }, {});
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const signedPayload = timestamp + '.' + payload;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(signedPayload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

async function sb(path, method, body) {
  const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
  const opts = {
    method: method || 'GET',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
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
    // Read raw body for signature verification
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

    // ── checkout.session.completed ──
    if (event.type === 'checkout.session.completed') {
      const userId = obj.client_reference_id;
      const customerId = obj.customer;
      const subscriptionId = obj.subscription;

      if (userId && subscriptionId) {
        // Update profile tier
        await sb('profiles?id=eq.' + userId, 'PATCH', { tier: 'pro' });

        // Upsert subscription record
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

    // ── customer.subscription.created ──
    if (event.type === 'customer.subscription.created') {
      // Handled by checkout.session.completed mostly, but good as backup
    }

    // ── customer.subscription.updated ──
    if (event.type === 'customer.subscription.updated') {
      const subId = obj.id;
      const status = obj.status;
      const periodEnd = obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null;

      // Update subscription record
      await sb('subscriptions?stripe_subscription_id=eq.' + subId, 'PATCH', {
        status: status,
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      });

      // Update profile tier based on status
      const subs = await sb('subscriptions?stripe_subscription_id=eq.' + subId, 'GET');
      if (Array.isArray(subs) && subs.length > 0) {
        const userId = subs[0].user_id;
        const tier = (status === 'active' || status === 'trialing') ? 'pro' : 'free';
        await sb('profiles?id=eq.' + userId, 'PATCH', { tier: tier });
      }
    }

    // ── customer.subscription.deleted ──
    if (event.type === 'customer.subscription.deleted') {
      const subId = obj.id;

      await sb('subscriptions?stripe_subscription_id=eq.' + subId, 'PATCH', {
        status: 'canceled',
        updated_at: new Date().toISOString(),
      });

      const subs = await sb('subscriptions?stripe_subscription_id=eq.' + subId, 'GET');
      if (Array.isArray(subs) && subs.length > 0) {
        await sb('profiles?id=eq.' + subs[0].user_id, 'PATCH', { tier: 'free' });
      }
    }

    // ── invoice.payment_failed ──
    if (event.type === 'invoice.payment_failed') {
      const subId = obj.subscription;
      if (subId) {
        await sb('subscriptions?stripe_subscription_id=eq.' + subId, 'PATCH', {
          status: 'past_due',
          updated_at: new Date().toISOString(),
        });
      }
    }

    // ── invoice.paid ──
    if (event.type === 'invoice.paid') {
      // Subscription renewal succeeded — ensure tier stays pro
      const subId = obj.subscription;
      if (subId) {
        await sb('subscriptions?stripe_subscription_id=eq.' + subId, 'PATCH', {
          status: 'active',
          updated_at: new Date().toISOString(),
        });
        const subs = await sb('subscriptions?stripe_subscription_id=eq.' + subId, 'GET');
        if (Array.isArray(subs) && subs.length > 0) {
          await sb('profiles?id=eq.' + subs[0].user_id, 'PATCH', { tier: 'pro' });
        }
      }
    }

    // ── charge.refunded ──
    if (event.type === 'charge.refunded') {
      // Log for now, don't auto-downgrade (manual review)
    }

    // ── customer.subscription.trial_will_end ──
    if (event.type === 'customer.subscription.trial_will_end') {
      // Future: send email reminder
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('Webhook error:', e);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
};

// Disable Vercel's automatic body parsing so we can read raw body for Stripe signature
module.exports.config = { api: { bodyParser: false } };
