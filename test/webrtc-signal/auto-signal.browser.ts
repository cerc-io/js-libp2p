/* eslint-env mocha */

import { expect } from 'aegir/chai'
import pWaitFor from 'p-wait-for'
import _ from 'lodash'

import { createFromJSON } from '@libp2p/peer-id-factory'
import type { PeerId } from '@libp2p/interface-peer-id'

import type { Libp2pNode } from '../../src/libp2p.js'
import { RELAY_CODEC } from '../../src/circuit/multicodec.js'
import { WEBRTC_SIGNAL_CODEC } from '../../src/webrtc-signal/multicodec.js'
import { P2P_WEBRTC_STAR_ID } from '../../src/webrtc-signal/constants.js'
import { MULTIADDRS_WEBSOCKETS } from '../fixtures/browser.js'
import peers from '../fixtures/peers.js'
import { createPeerNode } from './utils.js'

async function receivedListenerEvent (node: Libp2pNode): Promise<void> {
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

async function discoveredRelayConfig (node: Libp2pNode, relayPeerId: PeerId): Promise<void> {
  await pWaitFor(async () => {
    const peerData = await node.peerStore.get(relayPeerId)
    const supportsRelay = peerData.protocols.includes(RELAY_CODEC)
    const supportsWebRTCSignalling = peerData.protocols.includes(WEBRTC_SIGNAL_CODEC)

    return supportsRelay && supportsWebRTCSignalling
  })
}

async function updatedMultiaddrs (node: Libp2pNode): Promise<void> {
  const expectedMultiaddrs = [
    `${MULTIADDRS_WEBSOCKETS[0].toString()}/p2p-circuit/p2p/${node.peerId}`,
    `${MULTIADDRS_WEBSOCKETS[0].toString()}/${P2P_WEBRTC_STAR_ID}/p2p/${node.peerId}`
  ]

  await pWaitFor(async () => {
    const multiaddrs = node.getMultiaddrs().map(addr => addr.toString())

    if (multiaddrs.length !== expectedMultiaddrs.length) {
      return false
    }

    return _.isEqual(multiaddrs.sort(), expectedMultiaddrs.sort())
  })
}

describe('auto-signal', () => {
  let libp2p: Libp2pNode
  let relayPeerId: PeerId
  let relayPeerIdString: string

  before(async () => {
    const relayPeerIdJson = peers[peers.length - 1]
    relayPeerId = await createFromJSON(relayPeerIdJson)
    relayPeerIdString = relayPeerIdJson.id

    // Create a node and with a primary relay node
    libp2p = await createPeerNode(relayPeerIdString)
    await libp2p.start()
  })

  after(async () => {
    // Stop each node
    await libp2p.stop()
  })

  it('should start listening through a singalling stream to the relay node', async () => {
    await libp2p.peerStore.addressBook.add(relayPeerId, MULTIADDRS_WEBSOCKETS)
    await libp2p.dial(relayPeerId)

    // Wait for the webrtc-signal listening event
    await receivedListenerEvent(libp2p)

    // Wait for peer added as listen relay
    await discoveredRelayConfig(libp2p, relayPeerId)

    // Check multiaddrs of the connected node
    await updatedMultiaddrs(libp2p)

    // Check that signalling stream exists with the relay node
    expect(libp2p.connectionManager.getConnections(relayPeerId)[0].streams.find(stream => stream.stat.protocol === WEBRTC_SIGNAL_CODEC)).to.not.be.empty()
  })
})
