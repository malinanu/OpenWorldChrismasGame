/** Sends one-time codes. `console` is for staging and tests; production adds the local gateway. */
export interface SmsSender {
  send(phone: string, text: string): Promise<void>;
}

/** Logs the message instead of sending it, and keeps the last few for tests. */
export class ConsoleSms implements SmsSender {
  readonly sent: { phone: string; text: string }[] = [];
  async send(phone: string, text: string) {
    this.sent.push({ phone, text });
    if (this.sent.length > 50) this.sent.shift();
    console.log(`[sms:console] to ${phone}: ${text}`);
  }
}

export function createSms(provider: string): SmsSender {
  switch (provider) {
    case 'console':
      return new ConsoleSms();
    default:
      throw new Error(`Unknown SMS_PROVIDER "${provider}". Supported: console (a local gateway adapter is added once the provider is chosen).`);
  }
}
