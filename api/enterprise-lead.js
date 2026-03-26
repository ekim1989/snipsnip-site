const SUPABASE_URL = 'https://ghstrzodoyxokligldqn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdoc3Ryem9kb3l4b2tsaWdsZHFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NDQ3MDgsImV4cCI6MjA4OTEyMDcwOH0.fR6n6sCPphyum5yNxib0GvIWnGKKve4iboTEi7vq-cE';
const MAKE_WEBHOOK_URL = 'https://hook.us2.make.com/cyu86ai2rsmc41xhx8bkaiei9kxob4fa';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, email, company, team_size, use_case, source } = req.body;

    if (!name || !email || !company || !team_size) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const lead = {
      name,
      email,
      company,
      team_size,
      use_case: use_case || null,
      source: source || 'website',
      status: 'new',
    };

    // Save to Supabase
    const sbRes = await fetch(SUPABASE_URL + '/rest/v1/enterprise_leads', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(lead),
    });

    if (!sbRes.ok) {
      console.error('Supabase insert failed:', await sbRes.text());
      return res.status(500).json({ error: 'Failed to save lead' });
    }

    // Send to Make.com webhook for email notification
    try {
      await fetch(MAKE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          company,
          team_size,
          use_case: use_case || 'Not provided',
          source: source || 'website',
          submitted_at: new Date().toISOString(),
        }),
      });
    } catch (err) {
      console.error('Make webhook failed:', err);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Enterprise lead error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
