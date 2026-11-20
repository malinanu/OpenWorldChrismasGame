import { createHash, randomBytes } from 'node:crypto';
import type mysql from 'mysql2/promise';
import type { PayHereConfig } from './config.ts';
import type { Pool, Row } from './db.ts';
import { getPack, type PackId, type Tokens } from './tokens.ts';

/**
 * Token packs through PayHere's hosted checkout (https://support.payhere.lk/api-&-mobile-sdk/checkout-api).
 * The game posts a form straight to PayHere; PayHere calls our notify URL server-to-server with
 * the result, signed with the merchant secret, and only that call credits tokens.
 */
const md5 = (s: string) => createHash('md5').update(s).digest('hex').toUpperCase();
const money = (n: number) => n.toFixed(2);

export interface Customer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'chargedback';

/** PayHere's status_code values. */
const STATUS: Record<string, PaymentStatus> = { '2': 'paid', '0': 'pending', '-1': 'cancelled', '-2': 'failed', '-3': 'chargedback' };

export class PayHere {
  private readonly cfg: PayHereConfig;
  private readonly db: Pool;
  private readonly tokens: Tokens;
  /** Told when a payment changes someone's balance (the game updates their token count live). */
  onBalance?: (userId: number, tokens: number) => void;

  constructor(cfg: PayHereConfig, db: Pool, tokens: Tokens) {
    this.cfg = cfg;
    this.db = db;
    this.tokens = tokens;
  }

  get enabled() {
    return !!(this.cfg.merchantId && this.cfg.merchantSecret);
  }

  get checkoutUrl() {
    return this.cfg.sandbox ? 'https://sandbox.payhere.lk/pay/checkout' : 'https://www.payhere.lk/pay/checkout';
  }

  /** The hash PayHere checks on the checkout form. */
  checkoutHash(orderId: string, amount: number, currency = 'LKR') {
    return md5(this.cfg.merchantId + orderId + money(amount) + currency + md5(this.cfg.merchantSecret));
  }

  /** The signature PayHere puts on its notify call. */
  notifySignature(f: { merchant_id: string; order_id: string; payhere_amount: string; payhere_currency: string; status_code: string }) {
    return md5(f.merchant_id + f.order_id + f.payhere_amount + f.payhere_currency + f.status_code + md5(this.cfg.merchantSecret));
  }

  /** A new order for a pack at our own price, and the fields for the form posted to PayHere. */
  async checkout(userId: number, packId: PackId, c: Customer) {
    const pack = getPack(packId)!;
    const orderId = `FV${Date.now().toString(36).toUpperCase()}${randomBytes(4).toString('hex').toUpperCase()}`;
    await this.db.query('INSERT INTO payments (order_id, user_id, pack, amount, currency, tokens) VALUES (?, ?, ?, ?, ?, ?)', [orderId, userId, pack.id, pack.amount, 'LKR', pack.tokens]);
    const base = this.cfg.publicUrl;
    return {
      action: this.checkoutUrl,
      orderId,
      fields: {
        merchant_id: this.cfg.merchantId,
        return_url: `${base}/?paid=${orderId}`,
        cancel_url: `${base}/?paycancel=${orderId}`,
        notify_url: `${base}/api/payhere/notify`,
        order_id: orderId,
        items: `Frostvale ${pack.tokens} fight tokens`,
        currency: 'LKR',
        amount: money(pack.amount),
        first_name: c.firstName,
        last_name: c.lastName,
        email: c.email,
        phone: c.phone,
        address: 'Frostvale',
        city: 'Colombo',
        country: 'Sri Lanka',
        custom_1: String(userId),
        hash: this.checkoutHash(orderId, pack.amount),
      },
    };
  }

  /**
   * PayHere's server-to-server result. Credits the pack exactly once (repeat notifications do
   * nothing), only with a valid signature, our merchant ID and the order's own amount and currency.
   */
  async notify(f: Record<string, string | undefined>): Promise<{ ok: boolean; reason?: string }> {
    const need = ['merchant_id', 'order_id', 'payhere_amount', 'payhere_currency', 'status_code', 'md5sig'] as const;
    if (need.some((k) => typeof f[k] !== 'string')) return { ok: false, reason: 'missing' };
    const fields = f as Record<(typeof need)[number], string> & Record<string, string | undefined>;
    if (!this.enabled || fields.merchant_id !== this.cfg.merchantId) return { ok: false, reason: 'merchant' };
    if (this.notifySignature(fields) !== fields.md5sig.toUpperCase()) return { ok: false, reason: 'signature' };
    const status = STATUS[fields.status_code];
    if (!status) return { ok: false, reason: 'status' };

    const conn = await this.db.getConnection();
    let balance: { userId: number; tokens: number } | null = null;
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query<Row[]>('SELECT * FROM payments WHERE order_id = ? FOR UPDATE', [fields.order_id]);
      const order = rows[0];
      if (!order) {
        await conn.rollback();
        return { ok: false, reason: 'order' };
      }
      if (money(Number(order.amount)) !== money(Number(fields.payhere_amount)) || order.currency !== fields.payhere_currency) {
        await conn.rollback();
        return { ok: false, reason: 'amount' };
      }
      const userId = Number(order.user_id);
      const tokens = Number(order.tokens);
      const set = async (s: PaymentStatus, extra = '') =>
        conn.query(`UPDATE payments SET status = ?, payhere_payment_id = COALESCE(?, payhere_payment_id), method = COALESCE(?, method), updated_at = UTC_TIMESTAMP()${extra} WHERE order_id = ?`, [
          s,
          fields.payment_id ?? null,
          fields.method?.slice(0, 16) ?? null,
          fields.order_id,
        ]);
      if (status === 'paid' && order.status !== 'paid' && order.status !== 'chargedback') {
        await set('paid', ', paid_at = UTC_TIMESTAMP()');
        balance = { userId, tokens: await this.tokens.creditIn(conn as mysql.PoolConnection, userId, tokens, 'purchase', fields.order_id) };
      } else if (status === 'chargedback' && order.status === 'paid') {
        await set('chargedback');
        balance = { userId, tokens: await this.tokens.debitIn(conn as mysql.PoolConnection, userId, tokens, 'chargeback', fields.order_id) };
      } else if (order.status === 'pending' && status !== 'paid' && status !== 'chargedback') {
        await set(status);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    if (balance) this.onBalance?.(balance.userId, balance.tokens);
    return { ok: true };
  }

  /** One of the player's own orders, for the "payment received?" check after PayHere sends them back. */
  async order(userId: number, orderId: string) {
    const [rows] = await this.db.query<Row[]>('SELECT order_id, pack, amount, tokens, status FROM payments WHERE order_id = ? AND user_id = ?', [orderId, userId]);
    const o = rows[0];
    return o ? { orderId: o.order_id as string, pack: o.pack as string, amount: Number(o.amount), tokens: Number(o.tokens), status: o.status as PaymentStatus } : null;
  }
}
