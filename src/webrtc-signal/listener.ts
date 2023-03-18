import type { ConnectionManager } from '@libp2p/interface-connection-manager'
import type { Listener } from '@libp2p/interface-transport'
import { multiaddr, Multiaddr } from '@multiformats/multiaddr'
import { CustomEvent, EventEmitter } from '@libp2p/interfaces/events'
import { peerIdFromString } from '@libp2p/peer-id'

import { WEBRTC_SIGNAL_CODEC } from './multicodec.js'

export interface ListenerOptions {
  connectionManager: ConnectionManager
}

export function createListener (options: ListenerOptions): Listener {
  let listeningAddr: Multiaddr

  async function listen (addr: Multiaddr): Promise<void> {
    const relayMultiaddrString = addr.toString().split('/p2p-circuit').find(a => a !== '')
    const relayMultiaddr = multiaddr(relayMultiaddrString)
    const relayPeerIdString = relayMultiaddr.getPeerId()

    if (relayPeerIdString == null) {
      throw new Error('Could not determine primary relay peer from multiaddr')
    }

    const relayPeerId = peerIdFromString(relayPeerIdString)

    const connections = options.connectionManager.getConnections(relayPeerId)
    if (connections.length === 0) {
      throw new Error('Connection with primary relay node not found')
    }

    const connection = connections[0]

    // Open the signalling stream to the relay node
    await connection.newStream(WEBRTC_SIGNAL_CODEC)

    // TODO: Handle connect requests

    // Stop the listener when the primary relay node disconnects
    options.connectionManager.addEventListener('peer:disconnect', (evt) => {
      const { detail: connection } = evt

      // Check if it's the primary relay node
      if (connection.remotePeer.toString() === relayPeerIdString) {
        // Announce listen addresses change
        void (async () => {
          await listener.close()
        })()
      }
    })

    listeningAddr = addr
    listener.dispatchEvent(new CustomEvent('listening'))
  }

  function getAddrs (): Multiaddr[] {
    if (listeningAddr != null) {
      return [listeningAddr]
    }

    return []
  }

  async function close () {
    listener.dispatchEvent(new CustomEvent('close'))
  }

  const listener: Listener = Object.assign(new EventEmitter(), {
    close,
    listen,
    getAddrs
  })

  return listener
}
