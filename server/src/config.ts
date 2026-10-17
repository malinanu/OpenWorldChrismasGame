/** Server settings from the environment (a `.env` file on the server; never committed). */
export interface Config {
  port: number;
  host: string;
  db: { host: string; port: number; user: string; password: string; database: string };
  /** Which sign-in the client offers: email + password, or phone + SMS code. */
  authMode: 'email' | 'phone';
  /** `console` logs codes (staging/tests); a gateway adapter is added when the provider is chosen. */
  smsProvider: string;
  sessionDays: number;
  /** Allowed browser origin for CORS (dev); in production the game and API share one origin. */
  origin: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const authMode = env.AUTH_MODE === 'phone' ? 'phone' : 'email';
  return {
    port: Number(env.PORT ?? 3100),
    host: env.HOST ?? '127.0.0.1',
    db: {
      host: env.DB_HOST ?? '127.0.0.1',
      port: Number(env.DB_PORT ?? 3306),
      user: env.DB_USER ?? 'frostvale',
      password: env.DB_PASSWORD ?? '',
      database: env.DB_NAME ?? 'frostvale',
    },
    authMode,
    smsProvider: env.SMS_PROVIDER ?? 'console',
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    origin: env.ORIGIN ?? null,
  };
}
