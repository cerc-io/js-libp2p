import { CustomEvent, EventEmitter } from '@libp2p/interfaces/events'
import type { ConnectionManager } from '@libp2p/interface-connection-manager'
import type { Listener } from '@libp2p/interface-transport'
import type { Multiaddr } from '@multiformats/multiaddr'

export interface ListenerOptions {
  connectionManager: ConnectionManager
}

export function createListener (options: ListenerOptions): Listener {
  let listeningAddr: Multiaddr
  let relayPeerIdString: string

  async function listen (addr: Multiaddr): Promise<void> {
    // TODO: Get connection with the primary relay node using connectionManager and addr
    // TODO: Open a stream on the connection for signalling
    // TODO: Set the listeningAddr and emit a listening event
  }

  function getAddrs (): Multiaddr[] {
    return [listeningAddr]
  }

  const listener: Listener = Object.assign(new EventEmitter(), {
    close: async () => await Promise.resolve(),
    listen,
    getAddrs
  })

  // Remove listeningAddrs when a peer disconnects
  options.connectionManager.addEventListener('peer:disconnect', (evt) => {
    const { detail: connection } = evt
    if (connection.remotePeer.toString() === relayPeerIdString) {
      // Announce listen addresses change
      listener.dispatchEvent(new CustomEvent('close'))
    }
  })

  return listener
}
