let lastSignature = ''

async function getJSON(url, body) {
    const opts = body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined
    const res = await fetch(url, opts)
    return res.json()
}

async function createRoom() {
    await getJSON('/api/create', { distributorId: document.getElementById('createDist').value })
    refresh()
}

async function rebuild() {
    const config = {
        providers: Number(document.getElementById('providers').value),
        serversPerProvider: Number(document.getElementById('serversPerProvider').value),
        filterType: document.getElementById('filterType').value
    }
    document.getElementById('rebuildNote').textContent = 'restarting server workers…'
    await getJSON('/api/rebuild', config)
    for (const id of ['createDist', 'lookupDist']) document.getElementById(id).innerHTML = ''
    document.getElementById('sim').innerHTML = ''
    document.getElementById('out').textContent = 'Ready.'
    document.getElementById('rebuildNote').textContent = ''
    lastSignature = ''
    refresh()
}

async function simulate() {
    const s = await getJSON('/api/simulate?probes=200')
    const pct = (n) => (s.routes ? ((n / s.routes) * 100).toFixed(1) : '0.0')
    document.getElementById('sim').innerHTML =
        `<table>
       <tr><th>known rooms</th><td>${s.knownRooms}</td></tr>
       <tr><th>routes returned</th><td>${s.routes}</td></tr>
       <tr><th>correct routes</th><td>${s.correct} (${pct(s.correct)}%)</td></tr>
       <tr><th>false-positive routes</th><td>${s.falsePositive} (${pct(s.falsePositive)}%)</td></tr>
       <tr><th>missed known rooms</th><td>${s.missed}</td></tr>
       <tr><th>phantom hits (200 keys)</th><td>${s.phantom}</td></tr>
     </table>`
}

async function lookup() {
    const distributorId = document.getElementById('lookupDist').value
    const uuid = document.getElementById('uuid').value.trim()
    if (!uuid) return

    const link = `/api/where?distributorId=${encodeURIComponent(distributorId)}&uuid=${encodeURIComponent(uuid)}`
    const result = await getJSON(link)
    const state = await getJSON('/api/state')

    document.getElementById('out').textContent = JSON.stringify(result, null, 2)

    const portByServer = new Map(state.servers.map((s) => [s.serverId, s.port]))

    const directLinks = result.hits.map((hit) => {
        const port = portByServer.get(hit.serverId)
        if (!port) return ''

        const roomUrl = `http://127.0.0.1:${port}/indicant/rooms/${encodeURIComponent(result.key)}`

        return `
<p class="muted">
  Direct server check. <code>204</code> means the room was probably found;
  <code>404</code> means not known active.
</p>

<h4>HEAD check</h4>
<pre><code>curl -I "${roomUrl}"</code></pre>

<h4>GET check</h4>
<pre><code>curl -i "${roomUrl}"</code></pre>`
    }).filter(Boolean)

    document.getElementById('apiLinks').innerHTML = [
        `<a href="${link}">open this query as JSON</a>`,
        ...directLinks
    ].join('')
}

function fillSelects(distributors) {
    for (const id of ['createDist', 'lookupDist']) {
        const sel = document.getElementById(id)
        if (sel.options.length) continue
        sel.innerHTML = distributors.map((d) => `<option>${d.distributorId}</option>`).join('')
    }
}

function fillConfig(config) {
    const filter = document.getElementById('filterType')
    if (filter.dataset.init) return
    filter.value = config.filterType
    document.getElementById('providers').value = config.providers
    document.getElementById('serversPerProvider').value = config.serversPerProvider
    filter.dataset.init = '1'
}

async function refresh() {
    const s = await getJSON('/api/state')
    fillConfig(s.config)
    fillSelects(s.distributors)
    const signature = JSON.stringify({ config: s.config, distributors: s.distributors, rooms: s.rooms.length })
    if (signature === lastSignature) return
    lastSignature = signature
    document.getElementById('pollNote').textContent =
        `Distributors poll every server's GET /filter over HTTP every ${s.pollMs} ms.`
    document.getElementById('cluster').innerHTML = s.distributors.map((d) =>
        `<div class="card"><b>${d.distributorId}</b>
     <p class="muted">owns: ${d.owns.join(', ')}</p>
     <p class="muted">federates (remote snapshots): ${d.sees.join(', ') || '—'}</p></div>`).join('')
    document.getElementById('servers').innerHTML = '<table><tr><th>server</th><th>provider</th><th>port</th></tr>' +
        s.servers.map((x) => `<tr><td>${x.serverId}</td><td>${x.distributorId}</td><td><code>:${x.port}</code></td></tr>`).join('') +
        '</table>'
    document.getElementById('rooms').innerHTML = '<table><tr><th>distributor</th><th>server</th><th>uuid</th><th>key</th><th></th></tr>' +
        s.rooms.map((r) =>
            `<tr><td>${r.distributorId}</td><td>${r.serverId}</td>
       <td><code>${r.uuid}</code></td><td><code>${r.key.slice(0, 14)}…</code></td>
       <td><button onclick="document.getElementById('uuid').value='${r.uuid}'">use</button></td></tr>`).join('') +
        '</table>'
}

refresh()
setInterval(refresh, 3000)
