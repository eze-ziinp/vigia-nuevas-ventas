const fs = require('fs');

const CLIENTIFY_TOKEN = process.env.CLIENTIFY_TOKEN;
const SLACK_TOKEN     = process.env.SLACK_TOKEN;
const SLACK_CHANNEL   = process.env.SLACK_CHANNEL || 'C0BJ8KK37J7';
const STAGE_ID        = '525551'; // PRE-VENTA FIRMADO
const FIELDS          = 'id,name,owner_name,status,created,pipeline_stage';
const STATE_FILE      = 'state.json';

function firstName(s) { return String(s || '').trim().split(/\s+/)[0] || ''; }
function madridMonth() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).format(new Date());
}

async function fetchStageMembers() {
  const members = [];
  let url = `https://api.clientify.net/v1/deals/?fields=${FIELDS}&page_size=250`;
  let guard = 0;
  while (url && guard < 400) {
    guard++;
    const r = await fetch(url, { headers: { 'Authorization': 'Token ' + CLIENTIFY_TOKEN } });
    if (!r.ok) throw new Error('API Clientify HTTP ' + r.status);
    const j = await r.json();
    for (const d of (j.results || [])) {
      const m = String(d.pipeline_stage || '').match(/stages\/(\d+)/);
      const sid = m ? m[1] : '';
      if (sid === STAGE_ID && (d.status === 1 || d.status === 2)) {
        members.push({ id: String(d.id), name: d.name, owner: d.owner_name, created: d.created });
      }
    }
    url = j.next;
  }
  return members;
}

async function slack(text) {
  const body = new URLSearchParams({ token: SLACK_TOKEN, channel: SLACK_CHANNEL, text });
  const r = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return r.json();
}

(async () => {
  const members = await fetchStageMembers();
  const ids = members.map(m => m.id);

  let state = null;
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { state = null; }
  const month = madridMonth();

  if (!state) {
    state = { snapshot: ids, month, count: 0 };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log('BASELINE: ' + ids.length + ' oportunidades en la etapa. Sin avisos.');
    return;
  }

  if (state.snapshot && ids.length < 0.5 * state.snapshot.length) {
    console.log('Filas <50% del snapshot (' + ids.length + ' vs ' + state.snapshot.length + '). Abortado sin cambios.');
    return;
  }

  if (state.month !== month) { state.month = month; state.count = 0; }

  const prev = new Set(state.snapshot || []);
  const news = members.filter(m => !prev.has(m.id));
  news.sort((a, b) => String(a.created || '').localeCompare(String(b.created || '')));

  for (const m of news) {
    state.count++;
    const text = '✅ *' + String(m.name || '').trim() + '* - PREVENTA FIRMADO de ' + firstName(m.owner) + '\nFirma Nª ' + state.count + ' del mes';
    const res = await slack(text);
    if (!res.ok) console.log('Slack error: ' + res.error);
  }

  state.snapshot = ids;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log('OK. total=' + ids.length + ' nuevos=' + news.length + ' contador=' + state.count);
})().catch(e => { console.error(e); process.exit(1); });
