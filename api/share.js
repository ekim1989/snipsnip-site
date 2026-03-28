module.exports = async (req, res) => {
  const code = req.query.c;
  
  if (!code) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(errorPage('Invalid link', 'This share link appears to be broken.'));
  }

  try {
    const apiUrl = 'https://ghstrzodoyxokligldqn.supabase.co/functions/v1/share-view?code=' + encodeURIComponent(code);
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (data.error) {
      res.setHeader('Content-Type', 'text/html');
      return res.status(404).send(errorPage('Not found', data.error));
    }

    let ogTitle = 'Shared — SnipSnip';
    let ogDesc = 'Someone shared web captures with you via SnipSnip.';
    let ogImage = '';
    let bodyContent = '';

    if (data.type === 'snip') {
      const s = data.snip;
      ogTitle = s.title || s.hostname || 'Shared Snip';
      ogDesc = s.ai_summary || (s.note && s.note !== '(no note)' ? s.note.slice(0, 160) : 'Snipped from ' + (s.hostname || 'the web'));
      ogImage = s.screenshot_url || '';
      bodyContent = renderSnip(s);
    } else if (data.type === 'folder') {
      ogTitle = data.folder_name || 'Shared Folder';
      ogDesc = data.snip_count + ' snip' + (data.snip_count !== 1 ? 's' : '') + ' in "' + esc(data.folder_name) + '"';
      if (data.snips && data.snips.length > 0 && data.snips[0].screenshot_url) {
        ogImage = data.snips[0].screenshot_url;
      }
      bodyContent = renderFolder(data);
    }

    const html = buildPage(ogTitle, ogDesc, ogImage, code, bodyContent);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
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

function renderSnip(s) {
  var isNoNote = !s.note || s.note === '(no note)';
  var html = '<div class="ss">';
  if (s.screenshot_url) {
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
  var html = '<div class="card"><div class="ciw"' + (s.screenshot_url ? ' onclick="openLB(\'' + esc(s.screenshot_url) + '\')"' : '') + '>';
  if (s.screenshot_url) {
    html += '<img class="ci" src="' + esc(s.screenshot_url) + '" alt="" loading="lazy">';
  } else {
    html += '<div class="ci" style="display:flex;align-items:center;justify-content:center;color:#3f3f46;font-size:13px">No screenshot</div>';
  }
  html += '</div><div class="cb"><div class="cn' + (isNoNote ? ' nn' : '') + '">' + esc(isNoNote ? '(no note)' : s.note) + '</div>';
  html += '<div class="cm"><div class="cs"><a href="' + esc(s.url || '#') + '" target="_blank" rel="noopener">';
  html += '<img class="cf" src="' + esc(favicon) + '" alt=""><span class="cd">' + esc(domain) + '</span>';
  html += '<span>&middot; ' + formatDate(s.created_at) + '</span></a></div></div></div></div>';
  return html;
}

function errorPage(title, text) {
  return buildPage(title + ' — SnipSnip', text, '', '', '<div class="ep"><div class="ei">&#128279;</div><div class="et">' + esc(title) + '</div><div class="ex">' + esc(text) + '</div></div>');
}

function buildPage(ogTitle, ogDesc, ogImage, code, bodyContent) {
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
    '.cta{padding:8px 20px;background:#ff4d4d;color:#fff;font-size:13px;font-weight:600;border:none;border-radius:8px;cursor:pointer;text-decoration:none;font-family:inherit;transition:.15s;white-space:nowrap}.cta:hover{filter:brightness(.9)}' +
    '.sh{padding:32px 32px 0;max-width:1200px;margin:0 auto}.st{font-size:12px;color:#52525b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}' +
    '.sn{font-size:28px;font-weight:700;margin-bottom:8px}.sm{font-size:14px;color:#52525b;margin-bottom:24px}' +
    '.gr{padding:24px 32px 80px;max-width:1200px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}' +
    '.card{background:#18181b;border:1px solid rgba(255,255,255,.06);border-radius:14px;overflow:hidden;transition:transform .15s,box-shadow .15s}' +
    '.card:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,.3)}' +
    '.ciw{overflow:hidden;cursor:pointer}.ci{width:100%;aspect-ratio:16/10;object-fit:cover;display:block;background:#27272a}' +
    '.cb{padding:14px 16px}.cn{font-size:14px;color:#d4d4d8;line-height:1.5;margin-bottom:10px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}' +
    '.cn.nn{color:#3f3f46;font-style:italic}' +
    '.cm{display:flex;align-items:center;font-size:11px;color:#52525b}.cs{display:flex;align-items:center;gap:6px;overflow:hidden}' +
    '.cs a{color:#52525b;text-decoration:none;display:flex;align-items:center;gap:6px;overflow:hidden}.cs a:hover{color:#a1a1aa}' +
    '.cf{width:14px;height:14px;border-radius:3px;flex-shrink:0}.cd{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.ss{max-width:800px;margin:0 auto;padding:32px}.si{width:100%;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.4);margin-bottom:24px;background:#27272a;cursor:zoom-in}' +
    '.sno{font-size:18px;color:#d4d4d8;line-height:1.6;margin-bottom:16px}' +
    '.sr{display:flex;align-items:center;gap:8px;font-size:14px;color:#52525b}.sr a{color:#52525b;text-decoration:none}.sr a:hover{color:#a1a1aa;text-decoration:underline}' +
    '.ai{margin-top:16px;padding:16px;background:rgba(255,255,255,.03);border-radius:10px;border:1px solid rgba(255,255,255,.05)}' +
    '.al{font-size:11px;color:#52525b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}.at{font-size:14px;color:#a1a1aa;line-height:1.5}' +
    '.tp{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.tg{padding:3px 10px;background:rgba(255,77,77,.08);color:#ff4d4d;font-size:11px;border-radius:6px;font-weight:500}' +
    '.ep{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:120px 32px;text-align:center}' +
    '.ei{font-size:48px;margin-bottom:16px;opacity:.3}.et{font-size:20px;font-weight:600;color:#71717a;margin-bottom:8px}' +
    '.ex{font-size:14px;color:#3f3f46;max-width:400px;line-height:1.6}' +
    '.lb{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);cursor:zoom-out}' +
    '.lb img{max-width:90vw;max-height:85vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.5);cursor:default}' +
    '.lc{position:absolute;top:20px;right:24px;background:none;border:none;color:#71717a;font-size:28px;cursor:pointer;padding:8px;line-height:1}.lc:hover{color:#fff}' +
    '@media(max-width:640px){.bt{display:none}.sh{padding:24px 16px 0}.sn{font-size:22px}.gr{padding:16px 16px 80px;grid-template-columns:1fr}.ss{padding:16px}}' +
    '</style></head><body>' +
    '<div class="bn"><div class="bl"><div class="lo">Snip<span>Snip</span></div><div class="bt">Captured with SnipSnip — <strong>Never lose what you find online</strong></div></div>' +
    '<a href="https://snipsnip.ai' + (code ? '?ref=' + esc(code) : '') + '" class="cta">Get SnipSnip — Free</a></div>' +
    bodyContent +
    '<script>function openLB(s){if(!s)return;var l=document.createElement("div");l.className="lb";l.onclick=function(e){if(e.target===l)l.remove()};var c=document.createElement("button");c.className="lc";c.innerHTML="&times;";c.onclick=function(){l.remove()};l.appendChild(c);var i=document.createElement("img");i.src=s;i.onclick=function(e){e.stopPropagation()};l.appendChild(i);document.body.appendChild(l);document.addEventListener("keydown",function h(e){if(e.key==="Escape"){l.remove();document.removeEventListener("keydown",h)}})}</script>' +
    '</body></html>';
}
