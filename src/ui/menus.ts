import { HEROES } from '../content/heroes';
import { MAPS } from '../content/maps';
import { PLAYER_COLORS } from '../render/renderer';
import { DIFFICULTIES } from '../sim/state';
import { copyToClipboard, clear, el, tapButton, toast } from './dom';

export interface TitleHandlers {
  campaignStage: number;
  onSolo: () => void;
  onHost: () => void;
  onJoin: () => void;
  onHelp: () => void;
  onResetCampaign: () => void;
}

export function renderTitle(root: HTMLElement, h: TitleHandlers): void {
  clear(root);
  root.appendChild(
    el(
      'div',
      { class: 'screen' },
      el(
        'div',
        { class: 'stack' },
        el(
          'div',
          { class: 'title' },
          el('h1', {}, 'BULWARK HEROES'),
          el('p', {}, 'Up to six heroes. One keep. Endless powers and companions.'),
        ),
        tapButton('btn primary', h.onHost, '🤝 Host a co-op game'),
        tapButton('btn warm', h.onJoin, '🔗 Join with a code'),
        tapButton('btn ghost', h.onSolo, '🎯 Play solo'),
        tapButton('btn ghost', h.onHelp, '❔ How to play'),
        el(
          'div',
          { class: 'campaign-reset' },
          el('div', {},
            el('div', { class: 'skill-kicker' }, 'CAMPAIGN PROGRESS'),
            el('div', { class: 'campaign-reset-stage' }, `Stage ${h.campaignStage + 1} of ${MAPS.length}`),
          ),
          tapButton('btn danger campaign-reset-button', h.onResetCampaign, 'Reset campaign'),
        ),
        el(
          'div',
          { class: 'muted', style: 'text-align:center' },
          'Runs in any modern phone browser — no install, no account. '
          + 'Every phone simulates the battle in perfect lockstep, so you always see the same fight.',
        ),
        el('div', { class: 'commit-badge', title: 'Running Git revision' },
          el('span', {}, 'GAME COMMIT'), el('strong', {}, __BUILD_COMMIT__)),
      ),
    ),
  );
}

export interface SetupModel {
  heroId: number;
  mapId: number;
  difficulty: number;
}

export interface SetupHandlers {
  title: string;
  confirmLabel: string;
  model: SetupModel;
  canEditMap: boolean;
  onChange: () => void;
  onConfirm: () => void;
  onBack: () => void;
  /** Heroes already chosen by the other players, if any. */
  takenHeroIds?: number[];
  extra?: HTMLElement | null;
}

/** Update a chooser in place so tapping an option never resets screen scroll. */
function selectChoice(grid: HTMLElement, selected: HTMLElement): void {
  for (const child of grid.children) child.classList.toggle('selected', child === selected);
}

export function renderSetup(root: HTMLElement, h: SetupHandlers): void {
  clear(root);
  const model = h.model;

  const heroGrid = el('div', { class: 'chooser' });
  for (const hero of HEROES) {
    const taken = h.takenHeroIds?.includes(hero.id) ?? false;
    const btn = tapButton(
      `choice${model.heroId === hero.id ? ' selected' : ''}`,
      () => {
        model.heroId = hero.id;
        h.onChange();
        selectChoice(heroGrid, btn);
      },
      el('div', { class: 'name' }, hero.name),
      el('div', { class: 'sub' }, hero.title),
      el('div', { class: 'sub' }, hero.desc),
      el('div', { class: 'sub', style: 'color:#ffd447' }, `${hero.passiveName}: ${hero.passiveDesc}`),
      el('div', { class: 'sub' }, `⚡ ${hero.ability.name} — ${hero.ability.desc}`),
      taken ? el('div', { class: 'taken' }, 'ALLY') : null,
    );
    heroGrid.appendChild(btn);
  }

  const campaignMap = MAPS[model.mapId] ?? MAPS[0];
  const mapGrid = el('div', { class: 'campaign-stage' },
    el('div', { class: 'skill-kicker' }, `CAMPAIGN STAGE ${campaignMap.id + 1} / ${MAPS.length}`),
    el('div', { class: 'name' }, campaignMap.name),
    el('div', { class: 'sub' }, campaignMap.blurb),
    el('div', { class: 'sub' }, `${campaignMap.lanes.length} route${campaignMap.lanes.length > 1 ? 's' : ''} · Defeat two bosses to advance`));

  const diffGrid = el('div', { class: 'chooser' });
  DIFFICULTIES.forEach((d, i) => {
    const btn = tapButton(
        `choice${model.difficulty === i ? ' selected' : ''}`,
        () => {
          if (!h.canEditMap) return;
          model.difficulty = i;
          h.onChange();
          selectChoice(diffGrid, btn);
        },
        el('div', { class: 'name' }, d.name),
        el('div', { class: 'sub' }, `${d.lives} lives · enemies at ${d.hpPct}% health`),
      );
    diffGrid.appendChild(btn);
  });

  root.appendChild(
    el(
      'div',
      { class: 'screen' },
      el(
        'div',
        { class: 'stack' },
        el('div', { class: 'title' }, el('h1', { style: 'font-size:34px' }, h.title)),
        h.extra ?? null,
        el('div', { class: 'card' }, el('h2', {}, 'Choose your hero'), heroGrid),
        el(
          'div',
          { class: 'card' },
          el('h2', {}, 'Campaign battlefield'),
          mapGrid,
          el('h3', {}, 'Difficulty'),
          diffGrid,
        ),
        tapButton('btn primary', h.onConfirm, h.confirmLabel),
        tapButton('btn ghost', h.onBack, 'Back'),
      ),
    ),
  );
}

export function renderHostWaiting(
  root: HTMLElement,
  code: string,
  onCancel: () => void,
  error: string | null,
): void {
  clear(root);
  const link = `${location.origin}${location.pathname}#${code}`;
  root.appendChild(
    el(
      'div',
      { class: 'screen' },
      el(
        'div',
        { class: 'stack' },
        el('div', { class: 'title' }, el('h1', { style: 'font-size:32px' }, 'Room open')),
        el(
          'div',
          { class: 'card' },
          el('h2', {}, 'Share this code'),
          el('div', { class: 'room-code' }, code),
          el('div', { class: 'muted' }, 'Friends can use this code before or during the battle. Up to five can join.'),
          el('div', { class: 'btn-row', style: 'margin-top:12px' },
            tapButton('btn ghost', async () => {
              const ok = await copyToClipboard(code);
              toast(ok ? 'Code copied' : 'Copy failed — read it out instead');
            }, 'Copy code'),
            tapButton('btn ghost', async () => {
              const shareData = { title: 'Bulwark', text: `Join my Bulwark game — code ${code}`, url: link };
              if (navigator.share) {
                try { await navigator.share(shareData); return; } catch { /* cancelled */ }
              }
              const ok = await copyToClipboard(link);
              toast(ok ? 'Link copied' : 'Sharing is not supported here');
            }, 'Share link'),
          ),
        ),
        error
          ? el('div', { class: 'card' }, el('div', { class: 'error-text' }, error))
          : el(
            'div',
            { class: 'card' },
            el('div', { class: 'spinner' }),
            el('div', { class: 'muted', style: 'text-align:center' }, 'Waiting for your partner to connect…'),
          ),
        tapButton('btn ghost', onCancel, 'Cancel'),
      ),
    ),
  );
}

export function renderJoin(
  root: HTMLElement,
  initial: string,
  onSubmit: (code: string) => void,
  onCancel: () => void,
  status: string | null,
  error: string | null,
): void {
  clear(root);
  const input = el('input', {
    type: 'text',
    class: 'code',
    maxlength: 6,
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: false,
    inputmode: 'text',
    placeholder: '····',
    value: initial,
  }) as HTMLInputElement;

  const submit = (): void => {
    const code = input.value.trim().toUpperCase();
    if (code.length < 3) {
      toast('Enter the code your friend gave you');
      return;
    }
    onSubmit(code);
  };

  input.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter') submit();
  });

  root.appendChild(
    el(
      'div',
      { class: 'screen' },
      el(
        'div',
        { class: 'stack' },
        el('div', { class: 'title' }, el('h1', { style: 'font-size:32px' }, 'Join a game')),
        el(
          'div',
          { class: 'card' },
          el('h2', {}, 'Room code'),
          input,
          error ? el('div', { class: 'error-text', style: 'margin-top:10px' }, error) : null,
          status ? el('div', { class: 'spinner' }) : null,
          status ? el('div', { class: 'muted', style: 'text-align:center' }, status) : null,
        ),
        tapButton('btn primary', submit, 'Connect'),
        tapButton('btn ghost', onCancel, 'Back'),
      ),
    ),
  );
  window.setTimeout(() => input.focus(), 60);
}

export function renderHelp(root: HTMLElement, onBack: () => void): void {
  clear(root);

  root.appendChild(
    el(
      'div',
      { class: 'screen' },
      el(
        'div',
        { class: 'stack' },
        el('div', { class: 'title' }, el('h1', { style: 'font-size:32px' }, 'How to play')),
        el(
          'div',
          { class: 'card' },
          el('h2', {}, 'The basics'),
          el('div', { class: 'muted' },
            'Enemies march from the edges of the map to your keep. Every one that reaches it costs you lives. '
            + 'Move your heroes into position and combine powers to stop them.'),
          el('h3', {}, 'Controls'),
          el('div', { class: 'muted' },
            '• Tap open ground to send your hero there.\n'
            + '• Tap a gold flag to build one of four base towers. Tap a tower later to choose its upgrade path.\n'
            + '• Powers live directly in the bottom row; some need you to drag and aim.\n'
            + '• Learn a new branch power whenever your hero levels up.\n'
            + '• Between waves, open the shop for relics, consumables, and persistent summons.',
            ),
          el('h3', {}, 'Co-op rules'),
          el('div', { class: 'muted' },
            'You each have your own gold, powers, items, and persistent summons, but you share the keep’s lives. '
            + 'Every player must press READY to call the next wave early — and calling it early pays a bonus.'),
          el('h3', {}, 'Why it never desyncs'),
          el('div', { class: 'muted' },
            'Every phone runs the exact same simulation from the same seed, using integer maths only. '
            + 'A tick is never simulated until every player’s inputs for it have arrived, so a bullet that '
            + 'hits on your screen always hits on theirs. If the network hiccups you will see a brief '
            + '“waiting for your partner” pause instead of two different games.'),
        ),
        el('div', { class: 'card' }, el('h2', {}, 'Hero strategy'),
          el('div', { class: 'muted' },
            'Position durable heroes in the lane, keep ranged heroes moving, combine crowd control with burst damage, '
            + 'and use persistent companions to reinforce weak sections of the route.')),
        tapButton('btn primary', onBack, 'Back'),
      ),
    ),
  );
}

export interface LobbySeat {
  slot: number;
  name: string;
  ready: boolean;
}

export interface LobbyModel {
  code: string;
  isHost: boolean;
  /** Which seat is us. */
  selfSlot: number;
  seats: LobbySeat[];
  /** Seats still open, so the host knows more players can still be invited. */
  freeSeats: number;
  rttMs: number;
}

export function lobbyStatusCard(m: LobbyModel): HTMLElement {
  const dot = (color: string): HTMLElement => el('span', { class: 'dot', style: `background:${color}` });
  const legend = el('div', { class: 'legend' });
  for (const seat of m.seats) {
    legend.appendChild(
      el(
        'div',
        {},
        dot(PLAYER_COLORS[seat.slot % PLAYER_COLORS.length]),
        `${seat.name}${seat.slot === m.selfSlot ? ' (you)' : ''} ${seat.ready ? '✅' : '…'}`,
      ),
    );
  }
  for (let i = 0; i < m.freeSeats; i++) {
    legend.appendChild(el('div', { class: 'muted' }, dot('#3a4459'), 'Open seat'));
  }
  legend.appendChild(el('div', {}, `📶 ${m.rttMs}ms`));

  return el(
    'div',
    { class: 'card' },
    el('h2', {}, `Room ${m.code}`),
    legend,
    m.freeSeats > 0
      ? el('div', { class: 'muted', style: 'margin-top:8px' },
        `Room code ${m.code} — one more player can still join.`)
      : null,
    el('div', { class: 'muted', style: 'margin-top:8px' },
      m.isHost
        ? 'You are the host. Pick the map and difficulty, then start once everyone is ready.'
        : 'The host picks the map and difficulty.'),
  );
}
