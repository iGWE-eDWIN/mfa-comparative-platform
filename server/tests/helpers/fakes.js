import { keys } from '../../src/services/keys.js';

/** In-memory mailer double: records messages, optionally fails. */
export function fakeMailer({ fail = false, delayMs = 0 } = {}) {
  const sent = [];
  return {
    sent,
    info: { provider: 'fake', tls: 'n/a', pooled: false },
    async init() {
      return this.info;
    },
    async sendOtp(msg) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (fail) throw new Error('SMTP unavailable');
      sent.push(msg);
      return { messageId: `<${sent.length}@fake>`, previewUrl: null, accepted: [msg.to] };
    },
  };
}

/** Module context with a controllable clock. */
export function makeCtx({ mailer = fakeMailer(), clock = { offsetMs: 0 } } = {}) {
  return {
    now: () => Date.now() + clock.offsetMs,
    keys,
    mailer,
    rp: { id: 'localhost', name: 'Test', origin: 'http://localhost:5173' },
    clock,
  };
}
