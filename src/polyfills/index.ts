/**
 * Load order matters and is the whole point of this module.
 *
 * `./crypto` must fully evaluate before anything that touches @noble/hashes,
 * which WalletConnect does at import time. ES imports are hoisted but evaluate
 * top-to-bottom, so listing them in this order is the guarantee.
 */
import './crypto';

import '@walletconnect/react-native-compat';

import './verify';
