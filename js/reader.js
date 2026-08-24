/* ============================================================
   E-Ink EPUB Reader — Kobo-style
   ============================================================ */

'use strict';

var book      = null;
var rendition = null;
var settings  = loadSettings();

// ---- DOM ----
var $ = function(id) { return document.getElementById(id); };
var screenLanding  = $('screen-landing');
var screenReader   = $('screen-reader');
var readerWrap     = $('reader-wrap');
var readerEl       = $('reader');
var fileInput      = $('epub-file-input');
var uploadBtn      = $('upload-btn');
var bookTitleEl    = $('book-title');
var progressFill   = $('progress-fill');
var progressLabel  = $('progress-label');
var errorBanner    = $('error-banner');
var chromeTop      = $('chrome-top');
var chromeBottom   = $('chrome-bottom');
var btnPrev        = $('btn-prev');
var btnNext        = $('btn-next');
var btnMenu        = $('btn-menu');
var btnSettings    = $('btn-settings');
var panelToc       = $('panel-toc');
var panelSettings  = $('panel-settings');
var backdrop       = $('backdrop');
var tocClose       = $('toc-close');
var settingsClose  = $('settings-close');
var tocList        = $('toc-list');
var fontSmaller    = $('font-smaller');
var fontBigger     = $('font-bigger');
var fontSizeVal    = $('font-size-val');
var savedBookRow   = $('saved-book-row');
var savedBookName  = $('saved-book-name');
var btnResume      = $('btn-resume');
var urlInput       = $('url-input');
var btnUrlLoad     = $('btn-url-load');
var landingDivider = $('landing-divider');

if (typeof ePub === 'undefined') showError('epub.js failed to load — please refresh.');

// ============================================================
// ERROR
// ============================================================
function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.style.display = 'block';
  console.error('[reader]', msg);
}
function hideError() { errorBanner.style.display = 'none'; }

// ============================================================
// INDEXEDDB — store full epub binary so it survives page close
// ============================================================
var DB_NAME    = 'eink-reader';
var DB_VERSION = 1;
var DB_STORE   = 'books';
var db         = null;

function openDB() {
  return new Promise(function(resolve, reject) {
    if (db) { resolve(db); return; }
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function(e) {
      e.target.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = function(e) { db = e.target.result; resolve(db); };
    req.onerror   = function(e) { reject(e.target.error); };
  });
}

function dbPut(key, value) {
  return openDB().then(function(d) {
    return new Promise(function(resolve, reject) {
      var tx  = d.transaction(DB_STORE, 'readwrite');
      var req = tx.objectStore(DB_STORE).put(value, key);
      req.onsuccess = function() { resolve(); };
      req.onerror   = function(e) { reject(e.target.error); };
    });
  });
}

function dbGet(key) {
  return openDB().then(function(d) {
    return new Promise(function(resolve, reject) {
      var tx  = d.transaction(DB_STORE, 'readonly');
      var req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = function(e) { resolve(e.target.result); };
      req.onerror   = function(e) { reject(e.target.error); };
    });
  });
}

// ============================================================
// SETTINGS PERSISTENCE (localStorage)
// ============================================================
var LS = 'eink_v2';

function defaultSettings() {
  return { fontSize: 18, fontFamily: "Georgia, 'Times New Roman', serif",
           lineSpacing: 1.72, margin: '32px', theme: 'paper' };
}

function loadSettings() {
  try {
    var s = JSON.parse(localStorage.getItem(LS + '_settings'));
    return s ? Object.assign(defaultSettings(), s) : defaultSettings();
  } catch(e) { return defaultSettings(); }
}

function saveSettings() {
  try { localStorage.setItem(LS + '_settings', JSON.stringify(settings)); } catch(e) {}
}

function loadBookMeta() {
  try { return JSON.parse(localStorage.getItem(LS + '_meta')) || null; } catch(e) { return null; }
}

function saveBookMeta(name, key) {
  try { localStorage.setItem(LS + '_meta', JSON.stringify({ name: name, key: key })); } catch(e) {}
}

function loadBookPos(key) {
  try { var d = JSON.parse(localStorage.getItem(LS + '_pos_' + key)); return d ? d.cfi : undefined; }
  catch(e) { return undefined; }
}

function saveBookPos(key, cfi) {
  try { localStorage.setItem(LS + '_pos_' + key, JSON.stringify({ cfi: cfi })); } catch(e) {}
}

// ============================================================
// THEMES
// ============================================================
var THEMES = {
  paper: { paper: '#e8e4d8', ink: '#1a1a1a', inkMid: '#555' },
  warm:  { paper: '#f5ead0', ink: '#2a1a00', inkMid: '#7a5a30' },
  night: { paper: '#1a1a1a', ink: '#c8c8c8', inkMid: '#888' },
};

function applyDocumentTheme(name) {
  var t = THEMES[name] || THEMES.paper;
  var r = document.documentElement.style;
  r.setProperty('--paper',     t.paper);
  r.setProperty('--ink',       t.ink);
  r.setProperty('--ink-mid',   t.inkMid);
  r.setProperty('--ink-light', t.inkMid);
  document.body.style.background = t.paper;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t.paper;
}

function buildIframeCSS() {
  var t = THEMES[settings.theme] || THEMES.paper;
  var m = settings.margin;
  return [
    'html { background:' + t.paper + ' !important; }',
    'body {',
    '  background:' + t.paper + ' !important;',
    '  color:' + t.ink + ' !important;',
    '  font-family:' + settings.fontFamily + ' !important;',
    '  font-size:' + settings.fontSize + 'px !important;',
    '  line-height:' + settings.lineSpacing + ' !important;',
    '  margin: 12px ' + m + ' !important;',
    '  padding: 0 !important;',
    '}',
    'p, li, td, th, blockquote, div {',
    '  font-size:' + settings.fontSize + 'px !important;',
    '  line-height:' + settings.lineSpacing + ' !important;',
    '  color:' + t.ink + ' !important;',
    '  text-align: justify !important;',
    '  -webkit-hyphens: auto !important; hyphens: auto !important;',
    '  margin-bottom: 0.85em !important;',
    '  orphans: 2 !important; widows: 2 !important;',
    '}',
    'h1,h2,h3,h4,h5,h6 {',
    '  color:' + t.ink + ' !important;',
    '  font-weight: normal !important;',
    '  margin-top: 1.4em !important; margin-bottom: 0.6em !important;',
    '  page-break-after: avoid !important;',
    '}',
    'a { color:' + t.ink + ' !important; }',
    'img { filter: grayscale(100%) contrast(1.05) !important; max-width:100% !important; height:auto !important; display:block !important; margin:0 auto !important; }',
    '.mbp_pagebreak, [class*="pagebreak"], [class*="page_break"] { display:none !important; }',
  ].join('\n');
}

function injectTheme() {
  if (!rendition) return;
  rendition.hooks.content.register(function(contents) {
    var doc = contents.document;
    var old = doc.getElementById('__eink__');
    if (old) old.remove();
    var s = doc.createElement('style');
    s.id = '__eink__';
    s.textContent = buildIframeCSS();
    (doc.head || doc.body).appendChild(s);
  });
}

function refreshIframeCSS() {
  if (!rendition) return;
  rendition.views().forEach(function(view) {
    try {
      var doc = view.document || (view.iframe && view.iframe.contentDocument);
      if (!doc) return;
      var old = doc.getElementById('__eink__');
      if (old) old.remove();
      var s = doc.createElement('style');
      s.id = '__eink__';
      s.textContent = buildIframeCSS();
      (doc.head || doc.body).appendChild(s);
    } catch(e) {}
  });
}

// ============================================================
// E-INK FLASH
// ============================================================
function flash(cb) {
  readerWrap.classList.remove('flashing');
  void readerWrap.offsetWidth;
  readerWrap.classList.add('flashing');
  setTimeout(function() {
    readerWrap.classList.remove('flashing');
    if (cb) cb();
  }, 390);
}

// ============================================================
// STARTUP — check for saved book and auto-resume
// ============================================================
window.addEventListener('DOMContentLoaded', function() {
  restoreSettingsUI();
  applyDocumentTheme(settings.theme);
  checkSavedBook();
});

function checkSavedBook() {
  var meta = loadBookMeta();
  if (!meta) return;

  // Show resume row
  savedBookName.textContent = meta.name;
  savedBookRow.style.display = 'block';
  landingDivider.style.display = 'flex';

  // Auto-load from IndexedDB
  dbGet('epub_' + meta.key).then(function(buf) {
    if (!buf) return; // data gone, just show the button without auto-resuming
    // Auto-open immediately
    openEpub(buf, meta.name, meta.key);
  }).catch(function() {});
}

btnResume && btnResume.addEventListener('click', function() {
  var meta = loadBookMeta();
  if (!meta) return;
  dbGet('epub_' + meta.key).then(function(buf) {
    if (buf) openEpub(buf, meta.name, meta.key);
    else showError('Saved book not found. Please reload the file.');
  }).catch(function(e) { showError('Could not load saved book: ' + e.message); });
});

// ============================================================
// FILE INPUT
// ============================================================
uploadBtn.addEventListener('click', function() { fileInput.click(); });

fileInput.addEventListener('change', function(e) {
  var file = e.target.files[0];
  if (!file) return;
  hideError();
  if (!file.name.toLowerCase().endsWith('.epub')) { showError('Please select a .epub file.'); return; }
  var fr = new FileReader();
  fr.onerror = function() { showError('Could not read file.'); };
  fr.onload  = function(ev) {
    var key = makeKey(file.name);
    dbPut('epub_' + key, ev.target.result).catch(function() {});
    saveBookMeta(file.name, key);
    openEpub(ev.target.result, file.name, key);
  };
  fr.readAsArrayBuffer(file);
  fileInput.value = '';
});

// ============================================================
// URL FETCH
// ============================================================
btnUrlLoad.addEventListener('click', function() { fetchUrl(); });
urlInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') fetchUrl(); });

function fetchUrl() {
  var url = urlInput.value.trim();
  if (!url) return;
  if (!url.startsWith('http')) { showError('Please enter a full URL starting with http.'); return; }

  hideError();
  btnUrlLoad.textContent = '…';
  btnUrlLoad.disabled = true;

  // Use a CORS proxy if the server doesn't support CORS
  var fetchUrl = url;

  fetch(fetchUrl)
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    })
    .then(function(buf) {
      btnUrlLoad.textContent = 'Load';
      btnUrlLoad.disabled = false;
      urlInput.value = '';
      var name = url.split('/').pop().split('?')[0] || 'book.epub';
      if (!name.endsWith('.epub')) name += '.epub';
      var key = makeKey(name + '_' + url.length);
      dbPut('epub_' + key, buf).catch(function() {});
      saveBookMeta(name, key);
      openEpub(buf, name, key);
    })
    .catch(function(e) {
      btnUrlLoad.textContent = 'Load';
      btnUrlLoad.disabled = false;
      // CORS likely blocked — suggest proxy
      if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
        showError('CORS blocked. Try: https://corsproxy.io/?' + encodeURIComponent(url));
      } else {
        showError('Could not fetch URL: ' + e.message);
      }
    });
}

function makeKey(name) {
  return btoa(encodeURIComponent(name)).replace(/[^a-z0-9]/gi, '').slice(0, 40);
}

// ============================================================
// OPEN EPUB
// ============================================================
function openEpub(arrayBuffer, filename, bookKey) {
  if (typeof ePub === 'undefined') { showError('epub.js not loaded.'); return; }
  if (book) { try { book.destroy(); } catch(e) {} }
  book = null; rendition = null;

  bookKey = bookKey || makeKey(filename);

  try { book = ePub(arrayBuffer); }
  catch(e) { showError('Cannot open EPUB: ' + e.message); return; }

  var savedCfi = loadBookPos(bookKey);

  screenLanding.classList.remove('active');
  screenReader.classList.add('active');
  readerEl.innerHTML = '';

  requestAnimationFrame(function() {
    var W = readerWrap.offsetWidth  || window.innerWidth;
    var H = readerWrap.offsetHeight || (window.innerHeight - 44 - 52);

    rendition = book.renderTo(readerEl, {
      width: W, height: H,
      flow: 'paginated', spread: 'none', minSpreadWidth: 9999,
    });

    injectTheme();
    applyDocumentTheme(settings.theme);
    flash();

    rendition.display(savedCfi || undefined).catch(function() { rendition.display(); });

    rendition.on('relocated', function(loc) {
      try {
        var pct = Math.round((loc.start.percentage || 0) * 100);
        progressFill.style.width = pct + '%';
        progressLabel.textContent = pct + '%';
        saveBookPos(bookKey, loc.start.cfi);
      } catch(e) {}
    });

    book.ready.then(function() {
      book.loaded.metadata.then(function(meta) {
        var title = (meta && meta.title) ? meta.title : filename.replace(/\.epub$/i, '');
        bookTitleEl.textContent = title;
        document.title = title;
        // Update saved name to proper title
        saveBookMeta(title, bookKey);
        if (savedBookName) savedBookName.textContent = title;
      }).catch(function(){});
      book.loaded.navigation.then(function(nav) { buildToc(nav.toc || []); }).catch(function(){});
    }).catch(function(e) { showError('EPUB error: ' + e.message); });
  });
}

// ============================================================
// NAVIGATION
// ============================================================
btnPrev.addEventListener('click', function() { if (rendition) flash(function() { rendition.prev(); }); });
btnNext.addEventListener('click', function() { if (rendition) flash(function() { rendition.next(); }); });

readerWrap.addEventListener('click', function(e) {
  if (!rendition) return;
  if (panelToc.classList.contains('open') || panelSettings.classList.contains('open')) return;
  var x = e.clientX, W = window.innerWidth;
  if (x < W * 0.3)      flash(function() { rendition.prev(); });
  else if (x > W * 0.7) flash(function() { rendition.next(); });
  else toggleChrome();
});

var swipeX = 0, swipeY = 0;
document.addEventListener('touchstart', function(e) {
  swipeX = e.changedTouches[0].clientX;
  swipeY = e.changedTouches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', function(e) {
  if (!rendition || panelToc.classList.contains('open') || panelSettings.classList.contains('open')) return;
  var dx = e.changedTouches[0].clientX - swipeX;
  var dy = e.changedTouches[0].clientY - swipeY;
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 44)
    flash(function() { dx < 0 ? rendition.next() : rendition.prev(); });
}, { passive: true });

document.addEventListener('keydown', function(e) {
  if (!rendition) return;
  if (e.key === 'ArrowRight' || e.key === ' ') flash(function() { rendition.next(); });
  else if (e.key === 'ArrowLeft') flash(function() { rendition.prev(); });
});

var chromeVisible = true;
function toggleChrome() {
  chromeVisible = !chromeVisible;
  chromeTop.classList.toggle('hidden', !chromeVisible);
  chromeBottom.classList.toggle('hidden', !chromeVisible);
}

// ============================================================
// PANELS
// ============================================================
function openPanel(p) { p.classList.add('open'); backdrop.classList.add('open'); }
function closeAllPanels() {
  panelToc.classList.remove('open');
  panelSettings.classList.remove('open');
  backdrop.classList.remove('open');
}

btnMenu.addEventListener('click', function() { openPanel(panelToc); });
btnSettings.addEventListener('click', function() { openPanel(panelSettings); });
tocClose.addEventListener('click', closeAllPanels);
settingsClose.addEventListener('click', closeAllPanels);
backdrop.addEventListener('click', closeAllPanels);

// ============================================================
// TOC
// ============================================================
function buildToc(toc) {
  tocList.innerHTML = '';
  function add(items, depth) {
    items.forEach(function(item) {
      var li = document.createElement('li');
      var a  = document.createElement('a');
      a.href = '#';
      a.textContent = item.label.trim();
      a.style.paddingLeft = (20 + depth * 14) + 'px';
      if (depth > 0) { a.style.fontSize = '13px'; a.style.color = 'var(--ink-mid)'; }
      a.addEventListener('click', function(ev) {
        ev.preventDefault();
        closeAllPanels();
        flash(function() { rendition.display(item.href); });
      });
      li.appendChild(a);
      tocList.appendChild(li);
      if (item.subitems && item.subitems.length) add(item.subitems, depth + 1);
    });
  }
  add(toc, 0);
}

// ============================================================
// SETTINGS
// ============================================================
fontSizeVal.textContent = settings.fontSize;

fontBigger.addEventListener('click', function() {
  if (settings.fontSize >= 30) return;
  settings.fontSize += 2;
  fontSizeVal.textContent = settings.fontSize;
  saveSettings(); refreshIframeCSS();
});

fontSmaller.addEventListener('click', function() {
  if (settings.fontSize <= 11) return;
  settings.fontSize -= 2;
  fontSizeVal.textContent = settings.fontSize;
  saveSettings(); refreshIframeCSS();
});

$('font-family-control').addEventListener('click', function(e) {
  var btn = e.target.closest('.face-btn'); if (!btn) return;
  settings.fontFamily = btn.dataset.font;
  saveSettings(); refreshIframeCSS(); setActive(this, btn);
});

$('line-spacing-control').addEventListener('click', function(e) {
  var btn = e.target.closest('.face-btn'); if (!btn) return;
  settings.lineSpacing = parseFloat(btn.dataset.spacing);
  saveSettings(); refreshIframeCSS(); setActive(this, btn);
});

$('margin-control').addEventListener('click', function(e) {
  var btn = e.target.closest('.face-btn'); if (!btn) return;
  settings.margin = btn.dataset.margin;
  saveSettings(); refreshIframeCSS(); setActive(this, btn);
});

$('theme-control').addEventListener('click', function(e) {
  var btn = e.target.closest('.theme-btn'); if (!btn) return;
  settings.theme = btn.dataset.theme;
  saveSettings(); applyDocumentTheme(settings.theme); refreshIframeCSS(); setActive(this, btn);
});

function setActive(container, activeBtn) {
  container.querySelectorAll('.face-btn, .theme-btn').forEach(function(b) { b.classList.remove('active'); });
  activeBtn.classList.add('active');
}

function restoreSettingsUI() {
  fontSizeVal.textContent = settings.fontSize;
  applyDocumentTheme(settings.theme);
  [
    ['#font-family-control .face-btn', function(b) { return b.dataset.font === settings.fontFamily; }],
    ['#line-spacing-control .face-btn', function(b) { return parseFloat(b.dataset.spacing) === settings.lineSpacing; }],
    ['#margin-control .face-btn', function(b) { return b.dataset.margin === settings.margin; }],
    ['#theme-control .theme-btn', function(b) { return b.dataset.theme === settings.theme; }],
  ].forEach(function(pair) {
    document.querySelectorAll(pair[0]).forEach(function(b) { b.classList.toggle('active', pair[1](b)); });
  });
}
