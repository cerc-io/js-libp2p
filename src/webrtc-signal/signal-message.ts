// REQUEST is made on dial by a peer to another peer listening through a signalling stream
// RESPONSE is made by a peer to another peer on a REQUEST to establish a webrtc connection
export enum Type {
  REQUEST = 'REQUEST',
  RESPONSE = 'RESPONSE'
}

export interface SignallingMessage {
  type: Type
  src: string
  dst: string
  signal: string
}
