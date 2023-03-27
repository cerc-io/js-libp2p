import map from 'it-map'
import { pipe } from 'it-pipe'
import type { Pushable } from 'it-pushable'
import * as lp from 'it-length-prefixed'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'

import { logger } from '@libp2p/logger'
import { multiaddr, Multiaddr } from '@multiformats/multiaddr'
import { peerIdFromString } from '@libp2p/peer-id'
import { CustomEvent, EventEmitter } from '@libp2p/interfaces/events'
import { Signal, WebRTCReceiver } from '@libp2p/webrtc-peer'
import type { Connection, Stream } from '@libp2p/interface-connection'
import type { ConnectionManager } from '@libp2p/interface-connection-manager'
import type { ConnectionHandler, Listener, Upgrader } from '@libp2p/interface-transport'

import { WEBRTC_SIGNAL_CODEC } from './multicodec.js'
import { SignallingMessage, Type } from './signal-message.js'
import { toMultiaddrConnection } from './socket-to-conn.js'

const log = logger('libp2p:webrtc-signal')

export interface ListenerOptions {
  handler?: ConnectionHandler
  upgrader: Upgrader
  connectionManager: ConnectionManager
}

export function createListener (options: ListenerOptions, peerInputStream: Pushable<any>, dialResponseStream: Pushable<any>): Listener {
  let listeningAddr: Multiaddr | undefined

  async function pipePeerInputStream (signallingStream: Stream): Promise<void> {
    // Empty out peerInputStream first
    while (peerInputStream.readableLength !== 0) {
      await peerInputStream.next()
    }

    // Send dial requests / responses to the relay node over the signalling stream
    void pipe(
      // Read from stream (the source)
      peerInputStream,
      // Turn objects into buffers
      (source) => map(source, (value) => {
        return uint8ArrayFromString(JSON.stringify(value))
      }),
      // Encode with length prefix (so receiving side knows how much data is coming)
      lp.encode(),
      // Write to the stream (the sink)
      signallingStream.sink
    )
  }

  async function handleSignallingMessages (signallingStream: Stream): Promise<void> {
    // Empty out dialResponseStream first
    while (dialResponseStream.readableLength !== 0) {
      await dialResponseStream.next()
    }

    // Handle incoming messages from the signalling stream
    void pipe(
      // Read from the stream (the source)
      signallingStream.source,
      // Decode length-prefixed data
      lp.decode(),
      // Turn buffers into objects
      (source) => map(source, (buf) => {
        return JSON.parse(uint8ArrayToString(buf.subarray()))
      }),
      // Sink function
      async (source) => {
        // For each chunk of data
        for await (const msg of source) {
          const signallingMsg = (msg as SignallingMessage)
          switch (signallingMsg.type) {
            case Type.REQUEST:
              log('got webrtc request from', signallingMsg.src)
              processRequest(signallingMsg)
              break
            case Type.RESPONSE:
              log('got webrtc response from', signallingMsg.src)
              dialResponseStream.push(signallingMsg)
              break
            default:
              log('unknown message', signallingMsg)
              break
          }
        }
      }
    )
  }

  function processRequest (request: SignallingMessage): void {
    const incSignal: Signal = JSON.parse(request.signal)

    if (incSignal.type !== 'offer') {
      // offers contain candidates so only respond to the offer
      return
    }

    const channel = new WebRTCReceiver()

    channel.addEventListener('signal', (evt) => {
      const signal = evt.detail
      const signalStr = JSON.stringify(signal)

      // Send response signal
      const response: SignallingMessage = {
        type: Type.RESPONSE,
        src: request.dst,
        dst: request.src,
        signal: signalStr
      }

      peerInputStream.push(response)
    })

    channel.addEventListener('error', (evt) => {
      const err = evt.detail

      log.error('incoming connection errored with', err)
      void channel.close().catch(err => {
        log.error(err)
      })
    })

    channel.addEventListener('ready', () => {
      void (async () => {
        if (listeningAddr === undefined) {
          const msg = 'listening address not set'
          throw new Error(msg)
        }

        const maConn = toMultiaddrConnection(channel, {
          // Form the multiaddr for this peer by appending it's peer id to the listening multiaddr
          remoteAddr: multiaddr(`${listeningAddr.toString()}/p2p/${request.dst}`)
        })
        log('new inbound connection %s', maConn.remoteAddr)

        const connection = await options.upgrader.upgradeInbound(maConn)
        log('inbound connection %s upgraded', maConn.remoteAddr)

        if (options.handler != null) {
          options.handler(connection)
        }

        listener.dispatchEvent(new CustomEvent<Connection>('connection', { detail: connection }))
      })()
    })

    channel.handleSignal(incSignal)
  }

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

    // Open a signalling stream to the relay node
    const signallingStream = await connection.newStream(WEBRTC_SIGNAL_CODEC)

    // Pipe messages from peerInputStream to signallingStream
    await pipePeerInputStream(signallingStream)

    // Handle messages from the signalling stream
    await handleSignallingMessages(signallingStream)

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
    }, { once: true })

    listeningAddr = addr
    listener.dispatchEvent(new CustomEvent('listening'))
  }

  function getAddrs (): Multiaddr[] {
    if (listeningAddr != null) {
      return [listeningAddr]
    }

    return []
  }

  async function close (): Promise<void> {
    listeningAddr = undefined
    listener.dispatchEvent(new CustomEvent('close'))
  }

  const listener: Listener = Object.assign(new EventEmitter(), {
    close,
    listen,
    getAddrs
  })

  return listener
}
