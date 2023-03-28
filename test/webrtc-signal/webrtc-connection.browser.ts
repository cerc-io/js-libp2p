/* eslint-env mocha */

import assert from 'assert'
import { expect } from 'aegir/chai'

import { createFromJSON } from '@libp2p/peer-id-factory'
import type { PeerId } from '@libp2p/interface-peer-id'
import all from 'it-all'
import { pipe } from 'it-pipe'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'

import type { Libp2pNode } from '../../src/libp2p.js'
import { P2P_WEBRTC_STAR_ID } from '../../src/webrtc-signal/constants.js'
import { MULTIADDRS_WEBSOCKETS } from '../fixtures/browser.js'
import peers from '../fixtures/peers.js'
import { createPeerNode, updatedMultiaddrs } from './utils.js'

describe('webrtc-connections', () => {
  let libp2p1: Libp2pNode
  let libp2p2: Libp2pNode

  let relayPeerId: PeerId
  let relayPeerIdString: string

  before(async () => {
    const relayPeerIdJson = peers[peers.length - 1]
    relayPeerId = await createFromJSON(relayPeerIdJson)
    relayPeerIdString = relayPeerIdJson.id

    // Create peer nodes with primary relay node addr
    libp2p1 = await createPeerNode(relayPeerIdString)
    libp2p2 = await createPeerNode(relayPeerIdString)

    // Connect the peer nodes to the relay node
    await Promise.all([libp2p1, libp2p2].map(async libp2p => {
      await libp2p.start()
      await libp2p.peerStore.addressBook.add(relayPeerId, MULTIADDRS_WEBSOCKETS)
      await libp2p.dial(relayPeerId)

      const libp2pListeningAddrs = [
        `${MULTIADDRS_WEBSOCKETS[0].toString()}/p2p-circuit/p2p/${libp2p.peerId}`,
        `${MULTIADDRS_WEBSOCKETS[0].toString()}/${P2P_WEBRTC_STAR_ID}/p2p/${libp2p.peerId}`
      ]
      await updatedMultiaddrs(libp2p, libp2pListeningAddrs)
    }))

    // Handle an echo protocol on the second peer
    await libp2p2.handle('/echo/1.0.0', ({ stream }) => {
      void pipe(stream, stream)
    })
  })

  after(async () => {
    // Stop each node
    await Promise.all([libp2p1, libp2p2].map(async libp2p => { await libp2p.stop() }))
  })

  it('should dial and form a webrtc connection with another peer', async () => {
    const dialAddr = libp2p2.getMultiaddrs().find(addr => addr.toString().includes(P2P_WEBRTC_STAR_ID))
    assert(dialAddr, 'webrtc-star multiaddr not found')

    // Dial from frist node to the other using the webrtc-star address
    const connection = await libp2p1.dial(dialAddr)

    // Check connection params
    expect(connection).to.exist()
    expect(connection.remotePeer.toBytes()).to.eql(libp2p2.peerId.toBytes())
    expect(connection.remoteAddr).to.eql(dialAddr)

    // Create an echo stream over the webrtc connection
    const echoStream = await connection.newStream('/echo/1.0.0')

    // Send and receive echo
    const input = uint8ArrayFromString('hello')
    const [output] = await pipe(
      [input],
      echoStream,
      async (source) => await all(source)
    )

    // Check returned echo
    expect(output.slice()).to.eql(input)

    // Close the webrtc connection
    await connection.close()
  })
})
