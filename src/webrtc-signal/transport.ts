import map from 'it-map'
import { pipe } from 'it-pipe'
import { Pushable, pushable } from 'it-pushable'
import * as lp from 'it-length-prefixed'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { AbortError } from 'abortable-iterator'

import { logger } from '@libp2p/logger'
import { multiaddr } from '@multiformats/multiaddr'
import { symbol } from '@libp2p/interface-transport'
import { Signal, WebRTCInitiator } from '@libp2p/webrtc-peer'
import type { PeerId } from '@libp2p/interface-peer-id'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { IncomingStreamData, Registrar } from '@libp2p/interface-registrar'
import type { Startable } from '@libp2p/interfaces/startable'
import type { AbortOptions } from '@libp2p/interfaces'
import type { Connection, Stream } from '@libp2p/interface-connection'
import type { ConnectionManager } from '@libp2p/interface-connection-manager'
import type { CreateListenerOptions, Listener, Transport, Upgrader } from '@libp2p/interface-transport'

import { P2P_WEBRTC_STAR_ID } from './constants.js'
import { WEBRTC_SIGNAL_CODEC } from './multicodec.js'
import { createListener } from './listener.js'
import { SignallingMessage, Type } from './signal-message.js'
import { toMultiaddrConnection } from './socket-to-conn.js'
import { DialResponseListener } from './utils.js'
import { CIRCUIT_PROTO_CODE } from '../circuit/constants.js'

const log = logger('libp2p:webrtc-signal')

export interface WebRTCSignalComponents {
  peerId: PeerId
  registrar: Registrar
  connectionManager: ConnectionManager
  upgrader: Upgrader
}

export class WebRTCSignal implements Transport, Startable {
  // Startable service implmentation is concerned with relay nodes
  // Transport implmentation is concerned with peer nodes

  private readonly components: WebRTCSignalComponents

  private _started: boolean
  private readonly peerSignallingInputStreams: Map<string, Pushable<any>> = new Map()

  private readonly peerInputStream: Pushable<any>
  private readonly dialResponseStream: Pushable<any>
  private readonly dialResponseListener: DialResponseListener

  constructor (components: WebRTCSignalComponents) {
    this.components = components
    this._started = false

    this.peerInputStream = pushable<any>({ objectMode: true })
    this.dialResponseStream = pushable<any>({ objectMode: true })
    this.dialResponseListener = new DialResponseListener(this.dialResponseStream)
    void this.dialResponseListener.listen()
  }

  isStarted () {
    return this._started
  }

  async start (): Promise<void> {
    if (this._started) {
      return
    }

    this._started = true

    // Handle incoming protocol stream
    await this.components.registrar.handle(WEBRTC_SIGNAL_CODEC, (data) => {
      void this._onProtocol(data).catch(err => {
        log.error(err)
      })
    }).catch(err => {
      log.error(err)
    })
  }

  async stop () {
    await this.components.registrar.unhandle(WEBRTC_SIGNAL_CODEC)
  }

  get [symbol] (): true {
    return true
  }

  get [Symbol.toStringTag] () {
    return 'libp2p/webrtc-signal-v1'
  }

  async _onProtocol (data: IncomingStreamData) {
    const { connection, stream } = data

    await this._handlePeerSignallingStream(connection.remotePeer.toString(), stream)
  }

  async dial (ma: Multiaddr, options: AbortOptions = {}): Promise<Connection> {
    // Extract the relay and destination peer ids from ma
    const addrs = ma.toString().split(`/${P2P_WEBRTC_STAR_ID}`)
    const relayAddr = multiaddr(addrs[0])
    const destinationAddr = multiaddr(addrs[addrs.length - 1])
    const relayId = relayAddr.getPeerId()
    const destinationId = destinationAddr.getPeerId()

    if (relayId == null || destinationId == null) {
      const errMsg = 'WebRTC signal dial failed as address did not have peer id'
      log.error(errMsg)
      throw new Error(errMsg)
    }

    try {
      const socket = await this._connect(destinationId, options)

      const maConn = toMultiaddrConnection(socket, { remoteAddr: ma, signal: options.signal })
      log('new outbound connection %s', maConn.remoteAddr)

      const conn = await this.components.upgrader.upgradeOutbound(maConn)
      log('outbound connection %s upgraded', maConn.remoteAddr)

      return conn
    } catch (err) {
      log.error('WebRTC signal dial failed', err)
      throw err
    }
  }

  createListener (options: CreateListenerOptions): Listener {
    return createListener(
      { connectionManager: this.components.connectionManager, upgrader: this.components.upgrader, handler: options.handler },
      this.peerInputStream,
      this.dialResponseStream
    )
  }

  filter (multiaddrs: Multiaddr[]): Multiaddr[] {
    // A custom filter for signalling addresses
    return multiaddrs.filter((ma) => {
      if (ma.protoCodes().includes(CIRCUIT_PROTO_CODE)) {
        return false
      }

      return ma.protoNames().includes(P2P_WEBRTC_STAR_ID)
    })
  }

  async _handlePeerSignallingStream (peerId: string, signallingStream: Stream): Promise<void> {
    const inputStream = pushable<any>({ objectMode: true })

    // Send messages from inputStream to signallling stream
    void pipe(
      // Read from stream (the source)
      inputStream,
      // Turn objects into buffers
      (source) => map(source, (value) => {
        return uint8ArrayFromString(JSON.stringify(value))
      }),
      // Encode with length prefix (so receiving side knows how much data is coming)
      lp.encode(),
      // Write to the stream (the sink)
      signallingStream.sink
    )

    // Track input stream for this peer
    // TODO Untrack on disconnect
    this.peerSignallingInputStreams.set(peerId, inputStream)

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
          // Forward the signalling message to the destination
          const destStream = this.peerSignallingInputStreams.get(msg.dst)
          if (destStream !== undefined) {
            destStream.push(msg)
          } else {
            log('outgoing stream not found for dest', msg.dst)
          }
        }
      }
    )
  }

  async _connect (dstPeerId: string, options: AbortOptions) {
    const peerId = this.components.peerId.toString()

    if (options.signal?.aborted === true) {
      throw new AbortError()
    }

    // TODO Required?
    // const channelOptions = {
    //   initiator: true,
    //   trickle: false,
    //   ...this.initiatorOptions
    // }

    return await new Promise<WebRTCInitiator>((resolve, reject) => {
      let connected: boolean
      log('Dialing peer %s', dstPeerId)

      const channel = new WebRTCInitiator()

      const onError = (evt: CustomEvent<Error>) => {
        const err = evt.detail

        if (!connected) {
          const msg = `connection error ${dstPeerId}: ${err.message}`

          log.error(msg)
          err.message = msg
          done(err)
        }
      }

      const onReady = () => {
        connected = true

        log('connection opened %s', dstPeerId)
        done()
      }

      const onAbort = () => {
        log.error('connection aborted %s', dstPeerId)
        void channel.close().finally(() => {
          done(new AbortError())
        })
      }

      const done = (err?: Error) => {
        channel.removeEventListener('error', onError)
        channel.removeEventListener('ready', onReady)
        options.signal?.removeEventListener('abort', onAbort)

        if (err != null) {
          reject(err)
        } else {
          resolve(channel)
        }
      }

      channel.addEventListener('error', onError, {
        once: true
      })
      channel.addEventListener('ready', onReady, {
        once: true
      })
      channel.addEventListener('close', () => {
        channel.removeEventListener('error', onError)
      })
      options.signal?.addEventListener('abort', onAbort)

      const onSignal = async (signal: Signal) => {
        if (signal.type !== 'offer') {
          // skip candidates, just send the offer as it includes the candidates
          return
        }

        const signalStr = JSON.stringify(signal)

        try {
          // Create a connection request with signal string and send over signalling stream
          const request: SignallingMessage = {
            type: Type.REQUEST,
            src: peerId,
            dst: dstPeerId,
            signal: signalStr
          }

          // Wait for response message over the signalling stream
          const responseSignalJson = await new Promise<string>((resolve, reject) => {
            const onResponse = (evt: CustomEvent<SignallingMessage>) => {
              try {
                const msg = evt.detail

                if (
                  msg.type === Type.RESPONSE &&
                  msg.src === dstPeerId &&
                  msg.dst === peerId
                ) {
                  // Remove this handler after receiving the response
                  this.dialResponseListener.removeEventListener('response', onResponse)
                  resolve(msg.signal)
                }
              } catch (err) {
                reject(err)
              }
            }
            this.dialResponseListener.addEventListener('response', onResponse)

            this.peerInputStream.push(request)
          })

          const responseSignal = JSON.parse(responseSignalJson)
          channel.handleSignal(responseSignal)
        } catch (err: any) {
          await channel.close(err)
          reject(err)
        }
      }

      channel.addEventListener('signal', (evt) => {
        const signal = evt.detail

        void onSignal(signal).catch(async err => {
          await channel.close(err)
        })
      })
    })
  }
}
