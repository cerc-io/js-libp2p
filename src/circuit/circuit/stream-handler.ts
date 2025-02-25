import { logger } from '@libp2p/logger'
import * as lp from 'it-length-prefixed'
import { Handshake, handshake } from 'it-handshake'
import { CircuitRelay } from '../pb/index.js'
import type { Stream } from '@libp2p/interface-connection'
import type { Source, Duplex } from 'it-stream-types'
import type { Uint8ArrayList } from 'uint8arraylist'

const log = logger('libp2p:circuit:stream-handler')

export interface StreamHandlerOptions {
  /**
   * A duplex iterable
   */
  stream: Stream

  /**
   * max bytes length of message
   */
  maxLength?: number
}

export class StreamHandler {
  private readonly stream: Stream
  private readonly shake: Handshake<Uint8ArrayList | Uint8Array>
  private readonly decoder: Source<Uint8ArrayList>

  constructor (options: StreamHandlerOptions) {
    const { stream, maxLength = 4096 } = options

    this.stream = stream
    this.shake = handshake(this.stream)
    this.decoder = lp.decode.fromReader(this.shake.reader, { maxDataLength: maxLength })
  }

  /**
   * Read and decode message
   */
  async read (): Promise<CircuitRelay | undefined> {
    // @ts-expect-error FIXME is a source, needs to be a generator
    const msg = await this.decoder.next()

    if (msg.value != null) {
      const value = CircuitRelay.decode(msg.value)
      log('read message type', value.type)
      return value
    }

    log('read received no value, closing stream')
    // End the stream, we didn't get data
    this.close()
  }

  /**
   * Encode and write array of buffers
   */
  write (msg: CircuitRelay): void {
    log('write message type %s', msg.type)
    this.shake.write(lp.encode.single(CircuitRelay.encode(msg)))
  }

  /**
   * Return the handshake rest stream and invalidate handler
   */
  rest (): Duplex<Uint8ArrayList, Uint8ArrayList | Uint8Array, Promise<void>> {
    this.shake.rest()
    return this.shake.stream
  }

  /**
   * @param {CircuitRelay} msg - An unencoded CircuitRelay protobuf message
   */
  end (msg: CircuitRelay): void {
    this.write(msg)
    this.close()
  }

  /**
   * Close the stream
   */
  close (): void {
    log('closing the stream')
    void this.rest().sink([]).catch(err => {
      log.error(err)
    })
  }

  /**
   * Close underlying muxed stream
   */
  closeBaseStream (): void {
    this.stream.close()
  }
}
