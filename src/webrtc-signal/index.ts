import { logger } from '@libp2p/logger'
import type { PeerId } from '@libp2p/interface-peer-id'
import type { PeerStore, PeerProtocolsChangeData } from '@libp2p/interface-peer-store'
import type { Connection } from '@libp2p/interface-connection'
import type { ConnectionManager } from '@libp2p/interface-connection-manager'
import type { TransportManager, Listener } from '@libp2p/interface-transport'

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
  // TODO: Required?
  // private readonly onError: (error: Error, msg?: string) => void

  constructor (components: SignalComponents, init: AutoSignalConfig) {
    this.components = components
    this.relayPeerId = init.relayPeerId

    this._onProtocolChange = this._onProtocolChange.bind(this)
    this._onPeerConnected = this._onPeerConnected.bind(this)
    this._onListenerClosed = this._onListenerClosed.bind(this)

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

    this.components.transportManager.addEventListener('listener:close', (evt) => this._onListenerClosed(evt))
  }

  async _onPeerConnected (evt: CustomEvent<Connection>) {
    const connection = evt.detail
    const peerId = connection.remotePeer
    const protocols = await this.components.peerStore.protoBook.get(peerId)

    // Handle protocols on peer connection as change:protocols event is not triggered after reconnection between peers.
    await this._handleProtocols(peerId, protocols)
  }

  async _onProtocolChange (evt: CustomEvent<PeerProtocolsChangeData>) {
    const {
      peerId,
      protocols
    } = evt.detail

    await this._handleProtocols(peerId, protocols)
  }

  _onListenerClosed (evt: CustomEvent<Listener>) {
    const listener = evt.detail
    const listenAddrs = listener.getAddrs()

    if (listenAddrs.length === 0) {
      return
    }

    // Check if it's the concerned listener
    if (!listenAddrs[0].protoNames().includes(P2P_WEBRTC_STAR_ID)) {
      return
    }

    this.isListening = false
  }

  async _handleProtocols (peerId: PeerId, protocols: string[]) {
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

    // TODO Required?
    // await this.components.peerStore.metadataBook.setValue(peerId, HOP_METADATA_KEY, uint8ArrayFromString(HOP_METADATA_VALUE))

    await this._addListener(connection)
  }

  /**
   * Attempt to listen on the given connection with relay node
   */
  async _addListener (connection: Connection): Promise<void> {
    try {
      const remoteAddr = connection.remoteAddr

      // Attempt to listen on relay
      const multiaddr = remoteAddr.encapsulate('/p2p-webrtc-star')

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
