'use strict';

const LIMITE_DIARIO = 200; // MXN — alerta gastos hormiga

// ── Storage ─────────────────────────────────────────────────────────────────
const DB = {
  get: (k)    => JSON.parse(localStorage.getItem(k) || '[]'),
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt     = n  => `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
const fmtDate = d  => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };
const today   = () => new Date().toISOString().split('T')[0];
const mesKey  = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
};

// ── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab, .panel').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'resumen') renderResumen();
  });
});

// ── Gastos Hormiga ────────────────────────────────────────────────────────────
const gastoForm = document.getElementById('gasto-form');
document.getElementById('g-fecha').value = today();

gastoForm.addEventListener('submit', e => {
  e.preventDefault();
  const gastos = DB.get('gastos');
  gastos.push({
    id:    Date.now(),
    fecha: document.getElementById('g-fecha').value,
    cat:   document.getElementById('g-cat').value,
    monto: parseFloat(document.getElementById('g-monto').value),
    desc:  document.getElementById('g-desc').value.trim(),
  });
  DB.set('gastos', gastos);
  gastoForm.reset();
  document.getElementById('g-fecha').value = today();
  renderGastos();
});

function renderGastos() {
  const gastos   = DB.get('gastos').sort((a, b) => b.fecha.localeCompare(a.fecha));
  const alertEl  = document.getElementById('gastos-alert');

  document.getElementById('gastos-body').innerHTML = gastos.map(g => `
    <tr>
      <td>${fmtDate(g.fecha)}</td>
      <td>${g.cat}</td>
      <td>${fmt(g.monto)}</td>
      <td>${g.desc}</td>
      <td><button class="del-btn" onclick="delGasto(${g.id})">×</button></td>
    </tr>
  `).join('');

  const totalHoy  = gastos.filter(g => g.fecha === today()).reduce((s, g) => s + g.monto, 0);
  const totalMes  = gastos.filter(g => g.fecha.startsWith(mesKey())).reduce((s, g) => s + g.monto, 0);
  const cutoff7   = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; })();
  const total7    = gastos.filter(g => g.fecha >= cutoff7).reduce((s, g) => s + g.monto, 0);

  document.getElementById('gastos-kpis').innerHTML = `
    <div class="kpi">
      <div class="kpi-label">Hoy</div>
      <div class="kpi-value ${totalHoy > LIMITE_DIARIO ? 'bad' : ''}">${fmt(totalHoy)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Últimos 7 días</div>
      <div class="kpi-value">${fmt(total7)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Mes actual</div>
      <div class="kpi-value">${fmt(totalMes)}</div>
    </div>
  `;

  alertEl.className = totalHoy > LIMITE_DIARIO
    ? 'alert'
    : 'alert hidden';
  alertEl.textContent = `Límite diario superado — hoy: ${fmt(totalHoy)} / límite: ${fmt(LIMITE_DIARIO)}`;
}

window.delGasto = id => {
  DB.set('gastos', DB.get('gastos').filter(g => g.id !== id));
  renderGastos();
};

// ── Facebook Ads ──────────────────────────────────────────────────────────────
const fbForm = document.getElementById('fb-form');
document.getElementById('fb-fecha').value = today();

fbForm.addEventListener('submit', e => {
  e.preventDefault();
  const gastado = parseFloat(document.getElementById('fb-gastado').value);
  const leads   = parseInt(document.getElementById('fb-leads').value, 10);
  const camps   = DB.get('campanas');
  camps.push({
    id:          Date.now(),
    nombre:      document.getElementById('fb-nombre').value.trim(),
    fecha:       document.getElementById('fb-fecha').value,
    presupuesto: parseFloat(document.getElementById('fb-presupuesto').value),
    gastado,
    leads,
    cplObj:      parseFloat(document.getElementById('fb-cpl-obj').value),
  });
  DB.set('campanas', camps);
  fbForm.reset();
  document.getElementById('fb-fecha').value = today();
  renderFacebook();
});

function renderFacebook() {
  const camps = DB.get('campanas').sort((a, b) => b.fecha.localeCompare(a.fecha));

  document.getElementById('fb-body').innerHTML = camps.map(c => {
    const cplReal = c.leads > 0 ? c.gastado / c.leads : null;
    const ratio   = cplReal !== null ? cplReal / c.cplObj : null;
    const [cls, label] =
      ratio === null          ? ['warn', '—']      :
      ratio > 1.2             ? ['bad',  'Alto']   :
      ratio > 1.0             ? ['warn', 'Alerta'] :
                                ['ok',   'OK'];
    return `
      <tr>
        <td>${c.nombre}</td>
        <td>${fmtDate(c.fecha)}</td>
        <td>${fmt(c.presupuesto)}</td>
        <td>${fmt(c.gastado)}</td>
        <td>${c.leads}</td>
        <td>${cplReal !== null ? fmt(cplReal) : '—'}</td>
        <td>${fmt(c.cplObj)}</td>
        <td class="${cls}">${label}</td>
        <td><button class="del-btn" onclick="delCampa(${c.id})">×</button></td>
      </tr>
    `;
  }).join('');
}

window.delCampa = id => {
  DB.set('campanas', DB.get('campanas').filter(c => c.id !== id));
  renderFacebook();
};

// ── Resumen ───────────────────────────────────────────────────────────────────
function renderResumen() {
  const gastos   = DB.get('gastos').filter(g => g.fecha.startsWith(mesKey()));
  const camps    = DB.get('campanas').filter(c => c.fecha.startsWith(mesKey()));

  const cats          = {};
  gastos.forEach(g => { cats[g.cat] = (cats[g.cat] || 0) + g.monto; });
  const totalGastos   = gastos.reduce((s, g) => s + g.monto, 0);
  const totalFB       = camps.reduce((s, c) => s + c.gastado, 0);
  const totalLeads    = camps.reduce((s, c) => s + c.leads, 0);
  const cplProm       = totalLeads > 0 ? totalFB / totalLeads : 0;
  const mesLabel      = new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });

  document.getElementById('resumen-content').innerHTML = `
    <p style="font-size:12px;color:var(--muted);margin-bottom:20px;text-transform:capitalize">${mesLabel}</p>

    <div class="kpi-row" style="margin-bottom:32px">
      <div class="kpi">
        <div class="kpi-label">Gastos hormiga</div>
        <div class="kpi-value">${fmt(totalGastos)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Inversión FB</div>
        <div class="kpi-value">${fmt(totalFB)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Leads</div>
        <div class="kpi-value">${totalLeads}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">CPL promedio</div>
        <div class="kpi-value ${cplProm > 0 && cplProm > 150 ? 'bad' : cplProm > 0 ? 'ok' : ''}">
          ${cplProm > 0 ? fmt(cplProm) : '—'}
        </div>
      </div>
    </div>

    <h2 style="margin-bottom:12px">Por categoría</h2>
    <div style="max-width:380px">
      ${Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([cat, monto]) => `
        <div class="cat-row">
          <span>${cat}</span>
          <span>${fmt(monto)}</span>
        </div>
      `).join('') || '<p class="empty-state">Sin gastos registrados este mes.</p>'}
    </div>
  `;
}

// ── Init ──────────────────────────────────────────────────────────────────────
renderGastos();
renderFacebook();
