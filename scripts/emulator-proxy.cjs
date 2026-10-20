// firebase-tools 15.24's apiv2 client installs an unconditional ProxyAgent,
// ignoring NO_PROXY even for its own Storage -> Firestore emulator requests.
// Route ONLY configured loopback emulator ports directly. All other traffic
// keeps the inherited proxy and TLS verification. Loaded only by test:rules.
const { createRequire } = require('node:module');
const firebaseRequire = createRequire(require.resolve('firebase-tools/package.json'));
const undici = firebaseRequire('undici');
const { emulators } = require('../firebase.json');
const ports = new Set(
  Object.values(emulators).filter(value => value.port).map(value => String(value.port)),
);
const OriginalProxyAgent = undici.ProxyAgent;
const localAgent = new undici.Agent();

undici.ProxyAgent = class EmulatorAwareProxyAgent extends OriginalProxyAgent {
  dispatch(options, handler) {
    const origin = new URL(options.origin);
    if (
      origin.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
      && ports.has(origin.port)
    ) {
      return localAgent.dispatch(options, handler);
    }
    return super.dispatch(options, handler);
  }
};
