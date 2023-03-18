import { logger } from '@libp2p/logger'
import { symbol } from '@libp2p/interface-transport'
import type { PeerId } from '@libp2p/interface-peer-id'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { IncomingStreamData, Registrar } from '@libp2p/interface-registrar'
import type { Startable } from '@libp2p/interfaces/startable'
import type { AbortOptions } from '@libp2p/interfaces'
import type { Connection } from '@libp2p/interface-connection'
import type { ConnectionManager } from '@libp2p/interface-connection-manager'
import type { AddressManager } from '@libp2p/interface-address-manager'
import type { CreateListenerOptions, Listener, Transport, Upgrader } from '@libp2p/interface-transport'

import { createListener } from './listener.js'
import { WEBRTC_SIGNAL_CODEC } from './multicodec.js'

const log = logger('libp2p:webrtc-signal')

export interface WebRTCSignalComponents {
  peerId: PeerId
  registrar: Registrar
  connectionManager: ConnectionManager
  upgrader: Upgrader
  addressManager: AddressManager
}

export class WebRTCSignal implements Transport, Startable {
  private readonly components: WebRTCSignalComponents
  private _started: boolean

  constructor (components: WebRTCSignalComponents) {
    this.components = components
    this._started = false
  }

  isStarted () {
    return this._started
  }

  async start (): Promise<void> {
    if (this._started) {
      return
    }

    this._started = true

    // gets called on an incoming protocol stream
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
    // TODO Handle handshake between relay node and a peer
    // TODO Handle signalling messages for relay nodes and peers
  }

  async dial (ma: Multiaddr, options: AbortOptions = {}): Promise<Connection> {
    // TODO Extract the destination peer id from ma
    // TODO Create and send a SDP offer to the dest through the signalling channel with the relay node
    // TODO Create a MultiaddrConnection using the WebRTC connection and upgrade it

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return {} as Connection
  }

  createListener (options: CreateListenerOptions): Listener {
    return createListener({
      connectionManager: this.components.connectionManager
    })
  }

  filter (multiaddrs: Multiaddr[]): Multiaddr[] {
    // TODO: Design a custom filter for signalling addresses
    return multiaddrs.filter((ma) => ma.protoNames().includes('p2p-webrtc-star'))
  }
}
