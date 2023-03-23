// Time to wait for a connection to close gracefully before destroying it manually
export const CLOSE_TIMEOUT = 2000

// Use a supported protocol id in multiaddr to listen through signalling stream
// Need to use one of the supported protocol names (list: https://github.com/multiformats/multiaddr/blob/master/protocols.csv) for the multiaddr to be valid
export const P2P_WEBRTC_STAR_ID = 'p2p-webrtc-star'

// Pubsub topic over which signalling nodes forward the signalling messages if not connected to the destination
export const WEBRTC_SIGNAL_TOPIC = 'webrtc-signal'
