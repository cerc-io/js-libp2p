/* eslint-env mocha */

import assert from 'assert'
import { expect } from 'aegir/chai'
import all from 'it-all'
import { pipe } from 'it-pipe'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'

import { createFromJSON } from '@libp2p/peer-id-factory'
import type { PeerId } from '@libp2p/interface-peer-id'
import type { Connection } from '@libp2p/interface-connection'

import type { Libp2pNode } from '../../src/libp2p.js'
import { P2P_WEBRTC_STAR_ID } from '../../src/webrtc-signal/constants.js'
import { MULTIADDRS_WEBSOCKETS } from '../fixtures/browser.js'
import Peers from '../fixtures/peers.js'
import { createPeer } from './utils.js'

describe('webrtc-connections: single relay setup', () => {
  describe('single relay setup', () => {
    let relayPeerId: PeerId
    let libp2p1: Libp2pNode
    let libp2p2: Libp2pNode
    let conn: Connection

    before(async () => {
      const relayPeerIdJson = Peers[Peers.length - 1]
      relayPeerId = await createFromJSON(relayPeerIdJson)

      // Create peer nodes connected to their primary relay node
      const libp2pPromise1 = createPeer(relayPeerId, MULTIADDRS_WEBSOCKETS[0])
      const libp2pPromise2 = createPeer(relayPeerId, MULTIADDRS_WEBSOCKETS[0])
      ;[libp2p1, libp2p2] = await Promise.all([libp2pPromise1, libp2pPromise2])

      // Handle an echo protocol on the second peer
      await libp2p2.handle('/echo/1.0.0', ({ stream }) => {
        void pipe(stream, stream)
      })
    })

    afterEach(async () => {
      // Close the webrtc connection between peers
      await conn.close()
    })

    after(async () => {
      // Stop each node
      await Promise.all([libp2p1, libp2p2].map(async libp2p => { await libp2p.stop() }))
    })

    it('should dial and form a webrtc connection with another peer', async () => {
      conn = await createP2PConnection(libp2p1, libp2p2)
      await testP2PConnection(conn)
    })

    it('should keep the webrtc connection with peer even on disconnecting from the relay node', async () => {
      conn = await createP2PConnection(libp2p1, libp2p2)

      // Disconnect peer1 from the relay node
      await libp2p1.hangUp(relayPeerId)

      await testP2PConnection(conn)
    })
  })

  describe('federated relay setup - direct connection between relay nodes', () => {
    let relayPeerId1: PeerId
    let relayPeerId2: PeerId
    let libp2p1: Libp2pNode
    let libp2p2: Libp2pNode
    let conn: Connection

    before(async () => {
      relayPeerId1 = await createFromJSON(Peers[Peers.length - 1])
      relayPeerId2 = await createFromJSON(Peers[Peers.length - 2])

      // Create peer nodes connected to their primary relay node
      const libp2pPromise1 = createPeer(relayPeerId1, MULTIADDRS_WEBSOCKETS[0])
      const libp2pPromise2 = createPeer(relayPeerId2, MULTIADDRS_WEBSOCKETS[1])
      ;[libp2p1, libp2p2] = await Promise.all([libp2pPromise1, libp2pPromise2])

      // Handle an echo protocol on the second peer
      await libp2p2.handle('/echo/1.0.0', ({ stream }) => {
        void pipe(stream, stream)
      })
    })

    afterEach(async () => {
      // Close the webrtc connection between peers
      await conn.close()
    })

    after(async () => {
      // Stop each node
      await Promise.all([libp2p1, libp2p2].map(async libp2p => { await libp2p.stop() }))
    })

    it('should dial and form a webrtc connection with peer connected to another relay node', async () => {
      conn = await createP2PConnection(libp2p1, libp2p2)
      await testP2PConnection(conn)
    })
  })

  describe('federated relay setup - no direct connection between relay nodes', () => {
    let relayPeerId1: PeerId
    let relayPeerId2: PeerId
    let libp2p1: Libp2pNode
    let libp2p2: Libp2pNode
    let conn: Connection

    before(async () => {
      relayPeerId1 = await createFromJSON(Peers[Peers.length - 1])
      relayPeerId2 = await createFromJSON(Peers[Peers.length - 3])

      // Create peer nodes connected to their primary relay node
      const libp2pPromise1 = createPeer(relayPeerId1, MULTIADDRS_WEBSOCKETS[0])
      const libp2pPromise2 = createPeer(relayPeerId2, MULTIADDRS_WEBSOCKETS[2])
      ;[libp2p1, libp2p2] = await Promise.all([libp2pPromise1, libp2pPromise2])

      // Handle an echo protocol on the second peer
      await libp2p2.handle('/echo/1.0.0', ({ stream }) => {
        void pipe(stream, stream)
      })
    })

    afterEach(async () => {
      // Close the webrtc connection between peers
      await conn.close()
    })

    after(async () => {
      // Stop each node
      await Promise.all([libp2p1, libp2p2].map(async libp2p => { await libp2p.stop() }))
    })

    it('should dial and form a webrtc connection with peer connected to another relay node', async () => {
      conn = await createP2PConnection(libp2p1, libp2p2)
      await testP2PConnection(conn)
    })
  })
})

async function createP2PConnection (libp2p1: Libp2pNode, libp2p2: Libp2pNode): Promise<Connection> {
  const dialAddr = libp2p2.getMultiaddrs().find(addr => addr.toString().includes(P2P_WEBRTC_STAR_ID))
  assert(dialAddr, 'webrtc-star multiaddr not found')

  // Dial from first node to the other using the webrtc-star address
  const conn = await libp2p1.dial(dialAddr)

  // Check connection params
  expect(conn).to.exist()
  expect(conn.remotePeer.toBytes()).to.eql(libp2p2.peerId.toBytes())
  expect(conn.remoteAddr).to.eql(dialAddr)

  return conn
}

async function testP2PConnection (conn: Connection): Promise<void> {
  // Create an echo stream over the webrtc connection
  const echoStream = await conn.newStream('/echo/1.0.0')

  // Send and receive echo
  const input = uint8ArrayFromString('hello')
  const [output] = await pipe(
    [input],
    echoStream,
    async (source) => await all(source)
  )

  // Check returned echo
  expect(output.slice()).to.eql(input)
}
