import { audio } from '../core/Audio';
import { ft } from '../fight/strings';
import { api, type Customer, type Pack } from '../net/api';
import { wallet } from '../net/wallet';
import { esc } from './account';

const CUSTOMER_KEY = 'frostvale.payCustomer';

function savedCustomer(): Partial<Customer> {
  try {
    return JSON.parse(localStorage.getItem(CUSTOMER_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/**
 * The passport's 🪙 Shop tab: the token balance and three packs. Buying shows a short form
 * (PayHere needs a name, email and phone), then hands the player to PayHere's secure page;
 * they come back to `?paid=<order>` and the game shows the new tokens (session.ts).
 */
export function mountShop(root: HTMLElement) {
  const draw = (html: string) => {
    root.innerHTML = `<h3 class="pp-sub">${ft('shopTitle')} <span class="shop-bal">🪙 ${wallet.tokens ?? '–'}</span></h3>${html}`;
  };
  const legal = `<p class="shop-legal"><a href="terms.html" target="_blank" rel="noopener">${ft('terms')}</a> · <a href="privacy.html" target="_blank" rel="noopener">${ft('privacy')}</a> · <a href="refunds.html" target="_blank" rel="noopener">${ft('refunds')}</a></p>`;
  wallet.on(() => {
    const b = root.querySelector('.shop-bal');
    if (b) b.textContent = `🪙 ${wallet.tokens ?? '–'}`;
  });

  if (!api.user) {
    draw(`<div class="pp-invite">${ft('shopSignIn')}</div>`);
    return;
  }
  draw(`<p class="lb-wait">…</p>`);
  void api
    .tokens()
    .then((info) => {
      wallet.set(info.tokens);
      wallet.payments = info.payments;
      const lead = `<p class="shop-lead">${ft('shopLead', { cost: info.fightCost, premium: info.fightCost + info.premiumExtra })}</p>`;
      if (!info.payments) {
        draw(`${lead}<div class="pp-invite">${ft('shopSoon')}</div>`);
        return;
      }
      const perRupee = (p: Pack) => p.tokens / p.amount;
      const base = Math.min(...info.packs.map(perRupee));
      const best = info.packs.reduce((a, b) => (perRupee(b) > perRupee(a) ? b : a));
      const packs = info.packs
        .map((p) => {
          const bonus = Math.round(p.tokens - p.amount * base);
          return `<button type="button" class="pack ${p === best ? 'best' : ''}" data-pack="${esc(p.id)}">
            ${p === best ? `<span class="pack-flag">${ft('bestValue')}</span>` : ''}
            <span class="pack-coins">🪙</span><b>${ft('packTokens', { n: p.tokens })}</b>
            ${bonus > 0 ? `<small class="pack-bonus">${ft('packBonus', { n: bonus })}</small>` : '<small class="pack-bonus">&nbsp;</small>'}
            <span class="pack-price">Rs ${p.amount}</span>
          </button>`;
        })
        .join('');
      const list = () => {
        draw(`${lead}<div class="packs">${packs}</div>${legal}`);
        root.querySelectorAll<HTMLButtonElement>('[data-pack]').forEach((b) =>
          b.addEventListener('click', () => form(info.packs.find((p) => p.id === b.dataset.pack)!)),
        );
      };
      const form = (p: Pack) => {
        const c = { email: api.user?.email ?? '', phone: api.user?.phone ?? '', ...savedCustomer() };
        const field = (k: keyof Customer, type: string, auto: string) =>
          `<label class="pay-f"><span>${ft(k)}</span><input name="${k}" type="${type}" autocomplete="${auto}" required maxlength="${k === 'email' ? 254 : 50}" value="${esc(c[k] ?? '')}"></label>`;
        draw(`<form class="pay-form" novalidate>
            <p class="pay-pack">🪙 <b>${ft('packTokens', { n: p.tokens })}</b> · Rs ${p.amount}</p>
            <div class="pay-grid">${field('firstName', 'text', 'given-name')}${field('lastName', 'text', 'family-name')}${field('email', 'email', 'email')}${field('phone', 'tel', 'tel')}</div>
            <p class="pay-note">${ft('payNote')}</p>
            <p class="pay-err" hidden></p>
            <div class="row"><button type="button" class="ghost" data-back>${ft('payBack')}</button><button type="submit" class="pay-go">${ft('payWith', { amount: p.amount })}</button></div>
          </form>${legal}`);
        const f = root.querySelector<HTMLFormElement>('.pay-form')!;
        const err = f.querySelector<HTMLElement>('.pay-err')!;
        f.querySelector('[data-back]')!.addEventListener('click', list);
        // Typing in the form must not move the player (the game reads keys on window).
        f.addEventListener('keydown', (e) => e.stopPropagation());
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(f)) as unknown as Customer;
          for (const k of Object.keys(data) as (keyof Customer)[]) data[k] = String(data[k]).trim();
          if (Object.values(data).some((v) => !v)) {
            err.textContent = ft('payErr');
            err.hidden = false;
            return;
          }
          const go = f.querySelector<HTMLButtonElement>('.pay-go')!;
          go.disabled = true;
          go.textContent = ft('redirecting');
          try {
            localStorage.setItem(CUSTOMER_KEY, JSON.stringify(data));
          } catch {
            /* storage blocked */
          }
          try {
            const r = await api.checkout(p.id, data);
            audio.sfx('pick');
            // PayHere's hosted checkout is a plain form post (works the same on phones).
            const post = document.createElement('form');
            post.method = 'POST';
            post.action = r.action;
            post.style.display = 'none';
            for (const [k, v] of Object.entries(r.fields)) {
              const input = document.createElement('input');
              input.type = 'hidden';
              input.name = k;
              input.value = v;
              post.append(input);
            }
            document.body.append(post);
            post.submit();
          } catch (ex) {
            go.disabled = false;
            go.textContent = ft('payWith', { amount: p.amount });
            err.textContent = (ex as Error).message || ft('payErr');
            err.hidden = false;
          }
        });
      };
      list();
    })
    .catch((e) => draw(`<div class="pp-invite">${esc((e as Error).message)}</div>`));
}
