import { webSockets } from '@libp2p/websockets'
import { mplex } from '@libp2p/mplex'
import { noise } from '@chainsafe/libp2p-noise'
import { floodsub } from '@libp2p/floodsub'
import { pipe } from 'it-pipe'
import { createFromJSON } from '@libp2p/peer-id-factory'
import mergeOptions from 'merge-options'

/** @type {import('aegir').PartialOptions} */
export default {
  build: {
    bundlesizeMax: '147kB'
  },
  test: {
    before: async () => {
      // use dynamic import because we only want to reference these files during the test run, e.g. after building
      const { createLibp2p } = await import('./dist/src/index.js')
      const { MULTIADDRS_WEBSOCKETS } = await import('./dist/test/fixtures/browser.js')
      const { plaintext } = await import('./dist/src/insecure/index.js')
      const { default: Peers } = await import('./dist/test/fixtures/peers.js')

      const options = {
        connectionManager: {
          inboundConnectionThreshold: Infinity
        },
        transports: [
          webSockets()
        ],
        streamMuxers: [
          mplex()
        ],
        pubsub: floodsub({ globalSignaturePolicy: 'StrictSign' }),
        connectionEncryption: [
          noise(),
          plaintext()
        ],
        relay: {
          enabled: true,
          hop: {
            enabled: true,
            active: false
          }
        },
        webRTCSignal: {
          enabled: true,
          isSignallingNode: true
        },
        nat: {
          enabled: false
        }
      }

      const peers = []
      for (let index = 0; index < 3; index++) {
        const peerId = await createFromJSON(Peers[Peers.length - index - 1])
        const peerOptions = {
          peerId,
          addresses: {
            listen: [MULTIADDRS_WEBSOCKETS[index]]
          }
        }

        const libp2p = await createLibp2p(mergeOptions(options, peerOptions))

        // Add the echo protocol
        await libp2p.handle('/echo/1.0.0', ({ stream }) => {
          pipe(stream, stream)
            .catch() // sometimes connections are closed before multistream-select finishes which causes an error
        })

        if (peers.length > 0) {
          const previousPeerIndex = peers.length - 1
          const previousPeerId = peers[previousPeerIndex].peerId

          await libp2p.peerStore.addressBook.add(previousPeerId, peers[previousPeerIndex].getMultiaddrs())
          await libp2p.dial(previousPeerId)
        }

        peers.push(libp2p)
      }

      return {
        peers
      }
    },
    after: async (_, before) => {
      await Promise.all(before.peers.map(async libp2p => { await libp2p.stop() }))
    }
  }
}
