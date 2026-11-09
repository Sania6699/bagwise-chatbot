var $ = function (id) { return document.getElementById(id); };

var LS = {
  get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

var ICON = {
  up: '<svg viewBox="0 0 24 24"><path d="M7 11v9H4v-9h3zM7 11l4-8c1.5 0 2.5 1 2.5 2.5V9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M17 13V4h3v9h-3zM17 13l-4 8c-1.5 0-2.5-1-2.5-2.5V15H5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.2 4H17"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>'
};

var NAME = { semantic: 'Semantic search', keyword: 'Keyword search (BM25)', hybrid: 'Hybrid search' };
var WHY = {
  semantic: 'No numbers in the question, so it matches by meaning.',
  keyword: 'A short question with a number, so it matches exact terms.',
  hybrid: 'A number plus a longer question, so it combines meaning and exact terms.'
};
var STAGE = { route: 'Choosing how to search...', search: 'Searching the documents...', write: 'Writing the answer...' };

var convs = LS.get('bw_convs', []);
convs.forEach(function (c) {
  c.messages.forEach(function (m) {
    if (m.role === 'bot' && !m.done) { m.done = true; m.error = 'This answer was interrupted.'; }
  });
});
var cur = null, busy = false, ctrl = null;
var mode = LS.get('bw_mode', 'auto');
var showHow = LS.get('bw_how', true);
var theme = LS.get('bw_theme', (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
document.documentElement.setAttribute('data-theme', theme);

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function save() { LS.set('bw_convs', convs.slice(0, 30)); }
function toast(t) {
  var el = $('toast');
  el.textContent = t;
  el.classList.add('show');
  setTimeout(function () { el.classList.remove('show'); }, 1800);
}

/* tiny markdown */
function inl(s) {
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]/g, '<strong>$1</strong>');
  return s.replace(/^([A-Z][^:<]{2,60}):\s/, '<strong>$1:</strong> ');
}
function md(t) {
  return esc(t).trim().split(/\n{2,}/).map(function (b) {
    var lines = b.split('\n');
    var isList = lines.every(function (l) { return /^\s*[-*\u2022]\s+/.test(l); });
    if (isList) {
      return '<ul>' + lines.map(function (l) { return '<li>' + inl(l.replace(/^\s*[-*\u2022]\s+/, '')) + '</li>'; }).join('') + '</ul>';
    }
    return '<p>' + lines.map(inl).join('<br>') + '</p>';
  }).join('');
}

/* scrolling */
var main = $('main');
function nearBottom() { return main.scrollHeight - main.scrollTop - main.clientHeight < 150; }
function jump() { main.scrollTop = main.scrollHeight; }
function follow() { if (nearBottom()) jump(); }
main.addEventListener('scroll', function () {
  $('toBottom').style.display = (main.scrollHeight - main.scrollTop - main.clientHeight > 240) ? 'block' : 'none';
});
$('toBottom').onclick = function () { main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' }); };

/* sidebar */
function openSide() { $('side').classList.add('open'); $('scrim').classList.add('show'); }
function closeSide() { $('side').classList.remove('open'); $('scrim').classList.remove('show'); }
$('menu').onclick = openSide;
$('scrim').onclick = function () { closeSide(); closeDrawer(); };

function renderHist() {
  var h = $('hist');
  h.innerHTML = '';
  if (!convs.length) { h.innerHTML = '<div class="nohist">No chats yet</div>'; return; }
  convs.forEach(function (c) {
    var d = document.createElement('div');
    d.className = 'hi' + (cur && cur.id === c.id ? ' on' : '');
    d.innerHTML = '<span class="ht">' + esc(c.title) + '</span><button class="del" data-del="1" title="Delete chat">&#215;</button>';
    d.onclick = function (e) {
      if (busy) return;
      if (e.target.getAttribute('data-del')) {
        convs = convs.filter(function (x) { return x.id !== c.id; });
        if (cur && cur.id === c.id) cur = null;
        save(); renderAll(); return;
      }
      cur = c; renderAll(); closeSide();
    };
    h.appendChild(d);
  });
}

/* settings */
function paintSettings() {
  document.querySelectorAll('#seg button').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-s') === mode);
  });
  $('showHow').checked = showHow;
}
$('seg').onclick = function (e) {
  var b = e.target.closest('button'); if (!b) return;
  mode = b.getAttribute('data-s'); LS.set('bw_mode', mode); paintSettings();
};
$('showHow').onchange = function (e) { showHow = e.target.checked; LS.set('bw_how', showHow); renderThread(); };
$('theme').onclick = function () {
  theme = theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  LS.set('bw_theme', theme);
};

/* source drawer */
function openDrawer(s, n) {
  $('dNum').textContent = n;
  $('dTitle').textContent = s.airline + ' \u00b7 ' + s.flight_type + ' flights';
  $('dFile').textContent = s.file;
  $('dText').textContent = s.text;
  $('drawer').classList.add('open');
  if (window.innerWidth <= 860) $('scrim').classList.add('show');
}
function closeDrawer() {
  $('drawer').classList.remove('open');
  if (!$('side').classList.contains('open')) $('scrim').classList.remove('show');
}
$('dclose').onclick = closeDrawer;
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeDrawer(); closeSide(); } });

/* rendering */
function srcHTML(m) {
  return '<span class="note">Based on ' + m.sources.length + ' passages</span>' +
    m.sources.map(function (s, i) {
      return '<button class="cite" data-a="cite" data-s="' + i + '"><span class="n">' + (i + 1) + '</span>' + esc(s.airline) + ' \u00b7 ' + esc(s.flight_type) + '</button>';
    }).join('');
}
function actionsHTML(m) {
  var last = cur && cur.messages[cur.messages.length - 1] === m;
  var h = '';
  if (!m.error) {
    h += '<button class="act" data-a="copy" title="Copy">' + ICON.copy + '</button>' +
      '<button class="act' + (m.fb === 'up' ? ' sel' : '') + '" data-a="up" title="Good answer">' + ICON.up + '</button>' +
      '<button class="act' + (m.fb === 'down' ? ' sel' : '') + '" data-a="down" title="Bad answer">' + ICON.down + '</button>';
  }
  if (last) h += '<button class="act" data-a="regen" title="Try again">' + ICON.redo + (m.error ? ' Try again' : '') + '</button>';
  return h;
}
function howHTML(m) {
  if (m.error || !m.strategy) return '';
  return '<button class="howbtn" data-a="how">How this answer was made <span class="car">&#8250;</span></button><div class="howbody">' +
    '<div class="hs"><b>1. Router</b>' + esc(NAME[m.strategy] || m.strategy) + '. ' + esc(m.why || '') + '</div>' +
    '<div class="hs"><b>2. Retriever</b>' + (m.sources ? m.sources.length : 0) + ' passages found in ' + (m.retr != null ? m.retr : '-') + 's</div>' +
    '<div class="hs"><b>3. Generator</b>A local model answers using only those passages. Total ' + (m.seconds != null ? m.seconds : '-') + 's</div></div>';
}
function paintAnswer(d, m) {
  var a = d.querySelector('.answer');
  if (m.error) {
    a.innerHTML = '<div class="nf"><div class="nf-t">Something went wrong</div>' + esc(m.error) + ' Check that the server is still running in your terminal.</div>';
    return;
  }
  if (!m.text) { a.innerHTML = ''; return; }
  if (m.done && m.refused) {
    a.innerHTML = '<div class="nf"><div class="nf-t">Not in my documents</div>' + md(m.text) +
      '<div class="nf-h">I only answer from the loaded policies, so I won\u2019t guess. Try asking about baggage allowance, power banks, liquids or prohibited items.</div></div>';
    return;
  }
  a.innerHTML = '<div class="md' + (m.done ? '' : ' typing') + '">' + md(m.text) + '</div>';
}
function paintBot(d, m) {
  var q = function (s) { return d.querySelector(s); };
  q('.status').innerHTML = (!m.done && !m.text) ? '<span class="dots"><i></i><i></i><i></i></span><span>' + (STAGE[m.stage] || '') + '</span>' : '';
  paintAnswer(d, m);
  q('.src').innerHTML = (m.done && !m.refused && !m.error && m.sources && m.sources.length) ? srcHTML(m) : '';
  q('.actions').innerHTML = m.done ? actionsHTML(m) : '';
  q('.how').innerHTML = (m.done && showHow) ? howHTML(m) : '';
}
function rowEl(m) {
  var d = document.createElement('div');
  d._m = m;
  if (m.role === 'user') {
    d.className = 'row user';
    d.innerHTML = '<div class="u">' + esc(m.text) + '</div>';
    return d;
  }
  d.className = 'row bot';
  d.innerHTML = '<div class="body"><div class="status"></div><div class="answer"></div><div class="src"></div><div class="actions"></div><div class="how"></div></div>';
  paintBot(d, m);
  return d;
}
function emptyHTML() {
  return '<div class="empty"><div class="empty-mark">B</div><h2>What can I help you with?</h2>' +
    '<p>Ask about baggage allowances, power banks, liquids and prohibited items for Air India and Emirates. Every answer shows its source.</p>' +
    '<div class="topics"><span>Cabin baggage</span><span>Checked baggage</span><span>Power banks</span><span>Liquids</span><span>Prohibited items</span></div></div>';
}
function renderThread() {
  var t = $('thread');
  t.innerHTML = '';
  var empty = !cur || !cur.messages.length;
  $('chat').classList.toggle('is-empty', empty);
  $('title').textContent = cur ? cur.title : '';
  if (empty) { t.innerHTML = emptyHTML(); return; }
  cur.messages.forEach(function (m) { t.appendChild(rowEl(m)); });
  jump();
}
function renderAll() { renderHist(); renderThread(); }

$('thread').addEventListener('click', function (e) {
  var b = e.target.closest('[data-a]'); if (!b) return;
  var row = b.closest('.row'); var m = row && row._m; if (!m) return;
  var a = b.getAttribute('data-a');
  if (a === 'cite') {
    var i = parseInt(b.getAttribute('data-s'), 10);
    openDrawer(m.sources[i], i + 1);
  } else if (a === 'copy') {
    navigator.clipboard.writeText(m.text).then(function () { toast('Copied to clipboard'); }).catch(function () { toast('Copy failed'); });
  } else if (a === 'regen') {
    regenerate();
  } else if (a === 'up' || a === 'down') {
    m.fb = (m.fb === a) ? null : a; save(); paintBot(row, m);
  } else if (a === 'how') {
    row.querySelector('.how').classList.toggle('open');
  }
});

/* composer */
var ta = $('q'), sendBtn = $('send');
function updateSend() {
  if (busy) { sendBtn.disabled = false; sendBtn.innerHTML = ICON.stop; sendBtn.title = 'Stop'; }
  else { sendBtn.innerHTML = ICON.send; sendBtn.title = 'Send'; sendBtn.disabled = !ta.value.trim(); }
}
function grow() {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  updateSend();
}
ta.addEventListener('input', grow);
ta.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!busy && ta.value.trim()) sendQuestion(ta.value);
  }
});
$('form').onsubmit = function (e) {
  e.preventDefault();
  if (busy) { if (ctrl) ctrl.abort(); return; }
  if (ta.value.trim()) sendQuestion(ta.value);
};
$('newChat').onclick = function () { if (busy) return; cur = null; renderAll(); closeSide(); ta.focus(); };

function regenerate() {
  if (busy || !cur) return;
  var msgs = cur.messages, last = msgs[msgs.length - 1];
  if (!last || last.role !== 'bot') return;
  msgs.pop();
  var u = msgs[msgs.length - 1];
  if (!u || u.role !== 'user') return;
  sendQuestion(u.text, true);
}

async function sendQuestion(question, regen) {
  if (busy) return;
  question = question.trim(); if (!question) return;
  if (!cur) {
    cur = { id: Date.now().toString(36), title: question.length > 42 ? question.slice(0, 42) + '...' : question, messages: [] };
    convs.unshift(cur);
  }
  if (!regen) cur.messages.push({ role: 'user', text: question });
  var m = { role: 'bot', text: '', stage: 'route', done: false, sources: [] };
  cur.messages.push(m);
  busy = true; ta.value = ''; grow();
  renderAll();
  var row = $('thread').lastElementChild;
  ctrl = new AbortController();
  try {
    var res = await fetch('/ask_stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question, strategy: mode }),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error('Server error ' + res.status + '.');
    var reader = res.body.getReader(), dec = new TextDecoder();
    var buf = '';
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      var lines = buf.split('\n'); buf = lines.pop();
      for (var k = 0; k < lines.length; k++) {
        if (!lines[k].trim()) continue;
        var ev = JSON.parse(lines[k]);
        if (ev.type === 'route') {
          m.strategy = ev.strategy;
          m.why = mode === 'auto' ? WHY[ev.strategy] : 'Chosen manually in settings.';
          m.stage = 'search'; paintBot(row, m);
        } else if (ev.type === 'sources') {
          m.sources = ev.sources; m.retr = ev.seconds; m.stage = 'write'; paintBot(row, m);
        } else if (ev.type === 'token') {
          m.text += ev.text;
          row.querySelector('.status').innerHTML = '';
          paintAnswer(row, m); follow();
        } else if (ev.type === 'done') {
          m.refused = ev.refused; m.seconds = ev.seconds; m.done = true; m.stage = 'done';
          paintBot(row, m); follow();
        }
      }
    }
    if (!m.done) { m.done = true; paintBot(row, m); }
  } catch (err) {
    if (err.name === 'AbortError') { m.done = true; if (!m.text) m.text = 'Stopped.'; paintBot(row, m); }
    else { m.error = err.message; m.done = true; paintBot(row, m); }
  }
  busy = false; ctrl = null; updateSend(); save(); renderHist(); ta.focus();
}

paintSettings();
renderAll();
grow();