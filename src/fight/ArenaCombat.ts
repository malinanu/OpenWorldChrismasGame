import * as THREE from 'three';
import { assets } from '../core/AssetLoader';
import { audio } from '../core/Audio';
import { haptic, isTouchDevice, type Input } from '../core/Input';
import type { Player } from '../game/Player';
import type { SnowballFight } from '../game/SnowballFight';
import type { Melee, Multiplayer } from '../net/Multiplayer';
import { wallet } from '../net/wallet';
import type { Hud } from '../ui/hud';
import type { TouchControls } from '../ui/touch';
import { t } from '../i18n/ui';
import { Burst } from '../vfx/Burst';
import type { ArenaSite } from './Arena';
import { FloatText } from './FloatText';
import { ft, weaponDesc, weaponName } from './strings';
import { ARENA_EMOJI, ARENAS, fightCost, LIVES, LOOKS, MAX_HP, pips, swingHits, weapon, weaponAt, weaponsFor, type WeaponDef } from './weapons';
import { combatClips } from './WeaponModels';

interface Joined {
  site: ArenaSite;
  w: WeaponDef;
  /** Fighting other players through the server (otherwise: practice with the snowman). */
  online: boolean;
}

const DUMMY_HP = 100;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The local fighter in the Boxing Ring and the Sword Arena: the entry prompt, the weapon
 * picker, attack and guard, the health bar, hits, knock-outs and getting back up, plus the
 * practice snowman. The server decides every hit on other players.
 */
export class ArenaCombat {
  readonly group = new THREE.Group();
  private floats = new FloatText();
  private puffs!: Burst;
  private sparks!: Burst;
  private mp: Multiplayer | null = null;
  private joined: Joined | null = null;
  private hp = MAX_HP;
  private lives = LIVES;
  private down = false;
  private cooldown = 0;
  private swingSlow = 0;
  private swingN = 0;
  private guarding = false;
  private kos = 0;
  private streak = 0;
  private clips: Promise<void> | null = null;
  private dummyHp = new Map<ArenaSite, number>();
  private wobble = new Map<ArenaSite, number>();
  private picking = false;
  private noThrowAt = -Infinity;
  private barKey = '';

  constructor(
    private readonly player: Player,
    private readonly hud: Hud,
    private readonly sites: ArenaSite[],
    private readonly groundY: (x: number, z: number) => number,
    private readonly fight: SnowballFight,
    private readonly opts: { touch?: TouchControls; signedIn: () => boolean; openShop: () => void },
  ) {}

  async load() {
    const [smoke, sparkle] = await Promise.all([assets.texture('vfx/smoke.png'), assets.texture('vfx/sparkle.png')]);
    this.puffs = new Burst(smoke, 300, false, -4);
    this.sparks = new Burst(sparkle, 300, true, -6);
    this.group.add(this.floats.group, this.puffs.points, this.sparks.points);
  }

  /** Standing inside a fight zone (no snowballs here). */
  get inArena() {
    return !!this.siteAt(this.player.position, 0);
  }

  get fighting() {
    return !!this.joined;
  }

  /** What our state messages should say we're doing (null: the usual walk/run/idle). */
  get stateAnim(): string | null {
    return this.joined && this.guarding && !this.down ? 'guard' : null;
  }

  private siteAt(p: THREE.Vector3, margin: number) {
    return this.sites.find((s) => Math.hypot(p.x - s.def.x, p.z - s.def.z) < s.def.r + margin) ?? null;
  }

  /** Loads the combat clips once, for us and everyone else. */
  private ensureClips() {
    this.clips ??= combatClips().then((clips) => {
      if (!clips.length) {
        this.clips = null;
        return;
      }
      this.player.addClips(clips);
      this.fight.addClips(clips);
    });
    return this.clips;
  }

  goOnline(mp: Multiplayer) {
    this.mp = mp;
    mp.on('fighter', (m) => {
      if (m.id !== mp.myId || !this.joined?.online) return;
      if (m.a) {
        this.hp = m.hp;
        if (typeof m.lives === 'number') this.lives = m.lives;
        this.drawBar();
      } else {
        // The server took us out: out of lives, or we wandered off.
        if (m.why === 'out') this.hud.toast(ft('outOfLives', { n: fightCost(weaponsFor(this.joined.site.def.id)[0]) }), 4000);
        this.leave(false);
      }
    });
    mp.on('arenaError', (m) => {
      if (!this.joined?.online) return;
      this.leave(false);
      if (m.code === 'no_tokens') {
        this.hud.toast(ft('notEnough', { need: m.need ?? 1, have: m.have ?? 0 }), 4000);
        if (wallet.payments) setTimeout(() => this.opts.openShop(), 600);
      }
    });
    mp.on('swing', (id, w) => this.onRemoteSwing(id, w));
    mp.on('melee', (m) => this.onMelee(m));
    mp.on('ko', (from, to, w, lives) => this.onKo(from, to, w, lives));
    mp.on('respawn', (id, at, yaw) => {
      if (id === mp.myId) this.getUp(at, yaw);
    });
    mp.on('tokens', (n) => {
      wallet.set(n);
      this.drawBar();
    });
    mp.on('status', (on) => {
      if (!on && this.joined?.online) this.leave(false);
    });
  }

  /** Returns true while it shows its own prompt (so the zone prompt stays away). */
  update(dt: number, input: Input | null, cameraYaw: number, active: boolean, pr: number): boolean {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swingSlow = Math.max(0, this.swingSlow - dt);
    this.floats.update(dt);
    this.puffs.update(dt, pr);
    this.sparks.update(dt, pr);
    this.animateDummies(dt);
    this.updateRemotes();

    const p = this.player.position;
    if (this.siteAt(p, 8)) void this.ensureClips();
    let prompt = false;
    if (this.joined) {
      // Walked out through the gate: the fight is over.
      if (Math.hypot(p.x - this.joined.site.def.x, p.z - this.joined.site.def.z) > this.joined.site.def.r + 1) {
        this.hud.toast(ft('left', { arena: ft(`arena_${this.joined.site.def.id}`) }), 2200);
        this.leave();
      } else if (!active) {
        // A menu or the map opened: nobody fights on defenceless behind a menu.
        this.leave();
      } else if (input) {
        this.fightInput(input, cameraYaw);
      }
    } else if (active && !this.picking) {
      const site = this.siteAt(p, 0);
      if (site) {
        prompt = true;
        const name = ft(`arena_${site.def.id}`);
        const html = isTouchDevice ? `<span class="play">${ft('fightChip')}</span> ${ARENA_EMOJI[site.def.id]} ${name}` : ft('pressFight', { arena: `${ARENA_EMOJI[site.def.id]} ${name}` });
        this.hud.showPrompt(html);
        if (input?.justPressed('interact')) {
          this.hud.hidePrompt();
          void this.pick(site, input);
        }
      }
    }
    if (this.joined) {
      const slow = this.down ? 0 : this.guarding ? 0.45 : this.swingSlow > 0 ? 0.55 : 1;
      this.player.speedScale = slow;
      this.drawBar();
    }
    return prompt;
  }

  /** Snowballs are off inside the arenas; say so now and then. */
  noThrowHint() {
    const now = performance.now();
    if (this.joined || now - this.noThrowAt < 4000) return;
    this.noThrowAt = now;
    this.hud.toast(ft('noThrow'), 2200);
  }

  private fightInput(input: Input, cameraYaw: number) {
    if (this.down) return;
    const guard = input.isDown('guard') && this.player.clipLength('Blocking') > 0;
    if (guard !== this.guarding) {
      this.guarding = guard;
      this.player.hold = guard ? 'Blocking' : null;
      if (guard) audio.sfx('pick', 0.7);
      this.mp?.sendNow();
    }
    if (!guard && (input.justPressed('attack') || input.justPressed('fire'))) this.attack(cameraYaw);
  }

  // ------------------------------------------------------------------ joining

  private async pick(site: ArenaSite, input: Input) {
    this.picking = true;
    input.unlockPointer();
    void this.ensureClips();
    const online = !!this.mp?.connected && this.opts.signedIn();
    const tokens = wallet.tokens ?? 0;
    const tickets = weaponsFor(site.def.id)
      .map((w) => {
        const look = LOOKS[w.id];
        const pp = pips(w);
        const cost = fightCost(w);
        const poor = online && tokens < cost;
        const bar = (label: string, n: number) => `<span class="wp-stat"><small>${label}</small><i>${'●'.repeat(n)}<em>${'●'.repeat(5 - n)}</em></i></span>`;
        return `<button type="button" class="wp-ticket ${poor ? 'poor' : ''} ${w.premium ? 'premium' : ''}" data-w="${w.id}" ${poor ? 'aria-disabled="true"' : ''}>
          <span class="wp-ico">${look.emoji}</span>
          <span class="wp-main"><b>${weaponName(w.id)}</b><small>${weaponDesc(w.id)}</small>
            <span class="wp-stats">${bar(ft('statDamage'), pp.damage)}${bar(ft('statSpeed'), pp.speed)}${bar(ft('statReach'), pp.reach)}${bar(ft('statKnock'), pp.knock)}</span></span>
          ${online ? `<span class="wp-cost">🪙 ${cost}</span>` : ''}
        </button>`;
      })
      .join('');
    const name = ft(`arena_${site.def.id}`);
    const head = online
      ? `<p class="wp-wallet"><span>🪙 ${ft('balance', { n: tokens })}</span><span>❤️ ${ft('livesEach', { n: LIVES })}</span></p>`
      : `<p class="wp-note">${ft(this.opts.signedIn() ? 'practiceOffline' : 'practiceNote')}</p>`;
    const shop = online && wallet.payments ? `<button type="button" class="ghost" data-shop>🪙 ${ft('buyTokens')}</button>` : '';
    const html = `<div class="passport weapon-pick"><div class="pp-cover"><span class="pp-flake">${ARENA_EMOJI[site.def.id]}</span> ${name.toUpperCase()} <span class="pp-flake">${ARENA_EMOJI[site.def.id]}</span></div>
      <div class="pp-page"><h3 class="pp-sub">${ft(`pick_${site.def.id}`)}</h3>
        <p class="wp-lead">${ft('pickLead', { arena: name, s: 3 })}</p>${head}
        <div class="wp-list">${tickets}</div>
        <div class="row">${shop}<button type="button" class="ghost" data-cancel>${ft('pickBack')}</button><button type="button" data-ok hidden></button></div>
      </div></div>`;
    let chosen: string | null = null;
    try {
      await this.hud.showCard(html, (card) => {
        const ok = card.querySelector<HTMLButtonElement>('[data-ok]')!;
        card.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) =>
          b.addEventListener('click', () => {
            if (b.classList.contains('poor')) {
              const w = weapon(b.dataset.w)!;
              this.hud.toast(ft('notEnough', { need: fightCost(w), have: tokens }), 2600);
              return;
            }
            chosen = b.dataset.w!;
            ok.click();
          }),
        );
        card.querySelector('[data-shop]')?.addEventListener('click', () => {
          chosen = 'shop';
          ok.click();
        });
      });
    } catch {
      chosen = null;
    } finally {
      this.picking = false;
    }
    input.lockPointer();
    if (chosen === 'shop') return this.opts.openShop();
    const w = weapon(chosen);
    if (!w) return;
    // Still standing in the arena?
    if (this.siteAt(this.player.position, 0) !== site) return;
    this.join(site, w, online);
  }

  private join(site: ArenaSite, w: WeaponDef, online: boolean) {
    this.joined = { site, w, online };
    this.hp = MAX_HP;
    this.lives = LIVES;
    this.down = false;
    this.guarding = false;
    this.cooldown = 0.3;
    this.player.setWeapon(w.id);
    this.player.idleClip = LOOKS[w.id]?.idle ?? 'Idle_A';
    if (online) this.mp?.arena(site.def.id, w.id);
    this.hud.setQuitVisible(true);
    this.hud.root.classList.add('fighting'); // the fight bar takes the top of the screen
    this.hud.onQuit = () => this.leave();
    this.opts.touch?.setFightMode(true);
    this.barKey = '';
    this.drawBar();
    audio.sfx(site.def.id === 'boxing' ? 'bellRing' : 'clang');
    this.hud.toast(`${LOOKS[w.id]?.emoji ?? ''} ${ft('joined', { weapon: weaponName(w.id) })}`, 2200);
  }

  /** Leave the fight (`tell`: let the server know; false when it already knows). */
  leave(tell = true) {
    if (!this.joined) return;
    if (tell && this.joined.online) this.mp?.arena(null);
    this.joined = null;
    this.down = false;
    this.guarding = false;
    this.player.setWeapon(null);
    this.player.idleClip = 'Idle_A';
    this.player.hold = null;
    this.player.frozen = false;
    this.player.speedScale = 1;
    this.hud.setGameBar(null);
    this.hud.setQuitVisible(false);
    this.hud.root.classList.remove('fighting');
    this.hud.onQuit = undefined;
    this.opts.touch?.setFightMode(false);
    this.streak = 0;
  }

  private drawBar() {
    const j = this.joined;
    if (!j) return;
    const hp = Math.max(0, Math.round(this.hp));
    const key = `${j.w.id}|${hp}|${this.lives}|${this.kos}|${wallet.tokens}|${j.online}|${this.down}`;
    if (key === this.barKey) return;
    this.barKey = key;
    const pct = (hp / MAX_HP) * 100;
    const lvl = pct > 50 ? 'ok' : pct > 25 ? 'mid' : 'low';
    const hearts = j.online ? `<span class="fb-lives" title="${ft('livesEach', { n: LIVES })}">${'❤️'.repeat(Math.max(0, this.lives))}${'🤍'.repeat(Math.max(0, LIVES - this.lives))}</span>` : `<span class="fb-practice">${ft('practice')}</span>`;
    const tok = j.online && wallet.tokens !== null ? `<span class="fb-tok">🪙 ${wallet.tokens}</span>` : '';
    this.hud.setGameBar(`<span class="fb-w">${LOOKS[j.w.id]?.emoji ?? ''} ${esc(weaponName(j.w.id))}</span>
      <span class="fb-hp ${lvl}"><i style="width:${pct}%"></i><b>${ft('hp')} ${hp}</b></span>${hearts}
      <span class="fb-kos">🏆 ${this.kos}</span>${tok}
      <span class="log fb-hint">${isTouchDevice ? ft('hintTouch') : ft('hintDesk')}</span>`);
  }

  // ------------------------------------------------------------------ attacking

  private attack(cameraYaw: number) {
    const j = this.joined;
    if (!j || this.cooldown > 0) return;
    const w = j.w;
    this.cooldown = w.cooldown;
    this.swingSlow = Math.min(w.cooldown, 0.6);
    // Turn to the nearest opponent in front of the camera (or of us), within reach.
    const target = this.aim(cameraYaw, w, j.site);
    const p = this.player.position;
    if (target) this.player.faceTowards(Math.atan2(target.x - p.x, target.z - p.z));
    const look = LOOKS[w.id];
    const clip = look.swings[this.swingN++ % look.swings.length];
    const len = this.player.clipLength(clip) || 1;
    this.player.playOnce(clip, { sticky: true, timeScale: THREE.MathUtils.clamp(len / Math.max(w.cooldown * 1.15, 0.4), 1, 3.2) });
    audio.sfx('whoosh', 0.9 + Math.random() * 0.25);
    if (j.online) this.mp?.attack();
    // The practice snowman is ours alone.
    const home = j.site.dummyHome;
    if (swingHits({ x: p.x, z: p.z, yaw: this.player.facingAngle }, home, w)) setTimeout(() => this.hitDummy(j.site, w), 120);
  }

  private aim(cameraYaw: number, w: WeaponDef, site: ArenaSite): THREE.Vector3 | null {
    const p = this.player.position;
    const camFwd = Math.atan2(-Math.sin(cameraYaw), -Math.cos(cameraYaw));
    const facing = this.player.facingAngle;
    const myArena = ARENAS.findIndex((a) => a.id === site.def.id) + 1;
    const options: THREE.Vector3[] = [site.dummyHome];
    for (const [id, r] of this.fight.remotes) {
      const s = this.mp?.players.get(id)?.snaps.at(-1);
      if (s && s.arena === myArena && s.a !== 'ko' && r.object.visible) options.push(r.object.position);
    }
    let best: THREE.Vector3 | null = null;
    let bestD = w.reach + 1.8;
    for (const o of options) {
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d > bestD || d < 0.05) continue;
      const a = Math.atan2(o.x - p.x, o.z - p.z);
      const off = (x: number) => Math.abs(Math.atan2(Math.sin(a - x), Math.cos(a - x)));
      if (Math.min(off(camFwd), off(facing)) > (80 * Math.PI) / 180) continue;
      best = o;
      bestD = d;
    }
    return best;
  }

  private hitDummy(site: ArenaSite, w: WeaponDef) {
    const at = site.dummyHome.clone().setY(site.dummyHome.y + 1.4);
    const hp = (this.dummyHp.get(site) ?? DUMMY_HP) - w.damage;
    this.wobble.set(site, 0.7);
    this.floats.spawn(at, `-${w.damage}`, '#ffd84a');
    this.puffs.emit(at, 18, { color: '#ffffff', speed: 3, up: 1.5, size: 1, life: 0.6 });
    audio.sfx(LOOKS[w.id]?.hitSfx ?? 'punch', 0.9 + Math.random() * 0.2);
    haptic(10);
    if (hp <= 0) {
      this.dummyHp.set(site, DUMMY_HP);
      this.puffs.emit(at, 50, { color: '#ffffff', speed: 5, up: 3, size: 1.5, life: 0.9 });
      this.floats.spawn(at.clone().setY(at.y + 0.5), 'KO!', '#ff7a5a', true);
      this.hud.toast(ft('snowmanDown'), 2400);
      audio.sfx('ko');
    } else this.dummyHp.set(site, hp);
  }

  private animateDummies(dt: number) {
    for (const s of this.sites) {
      const w = Math.max(0, (this.wobble.get(s) ?? 0) - dt);
      this.wobble.set(s, w);
      s.dummy.rotation.z = Math.sin(w * 26) * w * 0.35;
      s.dummy.rotation.x = Math.sin(w * 19) * w * 0.15;
    }
  }

  // ------------------------------------------------------------------ others

  /** Everyone else's weapon and health bar, from their snapshots. */
  private updateRemotes() {
    if (!this.mp) return;
    for (const [id, r] of this.fight.remotes) {
      const s = this.mp.players.get(id)?.snaps.at(-1);
      const w = s ? weaponAt(s.weapon) : undefined;
      if (w && s) {
        void this.ensureClips();
        r.setFighter(w.id, s.hp, MAX_HP, LOOKS[w.id]?.idle ?? 'Idle_A');
      } else r.setFighter(null, null, MAX_HP, 'Idle_A');
    }
  }

  private onRemoteSwing(id: number, w: string) {
    const r = this.fight.remotes.get(id);
    const look = LOOKS[w];
    const def = weapon(w);
    if (!r || !look || !def) return;
    const clip = look.swings[Math.floor(Math.random() * look.swings.length)];
    r.playOnce(clip, 1.6);
    if (r.object.position.distanceTo(this.player.position) < 14) audio.sfx('whoosh', 0.85 + Math.random() * 0.3);
  }

  private name(id: number) {
    return esc(this.mp?.players.get(id)?.name ?? t('someone'));
  }

  private onMelee(m: Melee) {
    const me = this.mp?.myId;
    const at = new THREE.Vector3(...m.at);
    const near = m.to === me || m.from === me || at.distanceTo(this.player.position) < 20;
    const color = m.to === me ? '#ff5a5a' : m.from === me ? '#ffd84a' : '#ffffff';
    this.floats.spawn(at, `-${m.d}`, color, m.d >= 20);
    if (m.blk) {
      this.floats.spawn(at.clone().setY(at.y + 0.45), ft('blocked'), '#9fd8ff');
      this.sparks.emit(at, 16, { color: ['#fff4b0', '#9fd8ff'], speed: 4, up: 1, size: 0.6, life: 0.35 });
      if (near) audio.sfx('clang', 0.9 + Math.random() * 0.2);
    } else {
      this.puffs.emit(at, 14, { color: '#ffffff', speed: 3, up: 1.2, size: 0.9, life: 0.5 });
      if (near) audio.sfx(LOOKS[m.w]?.hitSfx ?? 'punch', 0.9 + Math.random() * 0.2);
    }
    if (m.to === me) {
      this.hp = m.hp;
      if (!this.down) {
        this.player.knock.set(m.kb[0], m.kb[1]);
        if (!this.guarding) this.player.playOnce(Math.random() < 0.5 ? 'Hit_A' : 'Hit_B', { timeScale: 1.4 });
        haptic(m.blk ? 15 : [25, 20, 40]);
      }
      this.drawBar();
    } else {
      const r = this.fight.remotes.get(m.to);
      r?.playOnce(m.blk ? 'Block_Hit' : Math.random() < 0.5 ? 'Hit_A' : 'Hit_B', 1.4);
      if (m.from === me) haptic(12);
    }
  }

  private onKo(from: number, to: number, w: string, lives?: number) {
    const me = this.mp?.myId;
    const wname = weaponName(w);
    if (to === me && this.joined) {
      this.down = true;
      this.hp = 0;
      this.lives = typeof lives === 'number' ? lives : Math.max(0, this.lives - 1);
      this.streak = 0;
      this.guarding = false;
      this.player.frozen = true;
      this.player.hold = 'Death_A';
      audio.sfx('ko');
      haptic([60, 40, 120]);
      this.hud.toast(ft('koYou', { name: this.name(from), weapon: wname }), 3200);
      this.drawBar();
    } else if (from === me) {
      this.kos++;
      this.streak++;
      audio.sfx('star');
      this.hud.toast(ft('youKo', { name: this.name(to) }), 2600);
      if (this.streak >= 3) setTimeout(() => this.hud.toast(ft('streak', { n: this.streak }), 2600), 500);
      this.drawBar();
    } else if (this.joined) {
      this.hud.toast(`💥 ${ft('koFeed', { from: this.name(from), to: this.name(to) })}`, 2000);
    }
  }

  private getUp(at: [number, number], yaw: number) {
    if (!this.joined) return;
    const floor = this.joined.site.floor;
    this.down = false;
    this.hp = MAX_HP;
    this.player.frozen = false;
    this.player.hold = null;
    this.player.knock.set(0, 0);
    this.player.teleport(new THREE.Vector3(at[0], this.groundY(at[0], at[1]) + floor, at[1]));
    this.player.faceTowards(yaw);
    this.player.playOnce('Lie_StandUp', { sticky: true, timeScale: 1.3 });
    this.hud.toast(ft('backUp'), 1600);
    this.drawBar();
  }
}
