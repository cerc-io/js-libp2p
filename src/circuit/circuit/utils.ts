import { multiaddr } from '@multiformats/multiaddr'
import { CircuitRelay } from '../pb/index.js'
import type { StreamHandler } from './stream-handler.js'

/**
 * Write a response
 */
function writeResponse (streamHandler: StreamHandler, status: CircuitRelay.Status): void {
  streamHandler.write({
    type: CircuitRelay.Type.STATUS,
    code: status
  })
}

/**
 * Validate incomming HOP/STOP message
 */
export function validateAddrs (msg: CircuitRelay, streamHandler: StreamHandler): void {
  try {
    if (msg.dstPeer?.addrs != null) {
      msg.dstPeer.addrs.forEach((addr) => {
        return multiaddr(addr)
      })
    }
  } catch (err: any) {
    writeResponse(streamHandler, msg.type === CircuitRelay.Type.HOP
      ? CircuitRelay.Status.HOP_DST_MULTIADDR_INVALID
      : CircuitRelay.Status.STOP_DST_MULTIADDR_INVALID)
    throw err
  }

  try {
    if (msg.srcPeer?.addrs != null) {
      msg.srcPeer.addrs.forEach((addr) => {
        return multiaddr(addr)
      })
    }
  } catch (err: any) {
    writeResponse(streamHandler, msg.type === CircuitRelay.Type.HOP
      ? CircuitRelay.Status.HOP_SRC_MULTIADDR_INVALID
      : CircuitRelay.Status.STOP_SRC_MULTIADDR_INVALID)
    throw err
  }
}
