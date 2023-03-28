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

async function receivedListenerListeningEvent (node: Libp2pNode): Promise<void> {
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

async function receivedListenerCloseEvent (node: Libp2pNode): Promise<void> {
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

async function discoveredRelayConfig (node: Libp2pNode, relayPeerId: PeerId): Promise<void> {
  await pWaitFor(async () => {
    const peerData = await node.peerStore.get(relayPeerId)
    const supportsRelay = peerData.protocols.includes(RELAY_CODEC)
    const supportsWebRTCSignalling = peerData.protocols.includes(WEBRTC_SIGNAL_CODEC)

    return supportsRelay && supportsWebRTCSignalling
  })
}

async function updatedMultiaddrs (node: Libp2pNode, expectedMultiaddrs: string[]): Promise<void> {
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
  let libp2pListeningAddrs: string[]

  before(async () => {
    const relayPeerIdJson = peers[peers.length - 1]
    relayPeerId = await createFromJSON(relayPeerIdJson)
    relayPeerIdString = relayPeerIdJson.id

    // Create a node and with a primary relay node
    libp2p = await createPeerNode(relayPeerIdString)
    await libp2p.start()

    libp2pListeningAddrs = [
      `${MULTIADDRS_WEBSOCKETS[0].toString()}/p2p-circuit/p2p/${libp2p.peerId}`,
      `${MULTIADDRS_WEBSOCKETS[0].toString()}/${P2P_WEBRTC_STAR_ID}/p2p/${libp2p.peerId}`
    ]
  })

  after(async () => {
    // Stop each node
    await libp2p.stop()
  })

  it('should start listening through a singalling stream to the relay node', async () => {
    await libp2p.peerStore.addressBook.add(relayPeerId, MULTIADDRS_WEBSOCKETS)
    await libp2p.dial(relayPeerId)

    // Wait for the webrtc-signal listening event
    await expect(receivedListenerListeningEvent(libp2p)).to.be.eventually.fulfilled()

    // Wait for peer added as listen relay
    await expect(discoveredRelayConfig(libp2p, relayPeerId)).to.be.eventually.fulfilled()

    // Check multiaddrs of the connected node
    await expect(updatedMultiaddrs(libp2p, libp2pListeningAddrs)).to.be.eventually.fulfilled()

    // Check that signalling stream exists with the relay node
    expect(libp2p.connectionManager.getConnections(relayPeerId)[0].streams.find(stream => stream.stat.protocol === WEBRTC_SIGNAL_CODEC)).to.not.be.empty()
  })

  it('should stop listening on disconnecting from the relay node', async () => {
    // Check that both the listeners for the peer node get closed
    const listenersClosed = receivedListenerCloseEvent(libp2p)

    // Check multiaddrs of the connected node
    const multiaddrsUpdated = updatedMultiaddrs(libp2p, [])

    // Disconnect from the relay node
    await libp2p.hangUp(relayPeerId)

    await expect(listenersClosed).to.be.eventually.fulfilled()
    await expect(multiaddrsUpdated).to.be.eventually.fulfilled()
  })

  it('should start listening on reconnecting to the relay node', async () => {
    await libp2p.dial(relayPeerId)

    // Wait for the webrtc-signal listening event
    await expect(receivedListenerListeningEvent(libp2p)).to.be.eventually.fulfilled()

    // Wait for peer added as listen relay
    await expect(discoveredRelayConfig(libp2p, relayPeerId)).to.be.eventually.fulfilled()

    // Check multiaddrs of the connected node
    await expect(updatedMultiaddrs(libp2p, libp2pListeningAddrs)).to.be.eventually.fulfilled()

    // Check that signalling stream exists with the relay node
    expect(libp2p.connectionManager.getConnections(relayPeerId)[0].streams.find(stream => stream.stat.protocol === WEBRTC_SIGNAL_CODEC)).to.not.be.empty()
  })
})
