import { logger } from '@libp2p/logger'
import errCode from 'err-code'
import { validateAddrs } from './utils.js'
import { StreamHandler } from './stream-handler.js'
import { CircuitRelay as CircuitPB } from '../pb/index.js'
import { pipe } from 'it-pipe'
import { codes as Errors } from '../../errors.js'
import { stop } from './stop.js'
import { RELAY_CODEC } from '../multicodec.js'
import type { Connection } from '@libp2p/interface-connection'
import { peerIdFromBytes } from '@libp2p/peer-id'
import type { Duplex } from 'it-stream-types'
import type { Circuit } from '../transport.js'
import type { ConnectionManager } from '@libp2p/interface-connection-manager'
import type { AbortOptions } from '@libp2p/interfaces'
import type { Uint8ArrayList } from 'uint8arraylist'

const log = logger('libp2p:circuit:hop')

export interface HopRequest {
  connection: Connection
  request: CircuitPB
  streamHandler: StreamHandler
  circuit: Circuit
  connectionManager: ConnectionManager
}

export async function handleHop (hopRequest: HopRequest): Promise<void> {
  const {
    connection,
    request,
    streamHandler,
    circuit,
    connectionManager
  } = hopRequest

  // Ensure hop is enabled
  if (!circuit.hopEnabled()) {
    log('HOP request received but we are not acting as a relay')
    streamHandler.end({
      type: CircuitPB.Type.STATUS,
      code: CircuitPB.Status.HOP_CANT_SPEAK_RELAY
    })

    return
  }

  // Validate the HOP request has the required input
  try {
    validateAddrs(request, streamHandler)
  } catch (err: any) {
    log.error('invalid hop request via peer %p %o', connection.remotePeer, err)

    return
  }

  if (request.dstPeer == null) {
    log('HOP request received but we do not receive a dstPeer')
    return
  }

  // Get the connection to the destination (stop) peer
  const destinationPeer = peerIdFromBytes(request.dstPeer.id)

  const destinationConnections = connectionManager.getConnections(destinationPeer)
  if (destinationConnections.length === 0 && !circuit.hopActive()) {
    log('HOP request received but we are not connected to the destination peer')
    streamHandler.end({
      type: CircuitPB.Type.STATUS,
      code: CircuitPB.Status.HOP_NO_CONN_TO_DST
    })

    return
  }

  // TODO: Handle being an active relay
  if (destinationConnections.length === 0) {
    log('did not have connection to remote peer')
    streamHandler.end({
      type: CircuitPB.Type.STATUS,
      code: CircuitPB.Status.HOP_NO_CONN_TO_DST
    })

    return
  }

  // Handle the incoming HOP request by performing a STOP request
  const stopRequest = {
    type: CircuitPB.Type.STOP,
    dstPeer: request.dstPeer,
    srcPeer: request.srcPeer
  }

  let destinationStream: Duplex<Uint8ArrayList>
  try {
    log('performing STOP request')
    const result = await stop({
      connection: destinationConnections[0],
      request: stopRequest
    })

    if (result == null) {
      throw new Error('Could not stop')
    }

    destinationStream = result
  } catch (err: any) {
    log.error(err)

    return
  }

  log('hop request from %p is valid', connection.remotePeer)
  streamHandler.write({
    type: CircuitPB.Type.STATUS,
    code: CircuitPB.Status.SUCCESS
  })
  const sourceStream = streamHandler.rest()

  log('creating related connections')
  // Short circuit the two streams to create the relayed connection
  await pipe(
    sourceStream,
    destinationStream,
    sourceStream
  )
}

export interface HopConfig extends AbortOptions {
  connection: Connection
  request: CircuitPB
}

/**
 * Performs a HOP request to a relay peer, to request a connection to another
 * peer. A new, virtual, connection will be created between the two via the relay.
 */
export async function hop (options: HopConfig): Promise<StreamHandler> {
  const {
    connection,
    request,
    signal
  } = options

  // Create a new stream to the relay
  const stream = await connection.newStream(RELAY_CODEC, {
    signal
  })
  // Send the HOP request
  const streamHandler = new StreamHandler({ stream })
  streamHandler.write(request)

  const response = await streamHandler.read()

  if (response == null) {
    throw errCode(new Error('HOP request had no response'), Errors.ERR_HOP_REQUEST_FAILED)
  }

  if (response.code === CircuitPB.Status.SUCCESS) {
    log('hop request was successful')

    return streamHandler
  }

  log('hop request failed with code %d, closing stream', response.code)
  streamHandler.close()

  throw errCode(new Error(`HOP request failed with code "${response.code ?? 'unknown'}"`), Errors.ERR_HOP_REQUEST_FAILED)
}

export interface CanHopOptions extends AbortOptions {
  connection: Connection
}

/**
 * Performs a CAN_HOP request to a relay peer, in order to understand its capabilities
 */
export async function canHop (options: CanHopOptions): Promise<boolean> {
  const {
    connection,
    signal
  } = options

  // Create a new stream to the relay
  const stream = await connection.newStream(RELAY_CODEC, {
    signal
  })

  // Send the HOP request
  const streamHandler = new StreamHandler({ stream })
  streamHandler.write({
    type: CircuitPB.Type.CAN_HOP
  })

  const response = await streamHandler.read()
  streamHandler.close()

  if (response == null || response.code !== CircuitPB.Status.SUCCESS) {
    return false
  }

  return true
}

export interface HandleCanHopOptions {
  connection: Connection
  streamHandler: StreamHandler
  circuit: Circuit
}

/**
 * Creates an unencoded CAN_HOP response based on the Circuits configuration
 */
export function handleCanHop (options: HandleCanHopOptions): void {
  const {
    connection,
    streamHandler,
    circuit
  } = options
  const canHop = circuit.hopEnabled()
  log('can hop (%s) request from %p', canHop, connection.remotePeer)
  streamHandler.end({
    type: CircuitPB.Type.STATUS,
    code: canHop ? CircuitPB.Status.SUCCESS : CircuitPB.Status.HOP_CANT_SPEAK_RELAY
  })
}
