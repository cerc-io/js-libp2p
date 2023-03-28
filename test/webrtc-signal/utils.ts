import pWaitFor from 'p-wait-for'
import _ from 'lodash'

import * as mafmt from '@multiformats/mafmt'
import { webSockets } from '@libp2p/websockets'
import { mplex } from '@libp2p/mplex'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { PeerId } from '@libp2p/interface-peer-id'

import type { Libp2pOptions } from '../../src/index.js'
import { plaintext } from '../../src/insecure/index.js'
import { createLibp2pNode, Libp2pNode } from '../../src/libp2p.js'
import { RELAY_CODEC } from '../../src/circuit/multicodec.js'
import { WEBRTC_SIGNAL_CODEC } from '../../src/webrtc-signal/multicodec.js'
import { P2P_WEBRTC_STAR_ID } from '../../src/webrtc-signal/constants.js'

// p2p multi-address codes
export const CODE_P2P = 421
export const CODE_CIRCUIT = 290

export async function createPeer (relayPeerId: PeerId, relayMultiaddr: Multiaddr): Promise<Libp2pNode> {
  // Create a peer node with primary relay node addr
  const libp2p = await createLibp2p(relayPeerId.toString())

  // Connect the peer to the relay node
  await libp2p.start()
  await libp2p.peerStore.addressBook.add(relayPeerId, [relayMultiaddr])
  await libp2p.dial(relayPeerId)

  const libp2pListeningAddrs = [
    `${relayMultiaddr.toString()}/p2p-circuit/p2p/${libp2p.peerId}`,
    `${relayMultiaddr.toString()}/${P2P_WEBRTC_STAR_ID}/p2p/${libp2p.peerId}`
  ]
  await updatedMultiaddrs(libp2p, libp2pListeningAddrs)

  return libp2p
}

export async function createLibp2p (relayPeerId?: string): Promise<Libp2pNode> {
  let webRTCSignal = {}
  if (relayPeerId !== undefined && relayPeerId !== '') {
    webRTCSignal = {
      enabled: true,
      isSignallingNode: false,
      autoSignal: {
        enabled: true,
        relayPeerId
      }
    }
  }

  const options: Libp2pOptions = {
    transports: [webSockets({ filter: wsPeerFilter })],
    connectionEncryption: [plaintext()],
    streamMuxers: [mplex()],
    relay: {
      enabled: true,
      autoRelay: {
        enabled: true,
        maxListeners: 1
      }
    },
    webRTCSignal,
    connectionManager: {
      autoDial: false
    }
  }

  return await createLibp2pNode(options)
}

const wsPeerFilter = (multiaddrs: Multiaddr[]): Multiaddr[] => {
  return multiaddrs.filter((ma) => {
    if (ma.protoCodes().includes(CODE_CIRCUIT)) {
      return false
    }

    if (ma.protoNames().includes(P2P_WEBRTC_STAR_ID)) {
      return false
    }

    const testMa = ma.decapsulateCode(CODE_P2P)

    return mafmt.WebSockets.matches(testMa) ||
      mafmt.WebSocketsSecure.matches(testMa)
  })
}

export async function receivedListenerListeningEvent (node: Libp2pNode): Promise<void> {
  await new Promise<void>((resolve) => {
    node.components.transportManager.addEventListener('listener:listening', (evt) => {
      const listener = evt.detail
      const addrs = listener.getAddrs()
      addrs.forEach((addr) => {
        if (addr.toString().includes(P2P_WEBRTC_STAR_ID)) {
          resolve()
        }
      })
    })
  })
}

export async function receivedListenerCloseEvent (node: Libp2pNode): Promise<void> {
  await new Promise<void>((resolve) => {
    let eventCounter = 0
    node.components.transportManager.addEventListener('listener:close', () => {
      eventCounter++
      if (eventCounter === 2) {
        resolve()
      }
    })
  })
}

export async function discoveredRelayConfig (node: Libp2pNode, relayPeerId: PeerId): Promise<void> {
  await pWaitFor(async () => {
    const peerData = await node.peerStore.get(relayPeerId)
    const supportsRelay = peerData.protocols.includes(RELAY_CODEC)
    const supportsWebRTCSignalling = peerData.protocols.includes(WEBRTC_SIGNAL_CODEC)

    return supportsRelay && supportsWebRTCSignalling
  })
}

export async function updatedMultiaddrs (node: Libp2pNode, expectedMultiaddrs: string[]): Promise<void> {
  await pWaitFor(async () => {
    const multiaddrs = node.getMultiaddrs().map(addr => addr.toString())

    if (multiaddrs.length !== expectedMultiaddrs.length) {
      return false
    }

    return _.isEqual(multiaddrs.sort(), expectedMultiaddrs.sort())
  })
}
