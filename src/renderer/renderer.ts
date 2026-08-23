// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// 管理ペイン UI。フレームワークなし(型は api.d.ts の ambient 宣言)。画面文言は ./i18n.ts(日本語 / 英語)。
// メッセージ本文・検索スニペットは信頼できない文字列のため textContent のみで描画する。
import { applyI18n, currentLang, setLang, t } from './i18n.js';
(() => {
  const api = window.api;

  // ---------- helpers ----------

  function must<T extends HTMLElement>(id: string): T {
    const e = document.getElementById(id);
    if (!e) throw new Error(`#${id} not found`);
    return e as T;
  }

  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  function pad2(n: number): string {
    return String(n).padStart(2, '0');
  }

  function clockTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '--:--:--';
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  function shortDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  const SPEAKER_LABELS: Record<Speaker, string> = { chatgpt: 'ChatGPT', gemini: 'Gemini' };

  // ---------- elements ----------

  const ledChatgpt = must<HTMLElement>('led-chatgpt');
  const ledGemini = must<HTMLElement>('led-gemini');
  const ledRunner = must<HTMLElement>('led-runner');
  const loginBanner = must<HTMLElement>('login-banner');
  const loginBannerText = must<HTMLElement>('login-banner-text');
  const loginBannerHint = must<HTMLElement>('login-banner-hint');
  const loginBannerClose = must<HTMLButtonElement>('login-banner-close');
  const guestChatgpt = must<HTMLElement>('guest-chatgpt');
  const guestGemini = must<HTMLElement>('guest-gemini');
  const runnerLabel = must<HTMLElement>('runner-state-label');
  const turnNow = must<HTMLElement>('turn-now');
  const turnMax = must<HTMLElement>('turn-max');
  const btnTranscript = must<HTMLButtonElement>('btn-transcript');
  const langSelect = must<HTMLSelectElement>('lang-select');
  let transcriptVisible = false;

  const topicInput = must<HTMLTextAreaElement>('topic-input');
  const ctlMaxTurns = must<HTMLInputElement>('ctl-max-turns');
  const ctlTurnsUp = must<HTMLButtonElement>('ctl-turns-up');
  const ctlTurnsDown = must<HTMLButtonElement>('ctl-turns-down');
  const ctlFirstSpeaker = must<HTMLSelectElement>('ctl-first-speaker');
  const ctlMode = must<HTMLSelectElement>('ctl-mode');
  const btnStart = must<HTMLButtonElement>('btn-start');
  const btnPause = must<HTMLButtonElement>('btn-pause');
  const btnResume = must<HTMLButtonElement>('btn-resume');
  const btnStop = must<HTMLButtonElement>('btn-stop');

  const feed = must<HTMLElement>('feed');

  const backdrop = must<HTMLElement>('backdrop');
  const drawer = must<HTMLElement>('drawer');
  const btnMenu = must<HTMLButtonElement>('btn-menu');
  const btnDrawerClose = must<HTMLButtonElement>('btn-drawer-close');

  const panels: Record<string, HTMLElement> = {
    settings: must<HTMLElement>('panel-settings'),
    history: must<HTMLElement>('panel-history'),
    search: must<HTMLElement>('panel-search'),
  };

  const settingsForm = must<HTMLFormElement>('settings-form');
  const inMaxTurns = must<HTMLInputElement>('set-max-turns');
  const selFirstSpeaker = must<HTMLSelectElement>('set-first-speaker');
  const selMode = must<HTMLSelectElement>('set-mode');
  const inBetweenTurns = must<HTMLInputElement>('set-between-turns');
  const inPoll = must<HTMLInputElement>('set-poll');
  const inStability = must<HTMLInputElement>('set-stability');
  const inTimeout = must<HTMLInputElement>('set-timeout');
  const inAdminRatio = must<HTMLInputElement>('set-admin-ratio');
  const inChatSplit = must<HTMLInputElement>('set-chat-split');
  const inChatZoom = must<HTMLInputElement>('set-chat-zoom');
  const taOpening = must<HTMLTextAreaElement>('set-opening');
  const taCounter = must<HTMLTextAreaElement>('set-counter');
  const taRelayFirst = must<HTMLTextAreaElement>('set-relay-first');
  const taRelaySecond = must<HTMLTextAreaElement>('set-relay-second');
  const taClosing = must<HTMLTextAreaElement>('set-closing');
  const inTkTemplate = must<HTMLInputElement>('set-tk-template');
  const inTkEarly = must<HTMLInputElement>('set-tk-early');
  const inTkMiddle = must<HTMLInputElement>('set-tk-middle');
  const inTkLate = must<HTMLInputElement>('set-tk-late');
  const templatesNote = must<HTMLElement>('set-templates-note');
  const saveFlash = must<HTMLElement>('save-flash');

  const historyList = must<HTMLElement>('history-list');
  const historyDetail = must<HTMLElement>('history-detail');
  const historyTitle = must<HTMLElement>('history-title');
  const historyMessages = must<HTMLElement>('history-messages');
  const btnHistoryBack = must<HTMLButtonElement>('btn-history-back');

  const searchInput = must<HTMLInputElement>('search-input');
  const searchResults = must<HTMLElement>('search-results');

  // ---------- state ----------

  let runner: RunnerStatus = { state: 'idle', conversationId: null, turn: 0, maxTurns: 0 };
  let chats: ChatStatusMap = {
    chatgpt: { loading: true, ready: false, loggedIn: false, rateLimited: false },
    gemini: { loading: true, ready: false, loggedIn: false, rateLimited: false },
  };
  // 「ログインなしで使えます」の案内を閉じたか(このセッションのみ)
  let guestNoticeDismissed = false;
  let defaultMaxTurns = 0;
  let lastRunnerError = '';

  // ---------- status LEDs / buttons ----------

  function chatLedClass(status: ChatStatus, speaker: Speaker): string {
    if (!status.ready) return 'led';
    if (status.rateLimited) return 'led warn';
    return `led on-${speaker}`;
  }

  function chatLedTitle(status: ChatStatus): string {
    if (!status.ready) return status.loading ? t('led.loading') : t('led.notChat');
    if (status.rateLimited) return t('led.rateLimited');
    return status.loggedIn ? t('led.loggedIn') : t('led.guest');
  }

  function updateChatUi(): void {
    ledChatgpt.className = chatLedClass(chats.chatgpt, 'chatgpt');
    ledChatgpt.title = chatLedTitle(chats.chatgpt);
    ledGemini.className = chatLedClass(chats.gemini, 'gemini');
    ledGemini.title = chatLedTitle(chats.gemini);
    guestChatgpt.classList.toggle('hidden', !(chats.chatgpt.ready && !chats.chatgpt.loggedIn));
    guestGemini.classList.toggle('hidden', !(chats.gemini.ready && !chats.gemini.loggedIn));
    updateLoginBanner();
    updateControls();
  }

  // バナーは 2 種類: 送信できない(警告)/ ログインなしで使っている(案内、閉じられる)。
  // 読込中(起動直後・新規チャットへの遷移中)は警告しない。ログイン操作で別サイトに遷移している間も
  // ready は落ちるので、文言は「読み込めない」ではなく「画面になっていない」にする。
  function updateLoginBanner(): void {
    const stuck: string[] = [];
    let loading = false;
    for (const [name, st] of [['ChatGPT', chats.chatgpt], ['Gemini', chats.gemini]] as const) {
      if (st.ready) continue;
      if (st.loading) loading = true;
      else stuck.push(name);
    }
    if (stuck.length > 0) {
      loginBanner.className = 'login-banner warn';
      loginBannerText.textContent = t('banner.stuck', { names: stuck.join(t('names.join')) });
      loginBannerHint.textContent = t('banner.stuck.hint');
      return;
    }
    if (loading) {
      loginBanner.className = 'login-banner hidden';
      return;
    }
    const guests: string[] = [];
    if (!chats.chatgpt.loggedIn) guests.push('ChatGPT');
    if (!chats.gemini.loggedIn) guests.push('Gemini');
    if (guests.length === 0 || guestNoticeDismissed) {
      loginBanner.className = 'login-banner hidden';
      return;
    }
    const locked = runner.state === 'running' || runner.state === 'paused';
    loginBanner.className = 'login-banner info';
    loginBannerText.textContent = t('banner.guest', { names: guests.join(t('names.join')) });
    loginBannerHint.textContent =
      t('banner.guest.hint') + (locked ? t('banner.guest.hint.locked') : t('banner.guest.hint.idle'));
  }
  loginBannerClose.addEventListener('click', () => {
    guestNoticeDismissed = true;
    updateLoginBanner();
  });

  function updateRunnerUi(): void {
    ledRunner.className = `led st-${runner.state}`;
    runnerLabel.textContent = runner.state;
    turnNow.textContent = String(runner.turn);
    const max = runner.maxTurns > 0 ? runner.maxTurns : defaultMaxTurns;
    turnMax.textContent = max > 0 ? String(max) : '–';
    updateLoginBanner();
    updateControls();
  }

  // このラン用のターン数(操作バーの値)。既定は設定から、変更しても保存しない。
  // 永続化する既定ターン数はドロワー(設定)側でのみ変更する。
  // 入力欄は読み取り専用で、変更は▲▼スピナーのみ(不正な値が入らない)。
  function setNextRunTurns(n: number): void {
    defaultMaxTurns = Math.max(1, Math.min(99, Math.floor(n) || 1));
    ctlMaxTurns.value = String(defaultMaxTurns);
    updateRunnerUi();
  }

  function stepTurns(delta: number): void {
    const cur = parseInt(ctlMaxTurns.value, 10);
    setNextRunTurns((Number.isFinite(cur) ? cur : defaultMaxTurns) + delta);
  }
  // ▲▼は押した瞬間に 1 回、押しっぱなしなら少し待ってから連続で増減する(OS のキーリピートと同じ感覚)。
  // click ではなく pointerdown で扱うので、離したときの click で二重に動かない
  const REPEAT_DELAY_MS = 400;
  const REPEAT_INTERVAL_MS = 80;
  function holdToRepeat(button: HTMLButtonElement, delta: number): void {
    let delay: number | null = null;
    let interval: number | null = null;
    const stop = (): void => {
      if (delay !== null) window.clearTimeout(delay);
      if (interval !== null) window.clearInterval(interval);
      delay = null;
      interval = null;
    };
    button.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault(); // 長押しでテキスト選択やフォーカス移動を起こさない
      stop();
      stepTurns(delta);
      delay = window.setTimeout(() => {
        interval = window.setInterval(() => stepTurns(delta), REPEAT_INTERVAL_MS);
      }, REPEAT_DELAY_MS);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) button.addEventListener(type, stop);
    // ポインタを伴わない click(キーボード・支援技術・スクリプトの element.click())は detail が 0。
    // ポインタ由来の click は pointerdown で処理済みなので二重に動かさない
    button.addEventListener('click', (ev) => {
      if (ev.detail === 0) stepTurns(delta);
    });
  }
  holdToRepeat(ctlTurnsUp, 1);
  holdToRepeat(ctlTurnsDown, -1);

  function updateControls(): void {
    const st = runner.state;
    const bothReady = chats.chatgpt.ready && chats.gemini.ready;
    btnStart.disabled = st === 'running' || st === 'paused' || !bothReady;
    btnPause.disabled = st !== 'running';
    btnResume.disabled = st !== 'paused';
    btnStop.disabled = st !== 'running' && st !== 'paused';
  }

  // ---------- live feed ----------

  const FEED_MAX_ROWS = 400;
  let autoScroll = true;

  feed.addEventListener('scroll', () => {
    autoScroll = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 24;
  });

  function pushFeedRow(row: HTMLElement): void {
    feed.appendChild(row);
    while (feed.childElementCount > FEED_MAX_ROWS) {
      feed.firstElementChild?.remove();
    }
    if (autoScroll) feed.scrollTop = feed.scrollHeight;
  }

  function addLog(entry: LogEntry): void {
    const row = el('div', `feed-log level-${entry.level}`);
    row.appendChild(el('span', 'feed-ts', clockTime(entry.ts)));
    row.appendChild(el('span', 'feed-level', entry.level.toUpperCase()));
    row.appendChild(el('span', 'feed-text', entry.message));
    pushFeedRow(row);
  }

  function localLog(level: LogEntry['level'], message: string): void {
    addLog({ level, message, ts: new Date().toISOString() });
  }

  function addMessageRow(msg: MessageRecord): void {
    const row = el('div', 'feed-msg');
    row.appendChild(el('span', 'feed-ts', clockTime(msg.createdAt)));
    row.appendChild(el('span', `chip chip-${msg.speaker}`, SPEAKER_LABELS[msg.speaker]));
    row.appendChild(el('span', 'feed-text', msg.content));
    pushFeedRow(row);
  }

  // ---------- control buttons ----------

  btnStart.addEventListener('click', () => {
    const topic = topicInput.value.trim();
    if (!topic) {
      localLog('warn', t('log.topicRequired'));
      topicInput.focus();
      return;
    }
    // 操作バーのターン数をそのラン用の上書きとして渡す(設定の既定は変えない)
    // 先攻もターン数と同じく、このラン用の一時値(設定の既定は変えない)
    const firstSpeaker: Speaker = ctlFirstSpeaker.value === 'gemini' ? 'gemini' : 'chatgpt';
    api
      .startDebate(topic, defaultMaxTurns, firstSpeaker, modeOf(ctlMode.value))
      .catch((err) => localLog('error', t('log.startFailed', { error: errMsg(err) })));
  });
  btnPause.addEventListener('click', () => {
    api.pauseDebate().catch((err) => localLog('error', t('log.pauseFailed', { error: errMsg(err) })));
  });
  btnResume.addEventListener('click', () => {
    api.resumeDebate().catch((err) => localLog('error', t('log.resumeFailed', { error: errMsg(err) })));
  });
  btnStop.addEventListener('click', () => {
    api.stopDebate().catch((err) => localLog('error', t('log.stopFailed', { error: errMsg(err) })));
  });
  btnTranscript.addEventListener('click', () => {
    api.toggleTranscript().catch((err) => localLog('error', t('log.toggleFailed', { error: errMsg(err) })));
  });

  topicInput.addEventListener('keydown', (ev) => {
    // Enter は改行、Ctrl+Enter(mac は Cmd+Enter)で開始(2026-08-23 利用者の決定: Enter だけで始まるのは避ける)。
    // IME の変換確定 Enter で議論が開始してしまわないよう isComposing も除外
    if (ev.key !== 'Enter' || !(ev.ctrlKey || ev.metaKey) || ev.isComposing) return;
    ev.preventDefault();
    if (!btnStart.disabled) btnStart.click();
  });
  // 複数行のテーマは行数に合わせて欄を伸ばす(上限は CSS の max-height。超えた分はスクロール)
  const growTopic = (): void => {
    topicInput.style.height = 'auto';
    topicInput.style.height = `${topicInput.scrollHeight}px`;
  };
  topicInput.addEventListener('input', growTopic);
  growTopic();

  // 下端のつまみ: 押したら main にドラッグ開始を伝え、離したら終了。ドラッグ中のポインタ位置は main が
  // 画面座標で追う(ポインタがチャットペインに入ってもこちらには届かないため)。
  // チャットペイン側で離された場合は chat-preload.js が終了を伝える
  const paneDivider = must<HTMLElement>('pane-divider');
  paneDivider.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    paneDivider.classList.add('dragging');
    api.beginPaneDrag();
  });
  const endPaneDrag = (): void => {
    if (!paneDivider.classList.contains('dragging')) return;
    paneDivider.classList.remove('dragging');
    api.endPaneDrag();
  };
  window.addEventListener('pointerup', endPaneDrag, true);
  window.addEventListener('pointercancel', endPaneDrag, true);
  window.addEventListener('blur', endPaneDrag);
  // ドラッグ中は縦位置を main に報告する(Wayland では main がポインタ位置を取れないため。チャットペイン側は chat-preload.js)
  const reportDragY = (ev: PointerEvent): void => api.reportPaneDragY(ev.clientY);
  api.onPaneDragActive((active) => {
    if (active) window.addEventListener('pointermove', reportDragY, true);
    else window.removeEventListener('pointermove', reportDragY, true);
  });

  // リンク等を管理ペインへドロップすると WebContents ごと遷移してしまうため常に抑止
  document.addEventListener('dragover', (ev) => ev.preventDefault());
  document.addEventListener('drop', (ev) => ev.preventDefault());

  // ---------- drawer ----------

  type TabName = 'settings' | 'history' | 'search';
  let activeTab: TabName = 'settings';
  let drawerOpen = false;

  const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.drawer-tab'));

  function setTab(name: TabName): void {
    activeTab = name;
    for (const btn of tabButtons) {
      btn.classList.toggle('active', btn.dataset['tab'] === name);
    }
    for (const key of Object.keys(panels)) {
      panels[key]!.classList.toggle('hidden', key !== name);
    }
    if (name === 'settings') void fillSettingsForm();
    if (name === 'history') void loadHistory();
    if (name === 'search') searchInput.focus();
  }

  function openDrawer(): void {
    drawerOpen = true;
    drawer.classList.add('open');
    backdrop.classList.add('show');
    setTab(activeTab); // 開くたびに内容を更新
  }

  function closeDrawer(): void {
    drawerOpen = false;
    drawer.classList.remove('open');
    backdrop.classList.remove('show');
  }

  btnMenu.addEventListener('click', openDrawer);
  btnDrawerClose.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && drawerOpen) closeDrawer();
  });
  for (const btn of tabButtons) {
    btn.addEventListener('click', () => {
      const name = btn.dataset['tab'];
      if (name === 'settings' || name === 'history' || name === 'search') setTab(name);
    });
  }

  // ---------- 設定 ----------

  async function fillSettingsForm(): Promise<void> {
    try {
      const s = await api.getSettings();
      inMaxTurns.value = String(s.debate.maxTurns);
      selFirstSpeaker.value = s.debate.firstSpeaker;
      inBetweenTurns.value = String(s.debate.betweenTurnsMs);
      inPoll.value = String(s.detection.pollMs);
      inStability.value = String(s.detection.stabilityMs);
      inTimeout.value = String(s.detection.timeoutMs);
      inAdminRatio.value = String(s.layout.adminRatio);
      inChatSplit.value = String(s.layout.chatSplit);
      inChatZoom.value = String(s.layout.chatZoom);
      selMode.value = s.debate.mode;
      // テンプレート欄は「いまの言語 × 設定画面で選んでいるモード」のぶんを編集する。モードを切り替えても
      // 編集途中の値を失わないよう、言語ぶんの全モードを手元に持ち、保存時にまとめて書く
      editingTemplates = structuredClone(s.debate.templates[s.language]);
      editingMode = s.debate.mode;
      showTemplates(s.language, editingMode);
      const tk = s.debate.timekeeper[s.language];
      inTkTemplate.value = tk.template;
      inTkEarly.value = tk.early;
      inTkMiddle.value = tk.middle;
      inTkLate.value = tk.late;
      setNextRunTurns(s.debate.maxTurns);
      ctlFirstSpeaker.value = s.debate.firstSpeaker;
      ctlMode.value = s.debate.mode;
    } catch (err) {
      localLog('error', t('log.settingsLoadFailed', { error: errMsg(err) }));
    }
  }

  let editingTemplates: Record<Mode, DebateTemplates> | null = null;
  let editingMode: Mode = 'debate';

  function modeOf(value: string): Mode {
    const known: Mode[] = ['debate', 'collab', 'brainstorm', 'dialectic', 'relay', 'review', 'interview', 'socratic', 'devil', 'quiz'];
    return (known as string[]).includes(value) ? (value as Mode) : 'debate';
  }

  /** テキストエリアの内容を手元のテンプレート群に書き戻す */
  function stashTemplates(): void {
    if (!editingTemplates) return;
    editingTemplates[editingMode] = {
      openingTemplate: taOpening.value,
      counterTemplate: taCounter.value,
      relayFirstTemplate: taRelayFirst.value,
      relaySecondTemplate: taRelaySecond.value,
      closingTemplate: taClosing.value,
    };
  }

  function showTemplates(lang: Lang, mode: Mode): void {
    if (!editingTemplates) return;
    editingMode = mode;
    const tpl = editingTemplates[mode];
    taOpening.value = tpl.openingTemplate;
    taCounter.value = tpl.counterTemplate;
    taRelayFirst.value = tpl.relayFirstTemplate;
    taRelaySecond.value = tpl.relaySecondTemplate;
    taClosing.value = tpl.closingTemplate;
    templatesNote.textContent = t('set.templatesNote', { lang: t(`lang.${lang}`), mode: t(`mode.${mode}`) });
  }

  selMode.addEventListener('change', () => {
    stashTemplates();
    showTemplates(currentLang(), modeOf(selMode.value));
  });

  function numVal(input: HTMLInputElement, fallback: number): number {
    // Number('') は 0 になるため valueAsNumber(空欄なら NaN)を使う
    const n = input.valueAsNumber;
    return Number.isFinite(n) ? n : fallback;
  }

  /** ペイン比率は 0/1 に潰れないよう [0.05, 0.95] に収める */
  function clampRatio(n: number): number {
    return Math.min(0.95, Math.max(0.05, n));
  }

  let flashTimer = 0;

  settingsForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void (async () => {
      try {
        stashTemplates();
        const cur = await api.getSettings();
        const next: SettingsData = {
          ...cur,
          layout: {
            adminRatio: clampRatio(numVal(inAdminRatio, cur.layout.adminRatio)),
            chatSplit: clampRatio(numVal(inChatSplit, cur.layout.chatSplit)),
            chatZoom: Math.min(3, Math.max(0.25, numVal(inChatZoom, cur.layout.chatZoom))),
          },
          debate: {
            maxTurns: Math.min(99, Math.max(1, Math.floor(numVal(inMaxTurns, cur.debate.maxTurns)))),
            firstSpeaker: selFirstSpeaker.value === 'gemini' ? 'gemini' : 'chatgpt',
            mode: modeOf(selMode.value),
            // テンプレート欄は「いまの言語」のぶん(全モード)を編集している
            templates: {
              ...cur.debate.templates,
              [cur.language]: editingTemplates ?? cur.debate.templates[cur.language],
            },
            timekeeper: {
              ...cur.debate.timekeeper,
              [cur.language]: {
                template: inTkTemplate.value,
                early: inTkEarly.value,
                middle: inTkMiddle.value,
                late: inTkLate.value,
              },
            },
            betweenTurnsMs: Math.max(0, numVal(inBetweenTurns, cur.debate.betweenTurnsMs)),
          },
          detection: {
            pollMs: Math.max(100, numVal(inPoll, cur.detection.pollMs)),
            stabilityMs: Math.max(500, numVal(inStability, cur.detection.stabilityMs)),
            timeoutMs: Math.max(1000, numVal(inTimeout, cur.detection.timeoutMs)),
          },
        };
        await api.setSettings(next);
        setNextRunTurns(next.debate.maxTurns);
        saveFlash.classList.add('show');
        window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => saveFlash.classList.remove('show'), 1600);
      } catch (err) {
        localLog('error', t('log.settingsSaveFailed', { error: errMsg(err) }));
      }
    })();
  });

  // ---------- 履歴 ----------

  function showHistoryList(): void {
    historyDetail.classList.add('hidden');
    historyList.classList.remove('hidden');
  }

  async function loadHistory(): Promise<void> {
    showHistoryList();
    historyList.textContent = '';
    historyList.appendChild(el('div', 'drawer-empty', t('history.loading')));
    try {
      const convs = await api.listConversations();
      historyList.textContent = '';
      if (convs.length === 0) {
        historyList.appendChild(el('div', 'drawer-empty', t('history.empty')));
        return;
      }
      for (const conv of convs) {
        const row = el('button', 'conv-row');
        row.type = 'button';
        row.appendChild(el('span', 'conv-title', conv.title));
        row.appendChild(el('span', `badge badge-${conv.status}`, conv.status));
        row.appendChild(el('span', 'conv-date', shortDate(conv.updatedAt)));
        row.addEventListener('click', () => {
          void openConversation(conv);
        });
        historyList.appendChild(row);
      }
    } catch (err) {
      historyList.textContent = '';
      historyList.appendChild(el('div', 'drawer-empty', t('history.loadFailed', { error: errMsg(err) })));
    }
  }

  async function openConversation(conv: ConversationRecord): Promise<void> {
    historyList.classList.add('hidden');
    historyDetail.classList.remove('hidden');
    historyTitle.textContent = conv.title;
    historyMessages.textContent = '';
    historyMessages.appendChild(el('div', 'drawer-empty', t('history.loading')));
    try {
      const msgs = await api.getMessages(conv.id);
      historyMessages.textContent = '';
      if (msgs.length === 0) {
        historyMessages.appendChild(el('div', 'drawer-empty', t('history.noMessages')));
        return;
      }
      for (const msg of msgs) {
        const row = el('div', 'hist-msg');
        row.appendChild(el('span', `chip chip-${msg.speaker}`, SPEAKER_LABELS[msg.speaker]));
        row.appendChild(el('span', 'msg-body', msg.content));
        row.appendChild(el('span', 'msg-date', shortDate(msg.createdAt)));
        historyMessages.appendChild(row);
      }
    } catch (err) {
      historyMessages.textContent = '';
      historyMessages.appendChild(el('div', 'drawer-empty', t('history.messagesFailed', { error: errMsg(err) })));
    }
  }

  btnHistoryBack.addEventListener('click', showHistoryList);

  // ---------- 検索 ----------

  let searchTimer = 0;
  let searchSeq = 0;

  searchInput.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      void runSearch();
    }, 300);
  });

  /** 「【…】」で囲まれた強調部を span.hit-em にして返す(textContent のみ使用) */
  function renderSnippet(snippet: string): HTMLElement {
    const out = el('span', 'snippet');
    let i = 0;
    while (i < snippet.length) {
      const start = snippet.indexOf('【', i);
      if (start === -1) {
        out.appendChild(document.createTextNode(snippet.slice(i)));
        break;
      }
      if (start > i) out.appendChild(document.createTextNode(snippet.slice(i, start)));
      const end = snippet.indexOf('】', start + 1);
      if (end === -1) {
        out.appendChild(document.createTextNode(snippet.slice(start)));
        break;
      }
      out.appendChild(el('span', 'hit-em', snippet.slice(start + 1, end)));
      i = end + 1;
    }
    return out;
  }

  async function runSearch(): Promise<void> {
    const query = searchInput.value.trim();
    const seq = ++searchSeq;
    searchResults.textContent = '';
    if (query.length === 0) return;
    // 短い語は Repository 側が LIKE 検索にフォールバックするため、ここでは制限しない
    searchResults.appendChild(el('div', 'drawer-empty', t('search.searching')));
    try {
      const hits = await api.search(query);
      if (seq !== searchSeq) return; // 古い応答は捨てる
      searchResults.textContent = '';
      if (hits.length === 0) {
        searchResults.appendChild(el('div', 'drawer-empty', t('search.none')));
        return;
      }
      for (const hit of hits) {
        const row = el('div', 'hit-row');
        const head = el('div', 'hit-head');
        head.appendChild(el('span', `chip chip-${hit.message.speaker}`, SPEAKER_LABELS[hit.message.speaker]));
        head.appendChild(el('span', 'hit-title', hit.conversationTitle));
        head.appendChild(el('span', 'hit-date', shortDate(hit.message.createdAt)));
        row.appendChild(head);
        row.appendChild(renderSnippet(hit.snippet));
        searchResults.appendChild(row);
      }
    } catch (err) {
      if (seq !== searchSeq) return;
      searchResults.textContent = '';
      searchResults.appendChild(el('div', 'drawer-empty', t('search.failed', { error: errMsg(err) })));
    }
  }

  // ---------- subscriptions / init ----------

  api.onLog(addLog);
  api.onMessage(addMessageRow);
  api.onRunnerStatus((status) => {
    runner = status;
    if (status.error && status.error !== lastRunnerError) {
      lastRunnerError = status.error;
      localLog('error', status.error);
    }
    updateRunnerUi();
  });
  api.onChatStatus((status) => {
    chats = status;
    updateChatUi();
  });
  api.onTranscriptVisible((visible) => {
    btnTranscript.classList.toggle('active', visible);
    transcriptVisible = visible;
    btnTranscript.textContent = visible ? t('view.live') : t('view.transcript');
  });

  // ---------- 言語 ----------
  // ヘッダ右上のセレクトで切替。設定に即保存し、main からの settings:ev-changed で両ペインの文言を差し替える。
  // 進行中の議論のプロンプトは開始時の言語のまま(Runner 側で固定)
  function applyLanguage(lang: Lang): void {
    if (currentLang() !== lang) setLang(lang);
    else applyI18n();
    langSelect.value = lang;
    btnTranscript.textContent = transcriptVisible ? t('view.live') : t('view.transcript');
    updateChatUi();
    updateRunnerUi();
    if (drawerOpen && activeTab === 'settings') void fillSettingsForm();
  }
  langSelect.addEventListener('change', () => {
    const lang: Lang = langSelect.value === 'en' ? 'en' : 'ja';
    void (async () => {
      try {
        const cur = await api.getSettings();
        if (cur.language !== lang) await api.setSettings({ ...cur, language: lang });
      } catch (err) {
        localLog('error', t('log.langFailed', { error: errMsg(err) }));
      }
    })();
  });
  api.onSettingsChanged((s) => {
    applyLanguage(s.language);
  });

  async function init(): Promise<void> {
    try {
      const [settings, chatStatus] = await Promise.all([api.getSettings(), api.getChatStatus()]);
      applyLanguage(settings.language);
      setNextRunTurns(settings.debate.maxTurns);
      ctlFirstSpeaker.value = settings.debate.firstSpeaker;
      chats = chatStatus;
    } catch (err) {
      localLog('error', t('log.initFailed', { error: errMsg(err) }));
    }
    updateRunnerUi();
    updateChatUi();
    localLog('info', t('log.started'));
  }

  void init();
})();
