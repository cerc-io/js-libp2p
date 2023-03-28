/* eslint-env mocha */

import { expect } from 'aegir/chai'

import { createFromJSON } from '@libp2p/peer-id-factory'
import type { PeerId } from '@libp2p/interface-peer-id'

import type { Libp2pNode } from '../../src/libp2p.js'
import { WEBRTC_SIGNAL_CODEC } from '../../src/webrtc-signal/multicodec.js'
import { P2P_WEBRTC_STAR_ID } from '../../src/webrtc-signal/constants.js'
import { MULTIADDRS_WEBSOCKETS } from '../fixtures/browser.js'
import Peers from '../fixtures/peers.js'
import {
  createLibp2p,
  discoveredRelayConfig,
  receivedListenerCloseEvent,
  receivedListenerListeningEvent,
  updatedMultiaddrs
} from './utils.js'

describe('auto-signal', () => {
  let libp2p: Libp2pNode
  let relayPeerId: PeerId
  let relayPeerIdString: string
  let libp2pListeningAddrs: string[]

  before(async () => {
    const relayPeerIdJson = Peers[Peers.length - 1]
    relayPeerId = await createFromJSON(relayPeerIdJson)
    relayPeerIdString = relayPeerIdJson.id

    // Create a node with a primary relay node addr
    libp2p = await createLibp2p(relayPeerIdString)
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

  it('should start listening through a signalling stream to the relay node', async () => {
    await libp2p.peerStore.addressBook.add(relayPeerId, [MULTIADDRS_WEBSOCKETS[0]])
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
