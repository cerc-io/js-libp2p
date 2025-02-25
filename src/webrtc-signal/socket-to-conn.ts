import { abortableSource } from 'abortable-iterator'

import { logger } from '@libp2p/logger'
import type { AbortOptions } from '@libp2p/interfaces'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { MultiaddrConnection } from '@libp2p/interface-connection'
import type { WebRTCPeer } from '@libp2p/webrtc-peer'

import { CLOSE_TIMEOUT } from './constants.js'

const log = logger('libp2p:webrtc-signal:socket')

export interface ToMultiaddrConnectionOptions extends AbortOptions {
  remoteAddr: Multiaddr
}

// Ref: https://github.com/libp2p/js-libp2p-webrtc-direct/blob/master/src/socket-to-conn.ts
export function toMultiaddrConnection (socket: WebRTCPeer, options: ToMultiaddrConnectionOptions): MultiaddrConnection {
  const { sink, source } = socket

  const maConn: MultiaddrConnection = {
    remoteAddr: options.remoteAddr,

    async sink (source) {
      if (options.signal != null) {
        source = abortableSource(source, options.signal)
      }

      try {
        await sink(source)
      } catch (err: any) {
        // If aborted we can safely ignore
        if (err.type !== 'aborted') {
          // If the source errored the socket will already have been destroyed by
          // toIterable.duplex(). If the socket errored it will already be
          // destroyed. There's nothing to do here except log the error & return.
          log.error(err)
        }
      }
    },

    source: (options.signal != null) ? abortableSource(source, options.signal) : source,

    timeline: { open: Date.now() },

    async close () {
      if (socket.closed) {
        return
      }

      const start = Date.now()

      // Attempt to end the socket. If it takes longer to close than the
      // timeout, destroy it manually.
      const timeout = setTimeout(() => {
        if (maConn.remoteAddr != null) {
          const { host, port } = maConn.remoteAddr.toOptions()
          log('timeout closing socket to %s:%s after %dms, destroying it manually',
            host, port, Date.now() - start)
        }

        if (!socket.closed) {
          socket.close().catch(err => {
            log.error('could not close socket', err)
          })
        }
      }, CLOSE_TIMEOUT)

      try {
        await socket.close()
      } finally {
        clearTimeout(timeout)
      }
    }
  }

  socket.addEventListener('close', () => {
    // In instances where `close` was not explicitly called,
    // such as an iterable stream ending, ensure we have set the close
    // timeline
    if (maConn.timeline.close == null) {
      maConn.timeline.close = Date.now()
    }
  }, {
    once: true
  })

  return maConn
}
