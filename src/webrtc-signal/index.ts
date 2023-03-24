import { logger } from '@libp2p/logger'
import type { PeerId } from '@libp2p/interface-peer-id'
import type { PeerStore, PeerProtocolsChangeData } from '@libp2p/interface-peer-store'
import type { Connection } from '@libp2p/interface-connection'
import type { ConnectionManager } from '@libp2p/interface-connection-manager'
import type { TransportManager } from '@libp2p/interface-transport'

import { WEBRTC_SIGNAL_CODEC } from './multicodec.js'
import { P2P_WEBRTC_STAR_ID } from './constants.js'

const log = logger('libp2p:webrtc-signal:auto-signal')

export interface WebRTCSignalConfig {
  enabled: boolean
  isSignallingNode: boolean
  autoSignal: AutoSignalConfig
}

export interface AutoSignalConfig {
  enabled: boolean
  relayPeerId: string
}

export interface SignalComponents {
  peerStore: PeerStore
  connectionManager: ConnectionManager
  transportManager: TransportManager
}

export class AutoSignal {
  private readonly components: SignalComponents
  private readonly relayPeerId: string
  private isListening: boolean = false

  constructor (components: SignalComponents, init: AutoSignalConfig) {
    this.components = components
    this.relayPeerId = init.relayPeerId

    this._onProtocolChange = this._onProtocolChange.bind(this)
    this._onPeerConnected = this._onPeerConnected.bind(this)
    this._onPeerDisconnected = this._onPeerDisconnected.bind(this)

    this.components.peerStore.addEventListener('change:protocols', (evt) => {
      void this._onProtocolChange(evt).catch(err => {
        log.error(err)
      })
    })

    this.components.connectionManager.addEventListener('peer:connect', (evt) => {
      void this._onPeerConnected(evt).catch(err => {
        log.error(err)
      })
    })

    this.components.connectionManager.addEventListener('peer:disconnect', (evt) => { this._onPeerDisconnected(evt) })
  }

  async _onProtocolChange (evt: CustomEvent<PeerProtocolsChangeData>): Promise<void> {
    const {
      peerId,
      protocols
    } = evt.detail

    await this._handleProtocols(peerId, protocols)
  }

  async _onPeerConnected (evt: CustomEvent<Connection>): Promise<void> {
    const connection = evt.detail
    const peerId = connection.remotePeer
    const protocols = await this.components.peerStore.protoBook.get(peerId)

    // Handle protocols on peer connection as change:protocols event is not triggered after reconnection between peers.
    await this._handleProtocols(peerId, protocols)
  }

  _onPeerDisconnected (evt: CustomEvent<Connection>): void {
    const connection = evt.detail

    if (connection.remotePeer.toString() === this.relayPeerId.toString()) {
      this.isListening = false
    }
  }

  async _handleProtocols (peerId: PeerId, protocols: string[]): Promise<void> {
    // Ignore if we are already listening or it's not the primary relay node
    if (this.isListening || peerId.toString() !== this.relayPeerId) {
      return
    }

    // Check if it has the protocol
    const hasProtocol = protocols.find(protocol => protocol === WEBRTC_SIGNAL_CODEC)

    // Ignore if protocol is not supported
    if (hasProtocol == null) {
      return
    }

    // If required protocol is supported, start the listener
    const connections = this.components.connectionManager.getConnections(peerId)
    if (connections.length === 0) {
      return
    }

    const connection = connections[0]
    await this._addListener(connection)
  }

  /**
   * Attempt to listen on the given connection with relay node
   */
  async _addListener (connection: Connection): Promise<void> {
    try {
      const remoteAddr = connection.remoteAddr

      // Attempt to listen on relay
      const multiaddr = remoteAddr.encapsulate(`/${P2P_WEBRTC_STAR_ID}`)

      // Announce multiaddr will update on listen success by TransportManager event being triggered
      await this.components.transportManager.listen([multiaddr])
      this.isListening = true
    } catch (err: any) {
      log.error('error listening on signalling address', err)
      this.isListening = false
      throw err
    }
  }
}
