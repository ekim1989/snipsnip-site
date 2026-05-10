const SUPABASE_URL = 'https://ghstrzodoyxokligldqn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdoc3Ryem9kb3l4b2tsaWdsZHFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NDQ3MDgsImV4cCI6MjA4OTEyMDcwOH0.fR6n6sCPphyum5yNxib0GvIWnGKKve4iboTEi7vq-cE';

async function getOwnerTier(code) {
  try {
    // Get user_id from shared_links by share_code
    const linkResp = await fetch(
      SUPABASE_URL + '/rest/v1/shared_links?share_code=eq.' + encodeURIComponent(code) + '&select=user_id&limit=1',
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY } }
    );
    const links = await linkResp.json();
    if (!Array.isArray(links) || links.length === 0) return 'free';

    // Get tier from profiles
    const profResp = await fetch(
      SUPABASE_URL + '/rest/v1/profiles?id=eq.' + links[0].user_id + '&select=tier&limit=1',
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY } }
    );
    const profiles = await profResp.json();
    if (!Array.isArray(profiles) || profiles.length === 0) return 'free';
    return profiles[0].tier || 'free';
  } catch {
    return 'free';
  }
}

module.exports = async (req, res) => {
  const code = req.query.c;

  if (!code) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(errorPage('Invalid link', 'This share link appears to be broken.'));
  }

  try {
    const apiUrl = 'https://ghstrzodoyxokligldqn.supabase.co/functions/v1/share-view?code=' + encodeURIComponent(code);

    // Retry up to 3 times if the share link returns "not found" — covers the
    // race window where a user clicks their freshly-copied video link before
    // the shared_links row has been inserted (~1-2 seconds typical).
    let data = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(apiUrl);
      data = await response.json();
      if (!data || !data.error) break;
      // Only retry on "not found" — other errors (auth, server) we surface immediately
      if (data.error && data.error.toLowerCase().indexOf('not found') === -1) break;
      if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
    }

    const ownerTier = await getOwnerTier(code);
    const isPro = ownerTier === 'pro';

    if (data && data.error) {
      res.setHeader('Content-Type', 'text/html');
      return res.status(404).send(errorPage('Not found', data.error));
    }

    let ogTitle = 'Shared — SnipSnip';
    let ogDesc = 'Someone shared web captures with you via SnipSnip.';
    let ogImage = '';
    let bodyContent = '';
    let needsPoll = false;

    if (data.type === 'snip') {
      const s = data.snip;
      const isVideo = s.snip_type === 'video';
      const isYoutube = s.snip_type === 'youtube';

      if (isYoutube) {
        const ytThumb = s.youtube_video_id
          ? 'https://img.youtube.com/vi/' + s.youtube_video_id + '/maxresdefault.jpg'
          : '';
        ogTitle = s.title || 'Shared YouTube breakdown';
        // Use first 200 chars of report when ready, else a generic fallback
        if (s.report && s.report.trim().length > 0) {
          // Strip markdown chars for description
          ogDesc = s.report
            .replace(/[#*`>_~\[\]]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 200);
        } else {
          ogDesc = 'AI-generated breakdown of a YouTube video, captured with SnipSnip.';
        }
        ogImage = ytThumb;
        bodyContent = renderYoutube(s);
        // Poll if the report is still being generated
        if (s.ai_status === 'pending' || s.ai_status === 'processing') {
          needsPoll = true;
        }
      } else {
        ogTitle = s.title || s.hostname || (isVideo ? 'Shared Video' : 'Shared Snip');
        ogDesc = s.ai_summary || (s.note && s.note !== '(no note)' ? s.note.slice(0, 160) : (isVideo ? 'Video captured from ' : 'Snipped from ') + (s.hostname || 'the web'));
        ogImage = s.screenshot_url || '';
        bodyContent = renderSnip(s);
        // If it's a video that hasn't finished uploading, the page will poll
        if (isVideo && !s.video_url) needsPoll = true;
      }
    } else if (data.type === 'folder') {
      ogTitle = data.folder_name || 'Shared Folder';
      ogDesc = data.snip_count + ' snip' + (data.snip_count !== 1 ? 's' : '') + ' in "' + esc(data.folder_name) + '"';
      if (data.snips && data.snips.length > 0 && data.snips[0].screenshot_url) {
        ogImage = data.snips[0].screenshot_url;
      }
      bodyContent = renderFolder(data);
    }

    const html = buildPage(ogTitle, ogDesc, ogImage, code, bodyContent, isPro, needsPoll);
    res.setHeader('Content-Type', 'text/html');
    // Don't cache while video is still processing — we want fresh data each request
    res.setHeader('Cache-Control', needsPoll ? 'no-store' : 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).send(html);

  } catch (e) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send(errorPage('Something went wrong', 'Could not load this shared content. Try again later.'));
  }
};

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  var d = new Date(isoStr);
  return String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0') + '/' + d.getFullYear();
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '';
  var sec = Math.round(ms / 1000);
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// Minimal, safe markdown to HTML converter for AI-generated reports.
// Escapes all input first, then translates a small whitelist of patterns:
// h1/h2/h3 headings, bold, italics, inline code, bullet lists, numbered lists,
// blockquotes, paragraphs. No raw HTML passes through.
function renderMarkdown(md) {
  if (!md) return '';
  // Normalize line endings, escape, then translate
  var src = String(md).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var lines = src.split('\n');
  var html = '';
  var i = 0;
  function escLine(t) { return esc(t); }
  function inline(t) {
    // Order matters: code first (literal), then bold, then italic, then links
    t = escLine(t);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function(_, label, url) {
      // Only allow http/https/mailto URLs; otherwise drop the link
      if (!/^(https?:|mailto:)/i.test(url)) return label;
      return '<a href="' + escLine(url) + '" target="_blank" rel="noopener">' + label + '</a>';
    });
    return t;
  }
  while (i < lines.length) {
    var line = lines[i];
    var trimmed = line.trim();
    if (trimmed === '') { i++; continue; }
    // Headings
    var hMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (hMatch) {
      var level = hMatch[1].length;
      html += '<h' + level + ' class="rh' + level + '">' + inline(hMatch[2]) + '</h' + level + '>';
      i++;
      continue;
    }
    // Blockquote
    if (trimmed.startsWith('> ')) {
      var bq = '';
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        bq += inline(lines[i].trim().slice(2)) + ' ';
        i++;
      }
      html += '<blockquote class="rb">' + bq.trim() + '</blockquote>';
      continue;
    }
    // Bullet list
    if (/^[-*]\s+/.test(trimmed)) {
      html += '<ul class="rl">';
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        var li = lines[i].trim().replace(/^[-*]\s+/, '');
        html += '<li>' + inline(li) + '</li>';
        i++;
      }
      html += '</ul>';
      continue;
    }
    // Numbered list
    if (/^\d+\.\s+/.test(trimmed)) {
      html += '<ol class="rl">';
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        var noli = lines[i].trim().replace(/^\d+\.\s+/, '');
        html += '<li>' + inline(noli) + '</li>';
        i++;
      }
      html += '</ol>';
      continue;
    }
    // Paragraph: gather contiguous non-empty, non-special lines
    var para = '';
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,3})\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('> ') &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim())
    ) {
      para += (para ? ' ' : '') + lines[i].trim();
      i++;
    }
    if (para) html += '<p class="rp">' + inline(para) + '</p>';
  }
  return html;
}

function renderYoutube(s) {
  var thumb = s.youtube_video_id
    ? 'https://img.youtube.com/vi/' + s.youtube_video_id + '/maxresdefault.jpg'
    : '';
  var watchUrl = s.youtube_url || (s.youtube_video_id
    ? 'https://www.youtube.com/watch?v=' + s.youtube_video_id
    : '#');
  var title = s.title || 'YouTube video';

  var html = '<div class="ss yt">';

  // Hero: thumbnail with play overlay, links to YouTube
  html += '<a class="yt-hero" href="' + esc(watchUrl) + '" target="_blank" rel="noopener" aria-label="Watch on YouTube">';
  if (thumb) {
    html += '<img class="yt-thumb" src="' + esc(thumb) + '" alt="" onerror="this.onerror=null;this.src=\'https://img.youtube.com/vi/' + esc(s.youtube_video_id || '') + '/hqdefault.jpg\'">';
  } else {
    html += '<div class="yt-thumb yt-thumb-empty"></div>';
  }
  html += '<div class="yt-play"><svg viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div>';
  html += '</a>';

  // Title + watch link
  html += '<h1 class="yt-title">' + esc(title) + '</h1>';
  html += '<a class="yt-watch" href="' + esc(watchUrl) + '" target="_blank" rel="noopener">';
  html += '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="vertical-align:-2px;margin-right:6px"><path d="M21.6 7.2c-.2-.9-.9-1.6-1.8-1.8C18 5 12 5 12 5s-6 0-7.8.4c-.9.2-1.6.9-1.8 1.8C2 9 2 12 2 12s0 3 .4 4.8c.2.9.9 1.6 1.8 1.8C6 19 12 19 12 19s6 0 7.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.8.4-4.8.4-4.8s0-3-.4-4.8zM10 15V9l5 3-5 3z"/></svg>';
  html += 'Watch on YouTube</a>';

  // Report body
  html += '<div class="yt-report">';
  html += '<div class="yt-report-label">AI breakdown</div>';
  if (s.ai_status === 'report_ready' || s.ai_status === 'lens_applied') {
    if (s.report && s.report.trim().length > 0) {
      html += '<div class="yt-report-body">' + renderMarkdown(s.report) + '</div>';
    } else {
      html += '<div class="yt-report-empty">Report unavailable for this video.</div>';
    }
  } else if (s.ai_status === 'pending' || s.ai_status === 'processing') {
    html += '<div class="yt-report-proc">';
    html += '<div class="sv-proc-spinner"></div>';
    html += '<div class="yt-proc-text">Generating breakdown</div>';
    html += '<div class="yt-proc-sub">This usually takes under a minute. The page will refresh automatically.</div>';
    html += '</div>';
  } else {
    // failed, unknown, or null
    html += '<div class="yt-report-empty">A breakdown isn\u2019t available for this video.</div>';
  }
  html += '</div>'; // /yt-report

  html += '</div>'; // /ss
  return html;
}

function renderSnip(s) {
  var isNoNote = !s.note || s.note === '(no note)';
  var isVideo = s.snip_type === 'video';
  var html = '<div class="ss">';

  if (isVideo) {
    if (s.video_url) {
      // Video is uploaded — render the player
      html += '<video class="sv-vid" controls autoplay playsinline preload="metadata"';
      if (s.screenshot_url) html += ' poster="' + esc(s.screenshot_url) + '"';
      html += '><source src="' + esc(s.video_url) + '" type="video/webm">';
      html += 'Your browser does not support video playback.</video>';
    } else {
      // Still uploading — show processing state. Client script will poll and reload.
      html += '<div class="sv-proc">';
      if (s.screenshot_url) {
        html += '<img class="sv-proc-thumb" src="' + esc(s.screenshot_url) + '" alt="">';
      }
      html += '<div class="sv-proc-overlay">';
      html += '<div class="sv-proc-spinner"></div>';
      html += '<div class="sv-proc-text">Video is processing</div>';
      html += '<div class="sv-proc-sub">This page will refresh automatically</div>';
      html += '</div></div>';
    }
  } else if (s.screenshot_url) {
    html += '<img class="si" src="' + esc(s.screenshot_url) + '" alt="Screenshot" onclick="openLB(this.src)">';
  }

  if (!isNoNote) {
    html += '<div class="sno">' + esc(s.note) + '</div>';
  }
  html += '<div class="sr">';
  if (s.hostname) {
    html += '<img class="cf" src="https://www.google.com/s2/favicons?domain=' + esc(s.hostname) + '&sz=32" alt="">';
    html += '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.hostname) + '</a>';
  }
  if (s.created_at) html += '<span>&middot; ' + formatDate(s.created_at) + '</span>';
  html += '</div>';
  if (s.ai_summary) {
    html += '<div class="ai"><div class="al">AI Summary</div><div class="at">' + esc(s.ai_summary) + '</div>';
    if (s.ai_topics && s.ai_topics.length) {
      html += '<div class="tp">';
      s.ai_topics.forEach(function(t) { html += '<span class="tg">' + esc(t) + '</span>'; });
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderFolder(data) {
  var html = '<div class="sh"><div class="st">Shared Folder</div><div class="sn">' + esc(data.folder_name) + '</div>';
  html += '<div class="sm">' + data.snip_count + ' snip' + (data.snip_count !== 1 ? 's' : '') + '</div></div>';
  if (data.snips && data.snips.length > 0) {
    html += '<div class="gr">';
    data.snips.forEach(function(s) { html += renderCard(s); });
    html += '</div>';
  } else {
    html += '<div class="ep"><div class="ei">&#128194;</div><div class="et">This folder is empty</div></div>';
  }
  return html;
}

function renderCard(s) {
  var domain = s.hostname || 'unknown';
  var favicon = 'https://www.google.com/s2/favicons?domain=' + domain + '&sz=32';
  var isNoNote = !s.note || s.note === '(no note)';
  var isVideo = s.snip_type === 'video';
  var html = '<div class="card"><div class="ciw"';
  if (isVideo && s.video_url) {
    html += ' onclick="openVideoLB(\'' + esc(s.video_url) + '\')"';
  } else if (s.screenshot_url) {
    html += ' onclick="openLB(\'' + esc(s.screenshot_url) + '\')"';
  }
  html += '>';
  if (s.screenshot_url) {
    html += '<img class="ci" src="' + esc(s.screenshot_url) + '" alt="" loading="lazy">';
  } else {
    html += '<div class="ci" style="display:flex;align-items:center;justify-content:center;color:#3f3f46;font-size:13px">No screenshot</div>';
  }
  if (isVideo) {
    html += '<div class="vp"><svg viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div>';
    if (s.duration_ms) {
      html += '<div class="vd">' + formatDuration(s.duration_ms) + '</div>';
    }
  }
  html += '</div><div class="cb"><div class="cn' + (isNoNote ? ' nn' : '') + '">' + esc(isNoNote ? '(no note)' : s.note) + '</div>';
  html += '<div class="cm"><div class="cs"><a href="' + esc(s.url || '#') + '" target="_blank" rel="noopener">';
  html += '<img class="cf" src="' + esc(favicon) + '" alt=""><span class="cd">' + esc(domain) + '</span>';
  html += '<span>&middot; ' + formatDate(s.created_at) + '</span></a></div></div></div></div>';
  return html;
}

function errorPage(title, text) {
  return buildPage(title + ' — SnipSnip', text, '', '', '<div class="ep"><div class="ei">&#128279;</div><div class="et">' + esc(title) + '</div><div class="ex">' + esc(text) + '</div></div>', false, false);
}

function buildPage(ogTitle, ogDesc, ogImage, code, bodyContent, isPro, needsPoll) {
  var refParam = code ? '?ref=' + esc(code) : '';
  var cwsUrl = 'https://chromewebstore.google.com/detail/snipsnip-%E2%80%94-instant-screen/knbeidebbhkhjfjchjknaolkdfjdnemc';

  var topBar = isPro ? '' :
    '<div class="bn"><div class="bl"><div class="lo">Snip<span>Snip</span></div><div class="bt">Captured with SnipSnip — <strong>Never lose what you find online</strong></div></div>' +
    '<a href="' + cwsUrl + '" class="cta" target="_blank" rel="noopener">Get SnipSnip — Free</a></div>';

  // Save section shows for ALL users (free and pro)
  var saveSection = code ?
    '<div class="sv">' +
      '<div class="sv-inner">' +
        '<div class="sv-title">Want to keep this?</div>' +
        '<div class="sv-text">Save it to your SnipSnip library in one click</div>' +
        '<button class="sv-btn" id="saveSnipBtn">' +
          '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>' +
          'Save this Snip' +
        '</button>' +
        '<div class="sv-done" id="saveDone" style="display:none">' +
          '<svg width="18" height="18" fill="none" stroke="#22c55e" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' +
          'Saved!' +
        '</div>' +
      '</div>' +
    '</div>' : '';

  var bottomCta = isPro ? '' :
    '<div class="bc">' +
      '<div class="bc-inner">' +
        '<div class="lo" style="font-size:24px;margin-bottom:8px">Snip<span>Snip</span></div>' +
        '<div class="bc-text">Capture anything on the web. Share it instantly. AI organizes everything.</div>' +
        '<a href="' + cwsUrl + '" class="cta" style="padding:12px 28px;font-size:14px" target="_blank" rel="noopener">Get SnipSnip — Free</a>' +
        '<div class="bc-note">Free Chrome Extension</div>' +
      '</div>' +
    '</div>';

  // Polling script:
  //   - Video snips: refresh when video_url lands
  //   - YouTube snips: refresh when ai_status flips to ready
  var pollScript = needsPoll ?
    '(function(){var tries=0;var maxTries=40;var pollUrl="' + SUPABASE_URL + '/functions/v1/share-view?code=' + esc(code || '') + '";' +
    'var poll=function(){tries++;if(tries>maxTries)return;' +
    'fetch(pollUrl).then(function(r){return r.json()}).then(function(d){' +
    'var s=d&&d.snip;' +
    'var ready=s&&(s.video_url||s.ai_status==="report_ready"||s.ai_status==="lens_applied");' +
    'if(ready){window.location.reload()}else{setTimeout(poll,3000)}' +
    '}).catch(function(){setTimeout(poll,3000)})};' +
    'setTimeout(poll,3000)})();'
    : '';

  return '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' +
    '<title>' + esc(ogTitle) + ' — SnipSnip</title>' +
    '<meta name="description" content="' + esc(ogDesc) + '">' +
    '<meta property="og:title" content="' + esc(ogTitle) + '">' +
    '<meta property="og:description" content="' + esc(ogDesc) + '">' +
    '<meta property="og:type" content="website">' +
    '<meta property="og:site_name" content="SnipSnip">' +
    '<meta property="og:url" content="https://snipsnip.ai/share?c=' + esc(code) + '">' +
    (ogImage ? '<meta property="og:image" content="' + esc(ogImage) + '"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="' + esc(ogImage) + '">' : '<meta name="twitter:card" content="summary">') +
    '<meta name="twitter:title" content="' + esc(ogTitle) + '">' +
    '<meta name="twitter:description" content="' + esc(ogDesc) + '">' +
    '<link rel="icon" href="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'><text y=\'.9em\' font-size=\'90\'>&#9986;&#65039;</text></svg>">' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{background:#09090b;color:#e4e4e7;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
    '.bn{background:linear-gradient(135deg,#18181b,#1a1a2e);border-bottom:1px solid rgba(255,255,255,.05);padding:12px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;backdrop-filter:blur(20px)}' +
    '.bl{display:flex;align-items:center;gap:12px}.lo{font-size:18px;font-weight:700;letter-spacing:-.5px}.lo span{color:#ff4d4d}' +
    '.bt{font-size:13px;color:#71717a}.bt strong{color:#a1a1aa}' +
    '.cta{padding:8px 20px;background:#ff4d4d;color:#fff;font-size:13px;font-weight:600;border:none;border-radius:8px;cursor:pointer;text-decoration:none;font-family:inherit;transition:.15s;white-space:nowrap;display:inline-block}.cta:hover{filter:brightness(.9)}' +
    '.sh{padding:32px 32px 0;max-width:1200px;margin:0 auto}.st{font-size:12px;color:#52525b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}' +
    '.sn{font-size:28px;font-weight:700;margin-bottom:8px}.sm{font-size:14px;color:#52525b;margin-bottom:24px}' +
    '.gr{padding:24px 32px 40px;max-width:1200px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}' +
    '.card{background:#18181b;border:1px solid rgba(255,255,255,.06);border-radius:14px;overflow:hidden;transition:transform .15s,box-shadow .15s}' +
    '.card:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,.3)}' +
    '.ciw{position:relative;overflow:hidden;cursor:pointer}.ci{width:100%;aspect-ratio:16/10;object-fit:cover;display:block;background:#27272a}' +
    '.vp{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:48px;height:48px;border-radius:50%;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;pointer-events:none;backdrop-filter:blur(4px);transition:background .15s,transform .15s}' +
    '.ciw:hover .vp{background:rgba(255,77,77,.85);transform:translate(-50%,-50%) scale(1.08)}' +
    '.vp svg{width:22px;height:22px;margin-left:3px}' +
    '.vd{position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,.75);color:#fff;font-size:11px;font-weight:600;padding:3px 7px;border-radius:4px;font-variant-numeric:tabular-nums;backdrop-filter:blur(4px);pointer-events:none}' +
    '.cb{padding:14px 16px}.cn{font-size:14px;color:#d4d4d8;line-height:1.5;margin-bottom:10px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}' +
    '.cn.nn{color:#3f3f46;font-style:italic}' +
    '.cm{display:flex;align-items:center;font-size:11px;color:#52525b}.cs{display:flex;align-items:center;gap:6px;overflow:hidden}' +
    '.cs a{color:#52525b;text-decoration:none;display:flex;align-items:center;gap:6px;overflow:hidden}.cs a:hover{color:#a1a1aa}' +
    '.cf{width:14px;height:14px;border-radius:3px;flex-shrink:0}.cd{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.ss{max-width:800px;margin:0 auto;padding:32px}.si{width:100%;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.4);margin-bottom:24px;background:#27272a;cursor:zoom-in}' +
    '.sv-vid{width:100%;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.4);margin-bottom:24px;background:#000;display:block}' +
    '.sv-proc{position:relative;width:100%;border-radius:14px;overflow:hidden;background:#27272a;margin-bottom:24px;aspect-ratio:16/10;box-shadow:0 12px 40px rgba(0,0,0,.4)}' +
    '.sv-proc-thumb{width:100%;height:100%;object-fit:cover;display:block;filter:blur(8px) brightness(.5)}' +
    '.sv-proc-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center;padding:24px}' +
    '.sv-proc-spinner{width:40px;height:40px;border:3px solid rgba(255,255,255,.2);border-top-color:#ff4d4d;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:16px}' +
    '@keyframes spin{to{transform:rotate(360deg)}}' +
    '.sv-proc-text{font-size:16px;font-weight:600;margin-bottom:4px}' +
    '.sv-proc-sub{font-size:13px;color:#a1a1aa}' +
    '.sno{font-size:18px;color:#d4d4d8;line-height:1.6;margin-bottom:16px}' +
    '.sr{display:flex;align-items:center;gap:8px;font-size:14px;color:#52525b}.sr a{color:#52525b;text-decoration:none}.sr a:hover{color:#a1a1aa;text-decoration:underline}' +
    '.ai{margin-top:16px;padding:16px;background:rgba(255,255,255,.03);border-radius:10px;border:1px solid rgba(255,255,255,.05)}' +
    '.al{font-size:11px;color:#52525b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}.at{font-size:14px;color:#a1a1aa;line-height:1.5}' +
    '.tp{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.tg{padding:3px 10px;background:rgba(255,77,77,.08);color:#ff4d4d;font-size:11px;border-radius:6px;font-weight:500}' +
    '.ep{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:120px 32px;text-align:center}' +
    '.ei{font-size:48px;margin-bottom:16px;opacity:.3}.et{font-size:20px;font-weight:600;color:#71717a;margin-bottom:8px}' +
    '.ex{font-size:14px;color:#3f3f46;max-width:400px;line-height:1.6}' +
    '.sv{margin:0 24px;padding:20px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;text-align:center}' +
    '.sv-inner{max-width:400px;margin:0 auto}' +
    '.sv-title{font-size:14px;color:#e4e4e7;font-weight:600;margin-bottom:4px}' +
    '.sv-text{font-size:12px;color:#52525b;margin-bottom:14px}' +
    '.sv-btn{padding:10px 28px;background:#ff4d4d;color:#fff;font-size:13px;font-weight:600;border:none;border-radius:8px;cursor:pointer;font-family:inherit;transition:.15s;display:inline-flex;align-items:center;gap:8px}.sv-btn:hover{filter:brightness(.9)}' +
    '.sv-done{display:inline-flex;align-items:center;gap:6px;font-size:14px;color:#22c55e;font-weight:600}' +
    '.bc{border-top:1px solid rgba(255,255,255,.05);padding:48px 24px 56px;text-align:center}' +
    '.bc-inner{max-width:400px;margin:0 auto}' +
    '.bc-text{font-size:15px;color:#71717a;line-height:1.6;margin-bottom:20px}' +
    '.bc-note{margin-top:12px;font-size:12px;color:#3f3f46}' +
    '.lb{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);cursor:zoom-out}' +
    '.lb img{max-width:90vw;max-height:85vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.5);cursor:default}' +
    '.lb video{max-width:90vw;max-height:85vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.5);background:#000}' +
    '.lc{position:absolute;top:20px;right:24px;background:none;border:none;color:#71717a;font-size:28px;cursor:pointer;padding:8px;line-height:1}.lc:hover{color:#fff}' +
    '@media(max-width:640px){.bt{display:none}.sh{padding:24px 16px 0}.sn{font-size:22px}.gr{padding:16px 16px 40px;grid-template-columns:1fr}.ss{padding:16px}.sv{margin:0 16px}.yt-title{font-size:22px}.yt-report{padding:18px}}' +
    // YouTube share-page styles
    '.ss.yt{max-width:760px}' +
    '.yt-hero{position:relative;display:block;width:100%;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:#000;box-shadow:0 12px 40px rgba(0,0,0,.4);margin-bottom:20px;cursor:pointer}' +
    '.yt-thumb{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s,filter .2s}' +
    '.yt-thumb-empty{background:linear-gradient(135deg,#27272a,#18181b)}' +
    '.yt-hero:hover .yt-thumb{transform:scale(1.02);filter:brightness(.85)}' +
    '.yt-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:72px;height:72px;border-radius:50%;background:rgba(255,77,77,.92);display:flex;align-items:center;justify-content:center;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.4);transition:transform .2s,background .2s}' +
    '.yt-hero:hover .yt-play{transform:translate(-50%,-50%) scale(1.08);background:#ff4d4d}' +
    '.yt-play svg{width:30px;height:30px;margin-left:4px}' +
    '.yt-title{font-size:26px;font-weight:700;line-height:1.3;letter-spacing:-.3px;margin-bottom:10px;color:#f4f4f5}' +
    '.yt-watch{display:inline-flex;align-items:center;font-size:13px;color:#a1a1aa;text-decoration:none;margin-bottom:24px;padding:6px 12px;border:1px solid rgba(255,255,255,.08);border-radius:8px;transition:.15s}' +
    '.yt-watch:hover{color:#fff;border-color:rgba(255,77,77,.4);background:rgba(255,77,77,.06)}' +
    '.yt-report{margin-top:8px;padding:24px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06);border-radius:12px}' +
    '.yt-report-label{font-size:11px;color:#52525b;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;margin-bottom:14px;display:flex;align-items:center;gap:6px}' +
    '.yt-report-label::before{content:"";width:6px;height:6px;border-radius:50%;background:#ff4d4d;display:inline-block}' +
    '.yt-report-body{color:#d4d4d8;font-size:15px;line-height:1.7}' +
    '.yt-report-body .rh1{font-size:22px;font-weight:700;color:#f4f4f5;margin:24px 0 10px;letter-spacing:-.2px}' +
    '.yt-report-body .rh2{font-size:18px;font-weight:700;color:#f4f4f5;margin:22px 0 8px;letter-spacing:-.2px}' +
    '.yt-report-body .rh3{font-size:15px;font-weight:600;color:#e4e4e7;margin:18px 0 6px}' +
    '.yt-report-body .rh1:first-child,.yt-report-body .rh2:first-child,.yt-report-body .rh3:first-child{margin-top:0}' +
    '.yt-report-body .rp{margin:10px 0}' +
    '.yt-report-body .rl{margin:10px 0;padding-left:22px}' +
    '.yt-report-body .rl li{margin:6px 0}' +
    '.yt-report-body .rb{margin:14px 0;padding:10px 14px;border-left:3px solid #ff4d4d;background:rgba(255,77,77,.05);color:#a1a1aa;font-style:italic;border-radius:0 6px 6px 0}' +
    '.yt-report-body code{background:rgba(255,255,255,.06);padding:1px 6px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;color:#e4e4e7}' +
    '.yt-report-body strong{color:#f4f4f5;font-weight:600}' +
    '.yt-report-body a{color:#ff8585;text-decoration:underline;text-underline-offset:2px}' +
    '.yt-report-body a:hover{color:#ff4d4d}' +
    '.yt-report-empty{font-size:14px;color:#71717a;font-style:italic}' +
    '.yt-report-proc{display:flex;flex-direction:column;align-items:center;text-align:center;padding:32px 16px}' +
    '.yt-report-proc .sv-proc-spinner{margin-bottom:14px}' +
    '.yt-proc-text{font-size:15px;font-weight:600;color:#e4e4e7;margin-bottom:4px}' +
    '.yt-proc-sub{font-size:13px;color:#71717a;max-width:340px;line-height:1.5}' +
    '</style></head><body>' +
    topBar +
    bodyContent +
    saveSection +
    bottomCta +
    '<script>' +
    'navigator.sendBeacon("/api/view",new Blob([JSON.stringify({page:"share",referrer:document.referrer||null})],{type:"application/json"}));' +
    'function openLB(s){if(!s)return;var l=document.createElement("div");l.className="lb";l.onclick=function(e){if(e.target===l)l.remove()};var c=document.createElement("button");c.className="lc";c.innerHTML="&times;";c.onclick=function(){l.remove()};l.appendChild(c);var i=document.createElement("img");i.src=s;i.onclick=function(e){e.stopPropagation()};l.appendChild(i);document.body.appendChild(l);document.addEventListener("keydown",function h(e){if(e.key==="Escape"){l.remove();document.removeEventListener("keydown",h)}})}' +
    'function openVideoLB(s){if(!s)return;var l=document.createElement("div");l.className="lb";l.onclick=function(e){if(e.target===l)l.remove()};var c=document.createElement("button");c.className="lc";c.innerHTML="&times;";c.onclick=function(){l.remove()};l.appendChild(c);var v=document.createElement("video");v.src=s;v.controls=true;v.autoplay=true;v.playsInline=true;v.onclick=function(e){e.stopPropagation()};l.appendChild(v);document.body.appendChild(l);document.addEventListener("keydown",function h(e){if(e.key==="Escape"){l.remove();document.removeEventListener("keydown",h)}})}' +
    'var saveBtn=document.getElementById("saveSnipBtn");' +
    'if(saveBtn){saveBtn.onclick=function(){' +
      'var hasExt=document.documentElement.dataset.snipsnip==="installed";' +
      'var code="' + esc(code || '') + '";' +
      'navigator.sendBeacon("/api/cta",new Blob([JSON.stringify({page:"share_save",button_position:hasExt?"has_extension":"no_extension",share_code:code})],{type:"application/json"}));' +
      'if(hasExt){' +
        'window.dispatchEvent(new CustomEvent("snipsnip-save",{detail:{code:code}}));' +
        'saveBtn.style.display="none";' +
        'document.getElementById("saveDone").style.display="inline-flex";' +
      '}else{' +
        'try{localStorage.setItem("ss_pending_save",code)}catch(e){}' +
        'window.open("' + cwsUrl + '","_blank");' +
      '}' +
    '}}' +
    pollScript +
    '</script>' +
    '</body></html>';
}
