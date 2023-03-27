import * as mafmt from '@multiformats/mafmt'
import { webSockets } from '@libp2p/websockets'
import { mplex } from '@libp2p/mplex'
import type { Multiaddr } from '@multiformats/multiaddr'

import type { Libp2pOptions } from '../../src/index.js'
import { plaintext } from '../../src/insecure/index.js'
import { createLibp2pNode, Libp2pNode } from '../../src/libp2p.js'
import { P2P_WEBRTC_STAR_ID } from '../../src/webrtc-signal/constants.js'

// p2p multi-address codes
export const CODE_P2P = 421
export const CODE_CIRCUIT = 290

export async function createPeerNode (relayPeerId?: string): Promise<Libp2pNode> {
  let webRTCSignal = {}
  if (relayPeerId !== undefined && relayPeerId !== '') {
    webRTCSignal = {
      enabled: true,
      isSignallingNode: false,
      autoSignal: {
        enabled: true,
        relayPeerId
      }
    }
  }

  const options: Libp2pOptions = {
    transports: [webSockets({ filter: wsPeerFilter })],
    connectionEncryption: [plaintext()],
    streamMuxers: [mplex()],
    relay: {
      enabled: true,
      autoRelay: {
        enabled: true,
        maxListeners: 1
      }
    },
    webRTCSignal,
    connectionManager: {
      autoDial: false
    }
  }

  return await createLibp2pNode(options)
}

// export interface RelayNodeInit {
//   host: string
//   port: number
// }

// export async function createRelayNode (init: RelayNodeInit): Promise<Libp2pNode> {
//   const options: Libp2pOptions = {
//     addresses: {
//       listen: [`/ip4/${init.host}/tcp/${init.port}/ws`]
//     },
//     transports: [webSockets()],
//     connectionEncryption: [plaintext()],
//     streamMuxers: [mplex()],
//     relay: {
//       enabled: true,
//       hop: {
//         enabled: true
//       }
//     },
//     webRTCSignal: {
//       enabled: true,
//       isSignallingNode: true
//     },
//     connectionManager: {
//       autoDial: false
//     }
//   }

//   return await createLibp2pNode(options)
// }

const wsPeerFilter = (multiaddrs: Multiaddr[]): Multiaddr[] => {
  return multiaddrs.filter((ma) => {
    if (ma.protoCodes().includes(CODE_CIRCUIT)) {
      return false
    }

    if (ma.protoNames().includes(P2P_WEBRTC_STAR_ID)) {
      return false
    }

    const testMa = ma.decapsulateCode(CODE_P2P)

    return mafmt.WebSockets.matches(testMa) ||
      mafmt.WebSocketsSecure.matches(testMa)
  })
}
