import { logger } from '@libp2p/logger'
import { CircuitRelay as CircuitPB } from '../pb/index.js'
import { RELAY_CODEC } from '../multicodec.js'
import { StreamHandler } from './stream-handler.js'
import { validateAddrs } from './utils.js'
import type { Connection } from '@libp2p/interface-connection'
import type { Duplex } from 'it-stream-types'
import type { AbortOptions } from '@libp2p/interfaces'
import type { Uint8ArrayList } from 'uint8arraylist'

const log = logger('libp2p:circuit:stop')

export interface HandleStopOptions {
  connection: Connection
  request: CircuitPB
  streamHandler: StreamHandler
}

/**
 * Handles incoming STOP requests
 */
export function handleStop (options: HandleStopOptions): Duplex<Uint8ArrayList, Uint8ArrayList | Uint8Array> | undefined {
  const {
    connection,
    request,
    streamHandler
  } = options

  // Validate the STOP request has the required input
  try {
    validateAddrs(request, streamHandler)
  } catch (err: any) {
    log.error('invalid stop request via peer %p %o', connection.remotePeer, err)
    return
  }

  // The request is valid
  log('stop request is valid')
  streamHandler.write({
    type: CircuitPB.Type.STATUS,
    code: CircuitPB.Status.SUCCESS
  })

  return streamHandler.rest()
}

export interface StopOptions extends AbortOptions {
  connection: Connection
  request: CircuitPB
}

/**
 * Creates a STOP request
 */
export async function stop (options: StopOptions): Promise<Duplex<Uint8ArrayList, Uint8ArrayList | Uint8Array, Promise<void>> | undefined> {
  const {
    connection,
    request,
    signal
  } = options

  const stream = await connection.newStream(RELAY_CODEC, {
    signal
  })
  log('starting stop request to %p', connection.remotePeer)
  const streamHandler = new StreamHandler({ stream })

  streamHandler.write(request)
  const response = await streamHandler.read()

  if (response == null) {
    streamHandler.close()
    return
  }

  if (response.code === CircuitPB.Status.SUCCESS) {
    log('stop request to %p was successful', connection.remotePeer)
    return streamHandler.rest()
  }

  log('stop request failed with code %d', response.code)
  streamHandler.close()
}
