const SUPABASE_URL = 'https://ghstrzodoyxokligldqn.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdoc3Ryem9kb3l4b2tsaWdsZHFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzU0NDcwOCwiZXhwIjoyMDg5MTIwNzA4fQ.Q_Ow9UfYAEh_BdNrphL_Q92MKGDXzggikm-4Zyfnfdw';
const PASSWORD = 'Pulsechain123!';

async function sb(path) {
  var r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY }
  });
  return r.json();
}

async function sbAdmin(path) {
  var r = await fetch(SUPABASE_URL + path, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY }
  });
  return r.json();
}

function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString(); }
function dateStr(iso) { return iso ? iso.slice(0, 10) : ''; }
function safeArr(v) { return Array.isArray(v) ? v : []; }

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
    var d1 = daysAgo(1), d7 = daysAgo(7), d21 = daysAgo(21), d30 = daysAgo(30), d45 = daysAgo(45);

    var results = await Promise.all([
      sbAdmin('/auth/v1/admin/users?per_page=500'),
      sb('profiles?select=*'),
      sb('snips?select=id,user_id,created_at,folder_id&deleted=eq.false'),
      sb('snips?select=id,user_id&deleted=eq.false&created_at=gte.' + d7),
      sb('shared_links?select=id,user_id,created_at&source=eq.manual'),
      sb('shared_links?select=id&created_at=gte.' + d7 + '&source=eq.manual'),
      sb('folders?select=id,user_id,name&deleted=eq.false'),
      sb('page_views?select=*&order=created_at.desc&limit=1000'),
      sb('cta_clicks?select=*&order=created_at.desc&limit=1000'),
      sb('uninstall_feedback?select=*'),
      sb('premium_nudge_events?select=*'),
      sb('subscriptions?select=*'),
      sb('user_api_keys?select=id'),
    ]);

    var userList = safeArr(results[0].users || results[0]);
    var googleUsers = userList.filter(function(u) { return !u.is_anonymous; });
    var anonUsers = userList.filter(function(u) { return u.is_anonymous; });
    var anonUserIds = new Set(anonUsers.map(function(u) { return u.id; }));
    var profileList = safeArr(results[1]);
    var snipList = safeArr(results[2]);
    var snipWeekList = safeArr(results[3]);
    var shareList = safeArr(results[4]);
    var shareWeekList = safeArr(results[5]);
    var folderList = safeArr(results[6]);
    var defaultFolderNames = ['Folder 1', 'Folder 2', 'Folder 3'];
    var customFolderList = folderList.filter(function(f) { return defaultFolderNames.indexOf(f.name) === -1; });
    var pvList = safeArr(results[7]);
    var ctaList = safeArr(results[8]);
    var uninstallList = safeArr(results[9]);
    var nudgeList = safeArr(results[10]);
    var subList = safeArr(results[11]);
    var keyList = safeArr(results[12]);

    var totalUsers = googleUsers.length;
    var totalAnon = anonUsers.length;
    var usersThisWeek = googleUsers.filter(function(u) { return u.created_at && u.created_at >= d7; }).length;

    // Snips broken down by user type (anon vs Google)
    var googleSnips = snipList.filter(function(s) { return !anonUserIds.has(s.user_id); });
    var anonSnips = snipList.filter(function(s) { return anonUserIds.has(s.user_id); });
    var googleSnipsWeek = snipWeekList.filter(function(s) { return !anonUserIds.has(s.user_id); });
    var anonSnipsWeek = snipWeekList.filter(function(s) { return anonUserIds.has(s.user_id); });
    var activeSubs = subList.filter(function(s) { return s.status === 'active'; });
    var proUsers = activeSubs.length;
    var mrr = proUsers * 8;

    var wau = profileList.filter(function(p) { return p.last_active_at && p.last_active_at >= d7; }).length;
    var mau = profileList.filter(function(p) { return p.last_active_at && p.last_active_at >= d30; }).length;
    var dau = profileList.filter(function(p) { return p.last_active_at && p.last_active_at >= d1; }).length;
    var stickiness = mau > 0 ? Math.round((dau / mau) * 100) : 0;

    // Daily series (last 30 days)
    var dailyDates = [];
    for (var i = 29; i >= 0; i--) {
      var dd = new Date(now); dd.setDate(dd.getDate() - i);
      dailyDates.push(dd.toISOString().slice(0, 10));
    }

    var dailySnips = dailyDates.map(function(d) { return snipList.filter(function(s) { return dateStr(s.created_at) === d; }).length; });
    var dailyShares = dailyDates.map(function(d) { return shareList.filter(function(s) { return dateStr(s.created_at) === d; }).length; });
    var dailyUsers = dailyDates.map(function(d) { return googleUsers.filter(function(u) { return dateStr(u.created_at) === d; }).length; });

    // Funnel
    var pvLanding = pvList.filter(function(p) { return p.page === 'landing'; }).length;
    var pvWelcome = pvList.filter(function(p) { return p.page === 'welcome'; }).length;
    var pvShare = pvList.filter(function(p) { return p.page === 'share'; }).length;
    var ctaCws = ctaList.filter(function(c) { return c.page !== 'share_save'; }).length;
    var usersWithSnips = new Set(googleSnips.map(function(s) { return s.user_id; })).size;
    var anonsWithSnips = new Set(anonSnips.map(function(s) { return s.user_id; })).size;

    // Share page performance
    var shareSaves = ctaList.filter(function(c) { return c.page === 'share_save'; });
    var saveHasExt = shareSaves.filter(function(c) { return c.button_position === 'has_extension'; }).length;
    var saveNoExt = shareSaves.filter(function(c) { return c.button_position === 'no_extension'; }).length;
    var saveDeepLink = shareSaves.filter(function(c) { return c.button_position === 'deep_link'; }).length;

    // Feature adoption
    var usersWithFolders = new Set(customFolderList.map(function(f) { return f.user_id; }).filter(function(id) { return !anonUserIds.has(id); })).size;
    var usersWhoShared = new Set(shareList.map(function(s) { return s.user_id; }).filter(function(id) { return id && !anonUserIds.has(id); })).size;
    var nudgeShown = nudgeList.filter(function(n) { return n.action === 'shown'; }).length;
    var nudgeClicked = nudgeList.filter(function(n) { return n.action === 'clicked'; }).length;

    // Uninstall reasons
    var reasons = {};
    uninstallList.forEach(function(u) { reasons[u.reason] = (reasons[u.reason] || 0) + 1; });

    // Retention (corrected: 21d at risk, 45d churned)
    var d1Ret = 0, d7Ret = 0, d30Ret = 0, totalD1 = 0, totalD7 = 0, totalD30 = 0;
    googleUsers.forEach(function(u) {
      if (!u.created_at) return;
      var created = new Date(u.created_at);
      var prof = profileList.find(function(p) { return p.id === u.id; });
      if (!prof || !prof.last_active_at) return;
      var lastActive = new Date(prof.last_active_at);
      var daysSinceCreated = (now - created) / 86400000;
      var daysBetween = (lastActive - created) / 86400000;
      if (daysSinceCreated >= 1) { totalD1++; if (daysBetween >= 1) d1Ret++; }
      if (daysSinceCreated >= 7) { totalD7++; if (daysBetween >= 7) d7Ret++; }
      if (daysSinceCreated >= 30) { totalD30++; if (daysBetween >= 30) d30Ret++; }
    });

    // At risk = 21-45 days inactive. Churned = 45+ days inactive (Google users only)
    var googleUserIds = new Set(googleUsers.map(function(u) { return u.id; }));
    var atRisk = profileList.filter(function(p) {
      if (!p.last_active_at) return false;
      if (!googleUserIds.has(p.id)) return false;
      return p.last_active_at < d21 && p.last_active_at >= d45;
    }).length;
    var churned = profileList.filter(function(p) {
      if (!p.last_active_at) return false;
      if (!googleUserIds.has(p.id)) return false;
      return p.last_active_at < d45;
    }).length;

    // Snip counts per user for power users
    var userSnipCounts = {};
    snipList.forEach(function(s) { userSnipCounts[s.user_id] = (userSnipCounts[s.user_id] || 0) + 1; });

    // User table (Google users only - the people you can identify and reach)
    var userTable = googleUsers.map(function(u) {
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
    });

    // Viral coefficient
    var viralCoeff = 0;
    if (totalUsers > 0 && pvShare > 0) {
      var shareToInstallRate = pvWelcome > 0 ? pvWelcome / pvShare : 0;
      viralCoeff = (shareList.length * shareToInstallRate) / totalUsers;
    }

    // Uninstall rate (monthly)
    var uninstallsThisMonth = uninstallList.filter(function(u) { return u.created_at && u.created_at >= d30; }).length;
    var monthlyUninstallRate = totalUsers > 0 ? Math.round((uninstallsThisMonth / (totalUsers + uninstallsThisMonth)) * 100) : 0;

    // Health scores (0 = no data, 1 = red, 2 = amber, 3 = green)
    function retScore(val, target) { if (val === null) return 0; return val >= target ? 3 : val >= target * 0.6 ? 2 : 1; }
    function funnelScore(val, target) { if (val === null) return 0; return val >= target ? 3 : val >= target * 0.6 ? 2 : 1; }
    function lowerIsBetter(val, target) { if (val === null) return 0; return val <= target ? 3 : val <= target * 1.5 ? 2 : 1; }

    var retD1 = totalD1 > 0 ? Math.round((d1Ret / totalD1) * 100) : null;
    var retD7 = totalD7 > 0 ? Math.round((d7Ret / totalD7) * 100) : null;
    var retD30 = totalD30 > 0 ? Math.round((d30Ret / totalD30) * 100) : null;
    var funnelLandingToCta = pvLanding > 0 ? Math.round((ctaCws / pvLanding) * 100) : null;
    var funnelInstallToSignup = pvWelcome > 0 ? Math.round((totalUsers / pvWelcome) * 100) : null;
    var funnelSignupToSnip = totalUsers > 0 ? Math.round((usersWithSnips / totalUsers) * 100) : null;
    var funnelFreeToProPct = totalUsers > 0 ? parseFloat(((proUsers / totalUsers) * 100).toFixed(1)) : null;

    var health = {
      retention_d1: { val: retD1, target: 50, score: retScore(retD1, 50) },
      retention_d7: { val: retD7, target: 30, score: retScore(retD7, 30) },
      retention_d30: { val: retD30, target: 20, score: retScore(retD30, 20) },
      stickiness: { val: stickiness, target: 15, score: retScore(stickiness, 15) },
      funnel_landing_cta: { val: funnelLandingToCta, target: 20, score: funnelScore(funnelLandingToCta, 20) },
      funnel_install_signup: { val: funnelInstallToSignup, target: 70, score: funnelScore(funnelInstallToSignup, 70) },
      funnel_signup_snip: { val: funnelSignupToSnip, target: 80, score: funnelScore(funnelSignupToSnip, 80) },
      funnel_free_pro: { val: funnelFreeToProPct, target: 3, score: funnelScore(funnelFreeToProPct, 3) },
      monthly_uninstall: { val: monthlyUninstallRate, target: 5, score: lowerIsBetter(monthlyUninstallRate, 5) },
      viral_coeff: { val: parseFloat(viralCoeff.toFixed(2)), target: 0.15, score: funnelScore(parseFloat(viralCoeff.toFixed(2)), 0.15) },
    };

    // Market value estimate (minimum floor)
    var arr = mrr * 12;
    var multiple = arr >= 60000 ? 4.5 : arr >= 12000 ? 3.5 : 2.5;
    var arrValuation = Math.round(arr * multiple);
    var marketValue = Math.max(5000, arrValuation);
    var bracket = arr >= 60000 ? '$60k+ ARR' : arr >= 12000 ? '$12k-$60k ARR' : arr < 1 ? 'pre-revenue' : 'under $12k ARR';

    // Anonymous user activity (from real snips table, not dead beacons)
    var activeAnons = profileList.filter(function(p) {
      return anonUserIds.has(p.id) && p.last_active_at && p.last_active_at >= d7;
    }).length;

    res.status(200).json({
      kpi: {
        total_users: totalUsers, wau: wau, mau: mau, dau: dau,
        stickiness: stickiness,
        total_snips: snipList.length, snips_week: snipWeekList.length,
        total_shares: shareList.length, shares_week: shareWeekList.length,
        mrr: mrr, pro_users: proUsers,
        uninstalls: uninstallList.length, users_week: usersThisWeek,
        churn_rate: monthlyUninstallRate,
      },
      funnel: {
        landing_views: pvLanding, cta_clicks: ctaCws,
        share_views: pvShare, save_clicks: shareSaves.length,
        installs: pvWelcome, signups: totalUsers,
        first_snip: usersWithSnips, pro: proUsers,
      },
      daily: {
        dates: dailyDates.map(function(d) { var p = d.split('-'); return p[1] + '/' + p[2]; }),
        snips: dailySnips, shares: dailyShares, users: dailyUsers,
      },
      retention: {
        d1: retD1 !== null ? retD1 : 0,
        d7: retD7 !== null ? retD7 : 0,
        d30: retD30 !== null ? retD30 : 0,
        at_risk: atRisk, churned: churned,
      },
      features: {
        created_snip: totalUsers > 0 ? Math.round((usersWithSnips / totalUsers) * 100) : 0,
        used_folders: totalUsers > 0 ? Math.round((usersWithFolders / totalUsers) * 100) : 0,
        shared: totalUsers > 0 ? Math.round((usersWhoShared / totalUsers) * 100) : 0,
        mcp_keys: keyList.length,
        nudge_shown: nudgeShown, nudge_clicked: nudgeClicked,
        nudge_rate: nudgeShown > 0 ? Math.round((nudgeClicked / nudgeShown) * 100) : 0,
      },
      share_perf: {
        views: pvShare, save_clicks: shareSaves.length,
        has_ext: saveHasExt, no_ext: saveNoExt, deep_link: saveDeepLink,
        viral_coeff: viralCoeff.toFixed(2),
      },
      revenue: {
        mrr: mrr, active_subs: proUsers,
        churned_subs: subList.filter(function(s) { return s.status === 'canceled'; }).length,
        arpu: totalUsers > 0 ? (mrr / totalUsers).toFixed(2) : '0.00',
        conversion: totalUsers > 0 ? ((proUsers / totalUsers) * 100).toFixed(1) : '0.0',
      },
      uninstall_reasons: reasons,
      power_users: userTable.slice().sort(function(a, b) { return b.snips - a.snips; }).slice(0, 5),
      recent_users: userTable.slice().sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); }).slice(0, 10),
      engagement: {
        avg_snips: totalUsers > 0 ? (snipList.length / totalUsers).toFixed(1) : '0',
        avg_snips_active: wau > 0 ? (snipWeekList.length / wau).toFixed(1) : '0',
        avg_shares: totalUsers > 0 ? (shareList.length / totalUsers).toFixed(1) : '0',
        avg_folders: totalUsers > 0 ? (customFolderList.length / totalUsers).toFixed(1) : '0',
      },
      health: health,
      targets: {
        retention_d1: 50, retention_d7: 30, retention_d30: 20,
        stickiness: 15, funnel_landing_cta: 20, funnel_install_signup: 70,
        funnel_signup_snip: 80, funnel_free_pro: 3,
        monthly_uninstall: 5, viral_coeff: 0.15,
      },
      valuation: {
        market_value: marketValue,
        arr: arr,
        multiple: multiple,
        bracket: bracket,
        mrr_used: mrr,
      },
      ghost: {
        total_anon: totalAnon,
        active_anons: activeAnons,
        anon_snips: anonSnips.length,
        anon_snips_week: anonSnipsWeek.length,
        anons_with_snips: anonsWithSnips,
        google_snips: googleSnips.length,
      },
    });
  } catch (e) {
    console.error('Analytics error:', e);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
};
