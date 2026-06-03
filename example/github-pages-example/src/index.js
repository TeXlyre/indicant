import { buildCluster, federate, runSimulation, roomKeyFromUuid } from './cluster.js'
import './styles.css'

let distributors = []
let servers = []
let rooms = []
let truth = []
let pollTimer = null
let pollMs = 1000

function readConfig() {
  return {
    providers: Number(document.getElementById('providers').value),
    serversPerProvider: Number(document.getElementById('serversPerProvider').value),
    filterType: document.getElementById('filterType').value
  }
}

async function rebuild() {
  if (pollTimer) clearInterval(pollTimer)
  for (const s of servers) s.terminate()
  rooms = []
  truth = []
  document.getElementById('rebuildNote').textContent = 'starting server workers…'
  const built = await buildCluster(readConfig())
  distributors = built.distributors
  servers = built.servers
  await federate(distributors, servers)
  pollTimer = setInterval(() => { void federate(distributors, servers) }, pollMs)
  document.getElementById('rebuildNote').textContent = ''
  document.getElementById('sim').innerHTML = ''
  document.getElementById('out').textContent = 'Ready.'
  fillSelects(true)
  refresh()
}

async function createRoom() {
  const distributorId = document.getElementById('createDist').value
  const owned = servers.filter((s) => s.distributorId === distributorId)
  const target = owned[Math.floor(Math.random() * owned.length)]
  const uuid = crypto.randomUUID()
  const key = await roomKeyFromUuid(uuid)
  await target.enter(key)
  rooms.push({ uuid, key, serverId: target.serverId, distributorId })
  truth.push({ key, serverId: target.serverId })
  await federate(distributors, servers)
  refresh()
}

async function lookup() {
  const distributorId = document.getElementById('lookupDist').value
  const uuid = document.getElementById('uuid').value.trim()
  if (!uuid) return
  const dist = distributors.find((d) => d.distributorId === distributorId)
  const key = await roomKeyFromUuid(uuid)
  document.getElementById('out').textContent = JSON.stringify({ key, hits: dist.locate(key) }, null, 2)
}

async function simulate() {
  const stats = await runSimulation(distributors, truth, 200)
  const pct = (n) => (stats.routes ? ((n / stats.routes) * 100).toFixed(1) : '0.0')
  document.getElementById('sim').innerHTML =
    `<table>
       <tr><th>known rooms</th><td>${truth.length}</td></tr>
       <tr><th>routes returned</th><td>${stats.routes}</td></tr>
       <tr><th>correct routes</th><td>${stats.correct} (${pct(stats.correct)}%)</td></tr>
       <tr><th>false-positive routes</th><td>${stats.falsePositive} (${pct(stats.falsePositive)}%)</td></tr>
       <tr><th>missed known rooms</th><td>${stats.missed}</td></tr>
       <tr><th>phantom hits (200 never-created keys)</th><td>${stats.phantom}</td></tr>
     </table>`
}

function fillSelects(force) {
  for (const id of ['createDist', 'lookupDist']) {
    const sel = document.getElementById(id)
    if (force) sel.innerHTML = ''
    if (sel.options.length) continue
    sel.innerHTML = distributors.map((d) => `<option>${d.distributorId}</option>`).join('')
  }
}

function refresh() {
  fillSelects(false)
  document.getElementById('pollNote').textContent =
    `Distributors poll every server worker for its snapshot every ${pollMs} ms.`
  document.getElementById('cluster').innerHTML = distributors.map((d) =>
    `<div class="card"><b>${d.distributorId}</b>
     <p class="muted">owns: ${servers.filter((s) => s.distributorId === d.distributorId).map((s) => s.serverId).join(', ')}</p>
     <p class="muted">federates (remote snapshots): ${d.remoteServerIds().join(', ') || '—'}</p></div>`).join('')
  document.getElementById('rooms').innerHTML = '<table><tr><th>distributor</th><th>server</th><th>uuid</th><th>key</th><th></th></tr>' +
    rooms.map((r) =>
      `<tr><td>${r.distributorId}</td><td>${r.serverId}</td>
       <td><code>${r.uuid}</code></td><td><code>${r.key.slice(0, 14)}…</code></td>
       <td><button data-uuid="${r.uuid}" class="use">use</button></td></tr>`).join('') +
    '</table>'
  for (const btn of document.querySelectorAll('button.use')) {
    btn.addEventListener('click', () => { document.getElementById('uuid').value = btn.dataset.uuid })
  }
}

window.createRoom = createRoom
window.lookup = lookup
window.rebuild = rebuild
window.simulate = simulate
rebuild()
