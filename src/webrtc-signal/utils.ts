import type { Pushable } from 'it-pushable'

import { logger } from '@libp2p/logger'
import { EventEmitter, CustomEvent } from '@libp2p/interfaces/events'

import type { SignallingMessage } from './signal-message.js'

const log = logger('libp2p:webrtc-signal')

export interface DialResponseListenerEvents {
  'response': CustomEvent<SignallingMessage>
}

export class DialResponseListener extends EventEmitter<DialResponseListenerEvents> {
  stream: Pushable<any>

  constructor (stream: Pushable<any>) {
    super()
    this.stream = stream
  }

  async listen (): Promise<void> {
    while (true) {
      try {
        const { done, value } = await this.stream.next()
        if (done !== undefined && done) {
          break
        }

        this.dispatchEvent(new CustomEvent<SignallingMessage>('response', { detail: value }))
      } catch (err) {
        log.error(err)
        break
      }
    }
  }
}
