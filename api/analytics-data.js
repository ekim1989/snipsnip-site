const SUPABASE_URL = 'https://ghstrzodoyxokligldqn.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdoc3Ryem9kb3l4b2tsaWdsZHFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzU0NDcwOCwiZXhwIjoyMDg5MTIwNzA4fQ.Q_Ow9UfYAEh_BdNrphL_Q92MKGDXzggikm-4Zyfnfdw';
const PASSWORD = 'Pulsechain123!';

async function sb(path) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY }
  });
  return r.json();
}

async function sbAdmin(path) {
  const r = await fetch(SUPABASE_URL + path, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY }
  });
  return r.json();
}

function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString(); }
function dateStr(iso) { return iso ? iso.slice(0, 10) : ''; }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var body = req.body || {};
  if (body.password !== PASSWORD) return res.status(401).json({ error: 'Wrong password' });

  try {
    var now = new Date();
    var d1 = daysAgo(1), d7 = daysAgo(7), d14 = daysAgo(14), d30 = daysAgo(30);

    var [users, profiles, snips, snipsWeek, shares, sharesWeek, folders,
         pageViews, ctaClicks, uninstalls, nudges, subs, apiKeys,
         snips30, shares30, pvWelcome, pvLanding] = await Promise.all([
      sbAdmin('/auth/v1/admin/users?per_page=500'),
      sb('profiles?select=*'),
      sb('snips?select=id&deleted=eq.false'),
      sb('snips?select=id&deleted=eq.false&created_at=gte.' + d7),
      sb('shared_links?select=id,user_id,created_at'),
      sb('shared_links?select=id&created_at=gte.' + d7),
      sb('folders?select=id,user_id&deleted=eq.false'),
      sb('page_views?select=*&order=created_at.desc&limit=500'),
      sb('cta_clicks?select=*&order=created_at.desc&limit=500'),
      sb('uninstall_feedback?select=*'),
      sb('premium_nudge_events?select=*'),
      sb('subscriptions?select=*'),
      sb('user_api_keys?select=id'),
      sb('snips?select=id,user_id,created_at,folder_id&deleted=eq.false&created_at=gte.' + d30),
      sb('shared_links?select=id,created_at&created_at=gte.' + d30),
      sb('page_views?select=id&page=eq.welcome'),
      sb('page_views?select=id&page=eq.landing'),
    ]);

    var userList = Array.isArray(users) ? users : (users.users || []);
    var profileList = Array.isArray(profiles) ? profiles : [];
    var snipList = Array.isArray(snips) ? snips : [];
    var snipWeekList = Array.isArray(snipsWeek) ? snipsWeek : [];
    var shareList = Array.isArray(shares) ? shares : [];
    var shareWeekList = Array.isArray(sharesWeek) ? sharesWeek : [];
    var folderList = Array.isArray(folders) ? folders : [];
    var pvList = Array.isArray(pageViews) ? pageViews : [];
    var ctaList = Array.isArray(ctaClicks) ? ctaClicks : [];
    var uninstallList = Array.isArray(uninstalls) ? uninstalls : [];
    var nudgeList = Array.isArray(nudges) ? nudges : [];
    var subList = Array.isArray(subs) ? subs : [];
    var keyList = Array.isArray(apiKeys) ? apiKeys : [];
    var snips30List = Array.isArray(snips30) ? snips30 : [];
    var shares30List = Array.isArray(shares30) ? shares30 : [];
    var welcomeViews = Array.isArray(pvWelcome) ? pvWelcome.length : 0;
    var landingViews = Array.isArray(pvLanding) ? pvLanding.length : 0;

    var totalUsers = userList.length;
    var activeSubs = subList.filter(function(s) { return s.status === 'active'; });
    var proUsers = activeSubs.length;
    var mrr = proUsers * 8;

    var wau = profileList.filter(function(p) { return p.last_active_at && p.last_active_at >= d7; }).length;
    var mau = profileList.filter(function(p) { return p.last_active_at && p.last_active_at >= d30; }).length;
    var dau = profileList.filter(function(p) { return p.last_active_at && p.last_active_at >= d1; }).length;
    var stickiness = mau > 0 ? Math.round((dau / mau) * 100) : 0;
    var usersThisWeek = userList.filter(function(u) { return u.created_at && u.created_at >= d7; }).length;

    // Daily series (last 30 days)
    var dailyDates = [];
    for (var i = 29; i >= 0; i--) {
      var dd = new Date(now); dd.setDate(dd.getDate() - i);
      dailyDates.push(dd.toISOString().slice(0, 10));
    }

    var dailySnips = dailyDates.map(function(d) {
      return snips30List.filter(function(s) { return dateStr(s.created_at) === d; }).length;
    });
    var dailyShares = dailyDates.map(function(d) {
      return shares30List.filter(function(s) { return dateStr(s.created_at) === d; }).length;
    });
    var dailyUsers = dailyDates.map(function(d) {
      return userList.filter(function(u) { return dateStr(u.created_at) === d; }).length;
    });

    // Funnel
    var ctaCws = ctaList.filter(function(c) { return c.page !== 'share_save'; }).length;
    var usersWithSnips = new Set(snips30List.map(function(s) { return s.user_id; })).size;

    // Share page performance
    var shareSaves = ctaList.filter(function(c) { return c.page === 'share_save'; });
    var saveHasExt = shareSaves.filter(function(c) { return c.button_position === 'has_extension'; }).length;
    var saveNoExt = shareSaves.filter(function(c) { return c.button_position === 'no_extension'; }).length;
    var saveDeepLink = shareSaves.filter(function(c) { return c.button_position === 'deep_link'; }).length;
    var sharePvs = pvList.filter(function(p) { return p.page === 'share'; }).length;

    // Feature adoption
    var usersWithFolders = new Set(folderList.map(function(f) { return f.user_id; })).size;
    var usersWhoShared = new Set(shareList.map(function(s) { return s.user_id; }).filter(Boolean)).size;
    var nudgeShown = nudgeList.filter(function(n) { return n.action === 'shown'; }).length;
    var nudgeClicked = nudgeList.filter(function(n) { return n.action === 'clicked'; }).length;

    // Uninstall reasons
    var reasons = {};
    uninstallList.forEach(function(u) {
      reasons[u.reason] = (reasons[u.reason] || 0) + 1;
    });

    // Power users (snip count per user)
    var userSnipCounts = {};
    snipList.forEach(function() {}); // can't count per user from id-only list
    snips30List.forEach(function(s) {
      userSnipCounts[s.user_id] = (userSnipCounts[s.user_id] || 0) + 1;
    });

    // Build user table
    var userTable = userList.map(function(u) {
      var prof = profileList.find(function(p) { return p.id === u.id; });
      var snipCount = userSnipCounts[u.id] || 0;
      return {
        email: u.email || '',
        created_at: u.created_at || '',
        snips: snipCount,
        tier: prof ? (prof.tier || 'free') : 'free',
        last_active: prof ? (prof.last_active_at || '') : '',
        has_snip: snipCount > 0,
      };
    }).sort(function(a, b) { return (b.snips || 0) - (a.snips || 0); });

    // Retention (approximate)
    var d1Ret = 0, d7Ret = 0, d30Ret = 0, totalForRet = 0;
    userList.forEach(function(u) {
      if (!u.created_at) return;
      var created = new Date(u.created_at);
      var prof = profileList.find(function(p) { return p.id === u.id; });
      if (!prof || !prof.last_active_at) return;
      var lastActive = new Date(prof.last_active_at);
      var daysSinceCreated = (now - created) / 86400000;
      var daysBetween = (lastActive - created) / 86400000;
      if (daysSinceCreated >= 1) { totalForRet++; if (daysBetween >= 1) d1Ret++; }
      if (daysSinceCreated >= 7) { if (daysBetween >= 7) d7Ret++; }
      if (daysSinceCreated >= 30) { if (daysBetween >= 30) d30Ret++; }
    });

    var atRisk = profileList.filter(function(p) {
      if (!p.last_active_at) return false;
      return p.last_active_at < d7 && p.last_active_at >= d14;
    }).length;
    var churned = profileList.filter(function(p) {
      if (!p.last_active_at) return false;
      return p.last_active_at < d14;
    }).length;

    res.status(200).json({
      kpi: {
        total_users: totalUsers,
        wau: wau, mau: mau, dau: dau,
        stickiness: stickiness,
        total_snips: snipList.length,
        snips_week: snipWeekList.length,
        total_shares: shareList.length,
        shares_week: shareWeekList.length,
        mrr: mrr, pro_users: proUsers,
        uninstalls: uninstallList.length,
        users_week: usersThisWeek,
        churn_rate: totalUsers > 0 ? Math.round((uninstallList.length / (totalUsers + uninstallList.length)) * 100) : 0,
      },
      funnel: {
        landing_views: landingViews,
        cta_clicks: ctaCws,
        share_views: sharePvs,
        save_clicks: shareSaves.length,
        installs: welcomeViews,
        signups: totalUsers,
        first_snip: usersWithSnips,
        pro: proUsers,
      },
      daily: {
        dates: dailyDates.map(function(d) { var p = d.split('-'); return p[1] + '/' + p[2]; }),
        snips: dailySnips,
        shares: dailyShares,
        users: dailyUsers,
      },
      retention: {
        d1: totalForRet > 0 ? Math.round((d1Ret / totalForRet) * 100) : 0,
        d7: totalForRet > 0 ? Math.round((d7Ret / totalForRet) * 100) : 0,
        d30: totalForRet > 0 ? Math.round((d30Ret / totalForRet) * 100) : 0,
        at_risk: atRisk, churned: churned,
      },
      features: {
        created_snip: totalUsers > 0 ? Math.round((usersWithSnips / totalUsers) * 100) : 0,
        used_folders: totalUsers > 0 ? Math.round((usersWithFolders / totalUsers) * 100) : 0,
        shared: totalUsers > 0 ? Math.round((usersWhoShared / totalUsers) * 100) : 0,
        mcp_keys: keyList.length,
        nudge_shown: nudgeShown,
        nudge_clicked: nudgeClicked,
        nudge_rate: nudgeShown > 0 ? Math.round((nudgeClicked / nudgeShown) * 100) : 0,
      },
      share_perf: {
        views: sharePvs,
        save_clicks: shareSaves.length,
        has_ext: saveHasExt,
        no_ext: saveNoExt,
        deep_link: saveDeepLink,
        viral_coeff: totalUsers > 0 ? ((shareList.length * (welcomeViews > 0 ? welcomeViews / landingViews : 0)) / totalUsers).toFixed(2) : '0.00',
      },
      revenue: {
        mrr: mrr, active_subs: proUsers,
        churned_subs: subList.filter(function(s) { return s.status === 'canceled'; }).length,
        arpu: totalUsers > 0 ? (mrr / totalUsers).toFixed(2) : '0.00',
        conversion: totalUsers > 0 ? ((proUsers / totalUsers) * 100).toFixed(1) : '0.0',
      },
      uninstall_reasons: reasons,
      power_users: userTable.slice(0, 5),
      recent_users: userTable.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); }).slice(0, 10),
      engagement: {
        avg_snips: totalUsers > 0 ? (snipList.length / totalUsers).toFixed(1) : '0',
        avg_snips_active: wau > 0 ? (snipWeekList.length / wau).toFixed(1) : '0',
        avg_shares: totalUsers > 0 ? (shareList.length / totalUsers).toFixed(1) : '0',
        avg_folders: totalUsers > 0 ? (folderList.length / totalUsers).toFixed(1) : '0',
      },
    });
  } catch (e) {
    console.error('Analytics error:', e);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
};
