'use strict';
/* ---------- Stockage local (progression + cours importés) ---------- */
const KEY = 'cours-app-v1';
const DAY = 86400000;
const INTERVALS = [0, 1, 3, 7, 14]; // jours avant revoir, selon la "boîte" (Leitner)
const MAX_BOX = INTERVALS.length - 1;

const db = (() => {
  let d = { imported: {}, progress: {} };
  try { d = Object.assign(d, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  return {
    d,
    save() { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
  };
})();

/* ---------- Utilitaires ---------- */
const $app = document.getElementById('app');
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// mini-markdown sûr : **gras**, *italique*, `code`, retours à la ligne
const fmt = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>').replace(/\n/g, '<br>');

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const mount = (...nodes) => { $app.replaceChildren(...nodes); window.scrollTo(0, 0); };

/* ---------- Cours : chargement et validation ---------- */
let catalog = []; // [{id,title,description,course?}]
const cache = {};

function validate(c) {
  if (!c || typeof c !== 'object') throw new Error('Le cours doit être un objet JSON.');
  if (!c.id || !c.title) throw new Error('Champs "id" et "title" obligatoires.');
  c.questions = c.questions || []; c.flashcards = c.flashcards || [];
  c.questions.forEach((q, i) => {
    if (!q.question || !Array.isArray(q.choices) || q.choices.length < 2) throw new Error(`Question ${i + 1} : "question" et au moins 2 "choices" requis.`);
    if (!Array.isArray(q.answer) || !q.answer.length || q.answer.some(a => !Number.isInteger(a) || a < 0 || a >= q.choices.length)) throw new Error(`Question ${i + 1} : "answer" doit être une liste d'indices valides (ex: [0]).`);
    q.id = q.id || 'q' + (i + 1);
  });
  c.flashcards.forEach((f, i) => { if (!f.q || !f.a) throw new Error(`Carte ${i + 1} : "q" et "a" requis.`); f.id = 'f' + (i + 1); });
  return c;
}

async function loadCatalog() {
  catalog = [];
  try {
    const r = await fetch('courses/index.json', { cache: 'no-cache' });
    if (r.ok) catalog = (await r.json()).map(x => ({ ...x }));
  } catch (e) { /* ouvert en file:// ou hors ligne : seuls les cours importés seront dispo */ }
  for (const c of Object.values(db.d.imported)) if (!catalog.some(x => x.id === c.id)) catalog.push({ id: c.id, title: c.title, description: c.description, course: c });
}
async function getCourse(id) {
  if (cache[id]) return cache[id];
  const e = catalog.find(x => x.id === id);
  if (!e) return null;
  const c = e.course || await (await fetch('courses/' + e.file)).json();
  return (cache[id] = validate(c));
}

/* ---------- Progression (répétition espacée de type Leitner) ---------- */
const prog = cid => (db.d.progress[cid] = db.d.progress[cid] || {});
const stat = (cid, id) => prog(cid)[id] || { box: 0, last: 0, seen: 0, right: 0 };
const isNew = (cid, id) => stat(cid, id).seen === 0;
const isDue = (cid, id) => { const s = stat(cid, id); return s.seen === 0 || Date.now() - s.last >= INTERVALS[s.box] * DAY; };
const isWrong = (cid, id) => { const s = stat(cid, id); return s.seen > 0 && s.box === 0; };
function record(cid, id, ok) {
  const s = { ...stat(cid, id) };
  s.seen++; s.last = Date.now();
  if (ok) { s.right++; s.box = Math.min(s.box + 1, MAX_BOX); } else s.box = 0;
  prog(cid)[id] = s; db.save();
}
const mastery = c => {
  const items = [...c.questions, ...c.flashcards];
  if (!items.length) return 0;
  return Math.round(100 * items.filter(i => stat(c.id, i.id).box >= 3).length / items.length);
};

/* ---------- Routage ---------- */
async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!catalog.length && !route.loaded) { await loadCatalog(); route.loaded = true; }
  if (parts[0] === 'c' && parts[1]) {
    const c = await getCourse(decodeURIComponent(parts[1])).catch(err => { mount(h('div', { class: 'err' }, 'Erreur : ' + err.message)); return undefined; });
    if (c === undefined) return;
    if (!c) return mount(h('p', {}, 'Cours introuvable. ', h('a', { href: '#/' }, 'Retour')));
    return courseView(c, parts[2] || 'fiche');
  }
  home();
}
window.addEventListener('hashchange', route);

/* ---------- Accueil ---------- */
function home() {
  const list = catalog.length
    ? catalog.map(e => {
        const c = cache[e.id];
        return h('a', { class: 'card', href: '#/c/' + encodeURIComponent(e.id) },
          h('b', {}, e.title), e.description ? h('div', { class: 'muted' }, e.description) : null,
          c ? h('div', { class: 'bar' }, h('i', { style: `width:${mastery(c)}%` })) : null);
      })
    : [h('p', { class: 'muted' }, "Aucun cours pour l'instant. Envoie-moi ton cours dans le chat, ou importe un fichier JSON ci-dessous.")];
  // précharge pour afficher la maîtrise
  catalog.forEach(e => { if (!cache[e.id]) getCourse(e.id).then(c => { if (c && location.hash.length < 3) home(); }).catch(() => {}); });

  const ta = h('textarea', { placeholder: 'Colle ici le JSON d\'un cours…' });
  const msg = h('div');
  const doImport = txt => {
    try {
      const c = validate(JSON.parse(txt));
      db.d.imported[c.id] = c; db.save(); delete cache[c.id];
      location.hash = '#/c/' + encodeURIComponent(c.id);
      loadCatalog().then(route);
    } catch (e) { msg.replaceChildren(h('div', { class: 'err' }, 'Import impossible : ' + e.message)); }
  };
  const file = h('input', { type: 'file', accept: '.json,application/json', onchange: async ev => { const f = ev.target.files[0]; if (f) doImport(await f.text()); } });
  mount(h('h1', {}, 'Mes cours'), ...list,
    h('div', { class: 'card' }, h('b', {}, 'Importer un cours'),
      h('p', { class: 'muted' }, 'Fichier JSON généré avec Claude (stocké dans ce navigateur uniquement).'),
      file, h('p', {}, ta), h('button', { onclick: () => doImport(ta.value) }, 'Importer'), msg));
}

/* ---------- Page d'un cours ---------- */
function courseView(c, tab) {
  const tabs = [['fiche', '📖 Fiche'], ['qcm', '✅ QCM'], ['cartes', '🃏 Cartes'], ['examen', '📝 Examen'], ['stats', '📊 Stats']];
  const head = [h('p', {}, h('a', { href: '#/' }, '← Tous les cours')), h('h1', {}, c.title),
    h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('a', { class: 'tab' + (k === tab ? ' on' : ''), href: `#/c/${encodeURIComponent(c.id)}/${k}` }, l)))];
  const body = { fiche: viewFiche, qcm: viewQcmSetup, cartes: viewCardsSetup, examen: viewExamSetup, stats: viewStats }[tab] || viewFiche;
  mount(...head, h('div', { id: 'body' }));
  document.getElementById('body').replaceChildren(body(c));
}

function viewFiche(c) {
  const s = c.summary;
  if (!s || !s.length) return h('p', { class: 'muted' }, 'Pas de fiche de synthèse pour ce cours.');
  if (typeof s === 'string') return h('div', { class: 'card', html: fmt(s) });
  return h('div', {}, s.map(sec => h('div', { class: 'card' }, h('h2', { style: 'margin-top:0' }, sec.title), h('ul', { class: 'pts' }, (sec.points || []).map(p => h('li', { html: fmt(p) }))))));
}

const chapters = c => [...new Set([...c.questions, ...c.flashcards].map(x => x.chapter).filter(Boolean))];

function setupForm(c, kind, onStart) {
  const items = kind === 'qcm' ? c.questions : c.flashcards;
  if (!items.length) return h('p', { class: 'muted' }, kind === 'qcm' ? 'Aucune question dans ce cours.' : 'Aucune carte dans ce cours.');
  const counts = { due: items.filter(i => isDue(c.id, i.id)).length, new: items.filter(i => isNew(c.id, i.id)).length, wrong: items.filter(i => isWrong(c.id, i.id)).length };
  const mode = h('select', {},
    h('option', { value: 'due' }, `À réviser (${counts.due})`), h('option', { value: 'new' }, `Nouvelles (${counts.new})`),
    h('option', { value: 'wrong' }, `Mes erreurs (${counts.wrong})`), h('option', { value: 'all' }, `Tout (${items.length})`));
  const n = h('select', {}, [5, 10, 20, 50, 'Toutes'].map(v => h('option', { value: v === 'Toutes' ? 9999 : v, selected: v === 10 }, v)));
  const chs = chapters(c);
  const ch = chs.length ? h('select', {}, h('option', { value: '' }, 'Tous les chapitres'), chs.map(x => h('option', { value: x }, x))) : null;
  const go = h('button', { onclick: () => {
    let pool = items.filter(i => (!ch || !ch.value || i.chapter === ch.value) &&
      ({ due: isDue, new: isNew, wrong: isWrong, all: () => true }[mode.value])(c.id, i.id));
    pool = shuffle(pool).slice(0, +n.value);
    if (!pool.length) return alert('Rien à réviser avec ces filtres 🎉 Essaie le mode « Tout ».');
    onStart(pool);
  } }, 'Commencer');
  return h('div', { class: 'card' }, h('div', { class: 'row' },
    h('label', { class: 'f' }, 'Mode', mode), h('label', { class: 'f' }, 'Nombre', n), ch ? h('label', { class: 'f' }, 'Chapitre', ch) : null), go);
}

const viewQcmSetup = c => setupForm(c, 'qcm', pool => runQuiz(c, pool, { feedback: true }));
const viewCardsSetup = c => setupForm(c, 'cards', pool => runCards(c, pool));

function viewExamSetup(c) {
  if (!c.questions.length) return h('p', { class: 'muted' }, 'Aucune question.');
  const n = h('input', { type: 'number', min: 1, max: c.questions.length, value: Math.min(20, c.questions.length) });
  return h('div', { class: 'card' }, h('p', {}, "Mode examen : toutes les questions mélangées, correction uniquement à la fin."),
    h('div', { class: 'row' }, h('label', { class: 'f' }, 'Nombre de questions', n),
      h('button', { onclick: () => runQuiz(c, shuffle(c.questions).slice(0, Math.max(1, +n.value || 1)), { feedback: false, exam: true }) }, 'Lancer l\'examen')));
}

/* ---------- Session de QCM ---------- */
function runQuiz(c, qs, opt) {
  let i = 0; const results = []; const t0 = Date.now();
  const shell = h('div'); mount(h('p', {}, h('a', { href: `#/c/${encodeURIComponent(c.id)}/${opt.exam ? 'examen' : 'qcm'}` }, '← Quitter')), shell);

  function ask() {
    const q = qs[i]; const multi = q.answer.length > 1;
    const opts = shuffle(q.choices.map((t, idx) => ({ t, idx })));
    const picked = new Set(); const boxes = [];
    const done = { v: false };
    const list = opts.map(o => {
      const input = h('input', { type: multi ? 'checkbox' : 'radio', name: 'c' });
      const row = h('label', { class: 'choice', onclick: ev => {
        if (done.v) return ev.preventDefault();
      } }, input, h('span', { html: fmt(o.t) }));
      input.addEventListener('change', () => {
        if (!multi) picked.clear();
        input.checked ? picked.add(o.idx) : picked.delete(o.idx);
        boxes.forEach(b => b.row.classList.toggle('sel', picked.has(b.o.idx)));
        validateBtn.disabled = !picked.size;
      });
      boxes.push({ o, row, input });
      return row;
    });
    const fbBox = h('div');
    const validateBtn = h('button', { disabled: true, onclick: submit }, opt.feedback ? 'Valider' : (i + 1 < qs.length ? 'Suivant' : 'Terminer'));
    function submit() {
      const ok = picked.size === q.answer.length && q.answer.every(a => picked.has(a));
      results.push({ q, ok, picked: [...picked] });
      record(c.id, q.id, ok);
      if (!opt.feedback) return next();
      done.v = true;
      boxes.forEach(b => { b.input.disabled = true; b.row.classList.remove('sel');
        if (q.answer.includes(b.o.idx)) b.row.classList.add('good'); else if (picked.has(b.o.idx)) b.row.classList.add('bad'); });
      fbBox.replaceChildren(h('div', { class: 'fb ' + (ok ? 'ok' : 'ko') }, h('b', {}, ok ? '✅ Correct !' : '❌ Raté'), q.explanation ? h('div', { html: fmt(q.explanation) }) : null));
      validateBtn.textContent = i + 1 < qs.length ? 'Suivant' : 'Voir le résultat';
      validateBtn.onclick = next;
    }
    shell.replaceChildren(
      h('div', { class: 'muted' }, `Question ${i + 1} / ${qs.length}`, q.chapter ? ' · ' + q.chapter : ''),
      h('div', { class: 'bar' }, h('i', { style: `width:${100 * i / qs.length}%` })),
      h('div', { class: 'card' }, h('div', { html: fmt(q.question), style: 'font-weight:600' }), multi ? h('div', { class: 'muted' }, 'Plusieurs réponses possibles') : null, list, fbBox),
      validateBtn);
  }
  function next() { if (++i < qs.length) ask(); else finish(); }
  function finish() {
    const good = results.filter(r => r.ok).length; const pct = Math.round(100 * good / qs.length);
    const mins = Math.round((Date.now() - t0) / 60000 * 10) / 10;
    const wrong = results.filter(r => !r.ok);
    shell.replaceChildren(
      h('div', { class: 'card', style: 'text-align:center' }, h('div', { class: 'big' }, `${good} / ${qs.length}`), h('div', {}, `${pct} % · ${mins} min`),
        h('div', {}, pct >= 80 ? '🎉 Excellent !' : pct >= 50 ? '👍 Pas mal, continue.' : '💪 À retravailler, les erreurs reviendront en priorité.')),
      wrong.length ? h('h2', {}, `Corrections (${wrong.length})`) : h('p', {}, 'Aucune erreur 👏'),
      wrong.map(r => h('div', { class: 'card' }, h('div', { html: fmt(r.q.question), style: 'font-weight:600' }),
        h('div', { class: 'muted' }, 'Ta réponse : ', r.picked.map(p => r.q.choices[p]).join(' ; ')),
        h('div', {}, '✅ ', h('span', { html: fmt(r.q.answer.map(a => r.q.choices[a]).join(' ; ')) })),
        r.q.explanation ? h('div', { class: 'muted', html: fmt(r.q.explanation) }) : null)),
      h('div', { class: 'row' },
        wrong.length ? h('button', { onclick: () => runQuiz(c, shuffle(wrong.map(r => r.q)), { feedback: true }) }, 'Refaire mes erreurs') : null,
        h('button', { class: 'ghost', onclick: () => { location.hash = `#/c/${encodeURIComponent(c.id)}/stats`; } }, 'Statistiques')));
  }
  ask();
}

/* ---------- Cartes mémoire ---------- */
function runCards(c, cards) {
  let i = 0, known = 0; const shell = h('div');
  mount(h('p', {}, h('a', { href: `#/c/${encodeURIComponent(c.id)}/cartes` }, '← Quitter')), shell);
  function show() {
    const f = cards[i]; let back = false;
    const face = h('div', { class: 'card flash' }); const actions = h('div', { class: 'row' });
    const render = () => {
      face.replaceChildren(h('div', {}, h('span', { class: 'side' }, back ? 'Réponse' : 'Question'), h('span', { html: fmt(back ? f.a : f.q) })));
      actions.replaceChildren(...(back ? [
        h('button', { class: 'ghost', onclick: () => rate(false) }, '↩︎ À revoir'), h('button', { onclick: () => rate(true) }, '✔︎ Je savais')] :
        [h('button', { onclick: flip }, 'Retourner')]));
    };
    const flip = () => { back = !back; render(); };
    face.addEventListener('click', flip);
    const rate = ok => { record(c.id, f.id, ok); if (ok) known++; ++i < cards.length ? show() : end(); };
    shell.replaceChildren(h('div', { class: 'muted' }, `Carte ${i + 1} / ${cards.length}`), h('div', { class: 'bar' }, h('i', { style: `width:${100 * i / cards.length}%` })), face, actions);
    render();
  }
  function end() {
    shell.replaceChildren(h('div', { class: 'card', style: 'text-align:center' }, h('div', { class: 'big' }, `${known} / ${cards.length}`), h('div', {}, 'cartes sues')),
      h('button', { onclick: () => { location.hash = `#/c/${encodeURIComponent(c.id)}/cartes`; } }, 'Terminer'));
  }
  show();
}

/* ---------- Statistiques ---------- */
function viewStats(c) {
  const items = [...c.questions, ...c.flashcards];
  const row = (label, arr) => {
    const m = arr.length ? Math.round(100 * arr.filter(i => stat(c.id, i.id).box >= 3).length / arr.length) : 0;
    const seen = arr.filter(i => !isNew(c.id, i.id)).length;
    return h('div', { class: 'card' }, h('b', {}, label), h('span', { class: 'muted' }, ` · ${seen}/${arr.length} vus · ${m} % maîtrisé`), h('div', { class: 'bar' }, h('i', { style: `width:${m}%` })));
  };
  const chs = chapters(c);
  const weak = c.questions.map(q => ({ q, s: stat(c.id, q.id) })).filter(x => x.s.seen && x.s.right / x.s.seen < 0.6).sort((a, b) => a.s.right / a.s.seen - b.s.right / b.s.seen).slice(0, 8);
  return h('div', {}, row('Global', items), chs.map(ch => row(ch, items.filter(i => i.chapter === ch))),
    weak.length ? h('div', {}, h('h2', {}, 'Points faibles'), weak.map(x => h('div', { class: 'card' }, h('span', { html: fmt(x.q.question) }), h('div', { class: 'muted' }, `${x.s.right}/${x.s.seen} bonnes réponses`)))) : null,
    h('div', { class: 'row' }, h('button', { class: 'danger', onclick: () => { if (confirm('Effacer toute la progression de ce cours ?')) { delete db.d.progress[c.id]; db.save(); route(); } } }, 'Réinitialiser la progression'),
      db.d.imported[c.id] ? h('button', { class: 'ghost', onclick: () => { if (confirm('Supprimer ce cours importé ?')) { delete db.d.imported[c.id]; delete db.d.progress[c.id]; delete cache[c.id]; db.save(); loadCatalog().then(() => { location.hash = '#/'; }); } } }, 'Supprimer le cours') : null));
}

route();
