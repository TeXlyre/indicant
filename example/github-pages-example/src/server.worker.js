import { createIndicant } from 'indicant/indicant'

let indicant = null

self.onmessage = (event) => {
  const msg = event.data
  if (msg.type === 'init') {
    indicant = createIndicant({
      role: 'embedded',
      tracker: true,
      checkStrategy: 'hybrid',
      filter: { type: msg.filterType, options: { capacity: 10_000 } }
    })
    self.postMessage({ id: msg.id, type: 'ready' })
    return
  }
  if (msg.type === 'enter') {
    indicant.enter(msg.room, msg.connection)
    self.postMessage({ id: msg.id, type: 'entered' })
    return
  }
  if (msg.type === 'filter') {
    const envelope = indicant.snapshotEnvelope(true)
    self.postMessage({ id: msg.id, type: 'snapshot', envelope })
    return
  }
}
