// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// 管理ペイン UI。フレームワークなし(型は api.d.ts の ambient 宣言)。画面文言は ./i18n.ts(日本語 / 英語)。
// メッセージ本文・検索スニペットは信頼できない文字列のため textContent のみで描画する。
import { applyI18n, currentLang, setLang, t } from './i18n.js';
import type {
  ChatStatus,
  ChatStatusMap,
  ConversationRecord,
  DebateTemplates,
  Lang,
  LogEntry,
  MessageRecord,
  Mode,
  RunnerStatus,
  SettingsData,
  Speaker,
} from '../shared/types';
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
  ctlMode.value = 'debate';
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
  const btnResetSettings = must<HTMLButtonElement>('btn-reset-settings');
  const resetFlash = must<HTMLElement>('reset-flash');

  const historyList = must<HTMLElement>('history-list');
  const historyDetail = must<HTMLElement>('history-detail');
  const historyTitle = must<HTMLElement>('history-title');
  const historyMessages = must<HTMLElement>('history-messages');
  const btnHistoryBack = must<HTMLButtonElement>('btn-history-back');
  const historyTitleInput = must<HTMLInputElement>('history-title-input');
  const btnHistoryCopy = must<HTMLButtonElement>('btn-history-copy');
  const btnHistoryResume = must<HTMLButtonElement>('btn-history-resume');
  const btnHistoryRematch = must<HTMLButtonElement>('btn-history-rematch');
  const progressEl = must<HTMLElement>('progress');
  const historyUndo = must<HTMLElement>('history-undo');
  const historyUndoText = must<HTMLElement>('history-undo-text');
  const btnHistoryUndo = must<HTMLButtonElement>('btn-history-undo');
  const btnHistoryDelete = must<HTMLButtonElement>('btn-history-delete');

  const searchInput = must<HTMLInputElement>('search-input');
  const searchResults = must<HTMLElement>('search-results');

  // ---------- state ----------

  let runner: RunnerStatus = { state: 'idle', conversationId: null, turn: 0, maxTurns: 0 };
  let chats: ChatStatusMap = {
    chatgpt: { loading: true, onSite: false, ready: false, loggedIn: false, rateLimited: false },
    gemini: { loading: true, onSite: false, ready: false, loggedIn: false, rateLimited: false },
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
    const noInput: string[] = [];
    let loading = false;
    for (const [name, st] of [['ChatGPT', chats.chatgpt], ['Gemini', chats.gemini]] as const) {
      if (st.ready) continue;
      if (st.loading) loading = true;
      else if (st.onSite) noInput.push(name);
      else stuck.push(name);
    }
    // サイトにいるのに入力欄が無い = 同意・確認の画面か、サイトの画面が変わった(セレクタ破損)
    if (noInput.length > 0) {
      loginBanner.className = 'login-banner warn';
      loginBannerText.textContent = t('banner.noInput', { names: noInput.join(t('names.join')) });
      loginBannerHint.textContent = t('banner.noInput.hint');
      return;
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

  // レート制限のクールダウン中は状態ラベルを残り秒数のカウントダウンにする(main は開始と終了だけ通知する)
  let cooldownTimer: number | null = null;
  function updateCooldownLabel(): void {
    const cd = runner.cooldown;
    if (!cd) {
      if (cooldownTimer !== null) window.clearInterval(cooldownTimer);
      cooldownTimer = null;
      runnerLabel.textContent = runner.state;
      runnerLabel.title = '';
      return;
    }
    const seconds = Math.max(0, Math.ceil((cd.until - Date.now()) / 1000));
    runnerLabel.textContent = t('cooldown.label', { seconds: String(seconds) });
    runnerLabel.title = t('cooldown.title', { name: SPEAKER_LABELS[cd.speaker], attempt: String(cd.attempt), max: String(cd.max) });
    if (cooldownTimer === null) cooldownTimer = window.setInterval(updateCooldownLabel, 1000);
  }

  // 進行状況: 「ChatGPT のターン・中盤」のように、誰の番でどの段階かを TURN の左に出す
  function updateProgress(): void {
    progressEl.textContent = '';
    const p = runner.progress;
    if (!p) return;
    progressEl.textContent = `${t('progress.turn', { name: SPEAKER_LABELS[p.speaker] })}${t('progress.sep')}${t(`progress.${p.phase}`)}`;
    progressEl.className = `progress progress-${p.speaker}`;
  }

  function updateRunnerUi(): void {
    ledRunner.className = `led st-${runner.state}`;
    updateCooldownLabel();
    updateProgress();
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
    if (name === 'search') {
      searchInput.focus();
      void runSearch(); // 削除・改名で結果が古くなっているかもしれないので、開くたびに引き直す
    }
  }

  function openDrawer(): void {
    drawerOpen = true;
    drawer.classList.add('open');
    backdrop.classList.add('show');
    btnMenu.setAttribute('aria-expanded', 'true');
    setTab(activeTab); // 開くたびに内容を更新
  }

  function closeDrawer(): void {
    drawerOpen = false;
    drawer.classList.remove('open');
    backdrop.classList.remove('show');
    btnMenu.setAttribute('aria-expanded', 'false');
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
      fillFormFields(await api.getSettings());
    } catch (err) {
      localLog('error', t('log.settingsLoadFailed', { error: errMsg(err) }));
    }
  }

  /** 設定フォームの入力欄を s の値で埋める(保存はしない)。テンプレート欄は s.language のぶん */
  function fillFormFields(s: SettingsData): void {
    {
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
      // 操作バー(ターン数・先攻・モード)は触らない。決めるのは起動時と設定の保存時だけで、
      // 設定タブを開いただけで選び直した値が戻らないようにする(モードは起動時に常に「対立」。利用者の決定 2026-08-24)
    }
  }

  // 既定に戻す: 入力欄を既定値で埋めるだけで、「保存」を押すまで何も永続化しない(取り消しは保存せず閉じるだけ)。
  // 言語ともう片方の言語のテンプレートは触らない(画面に出ていないものを黙って変えない)
  btnResetSettings.addEventListener('click', () => {
    void (async () => {
      try {
        const [defaults, cur] = await Promise.all([api.getDefaultSettings(), api.getSettings()]);
        fillFormFields({ ...defaults, language: cur.language });
        resetFlash.classList.add('show');
        window.clearTimeout(resetFlashTimer);
        resetFlashTimer = window.setTimeout(() => resetFlash.classList.remove('show'), 3000);
      } catch (err) {
        localLog('error', t('set.resetFailed', { error: errMsg(err) }));
      }
    })();
  });
  let resetFlashTimer = 0;

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
        // 既定を変えたのに操作バーが古いままだと紛らわしいので、保存したときだけ追従させる
        setNextRunTurns(next.debate.maxTurns);
        ctlFirstSpeaker.value = next.debate.firstSpeaker;
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
    if (undoTargetId === null) historyUndo.classList.add('hidden');
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
        // 行は div(中に削除ボタンを置くため button 入れ子を避ける)。クリックで詳細、✕ で削除
        const row = el('div', 'conv-row');
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.appendChild(el('span', 'conv-title', conv.title));
        // 状態は訳語で(経過表示のステータスと同じ status.* を使う)
        row.appendChild(el('span', `badge badge-${conv.status}`, t(`status.${conv.status}`)));
        row.appendChild(el('span', 'conv-date', shortDate(conv.updatedAt)));
        if (!isInProgress(conv.id)) {
          const del = el('button', 'conv-delete', '✕');
          del.type = 'button';
          del.title = t('history.delete.hint');
          del.addEventListener('click', (ev) => {
            ev.stopPropagation();
            void deleteConversation(conv.id, conv.title, () => loadHistory());
          });
          row.appendChild(del);
        }
        row.addEventListener('click', () => {
          void openConversation(conv.id, conv.title);
        });
        row.addEventListener('keydown', (ev) => {
          // ✕ ボタンにフォーカスがあるときの Enter / Space はボタンの click に任せる(会話を開かない)
          if (ev.target !== row) return;
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            void openConversation(conv.id, conv.title);
          }
        });
        historyList.appendChild(row);
      }
    } catch (err) {
      historyList.textContent = '';
      historyList.appendChild(el('div', 'drawer-empty', t('history.loadFailed', { error: errMsg(err) })));
    }
  }

  // 詳細画面で開いている会話(改名・削除・保存の対象)
  let openConversationId: number | null = null;

  /** いま議論中(実行中・一時停止中)の会話か。削除の対象から外す */
  function isInProgress(id: number): boolean {
    return (runner.state === 'running' || runner.state === 'paused') && runner.conversationId === id;
  }

  // 詳細で開いている会話の記録と発言(再戦・続きからの材料)
  let openRecord: ConversationRecord | null = null;
  let openMessages: MessageRecord[] = [];

  /** 会話の詳細。focusMessageId があればその発言までスクロールして一時ハイライト(検索からのジャンプ) */
  async function openConversation(id: number, title: string, focusMessageId?: number): Promise<void> {
    openConversationId = id;
    openRecord = null;
    openMessages = [];
    historyList.classList.add('hidden');
    historyDetail.classList.remove('hidden');
    endRename(false);
    btnHistoryDelete.disabled = isInProgress(id);
    btnHistoryResume.classList.add('hidden');
    btnHistoryRematch.disabled = true;
    historyTitle.textContent = title;
    historyMessages.textContent = '';
    historyMessages.appendChild(el('div', 'drawer-empty', t('history.loading')));
    try {
      const [msgs, convs] = await Promise.all([api.getMessages(id), api.listConversations()]);
      if (openConversationId !== id) return; // 読込中に別の会話を開いた
      openRecord = convs.find((c) => c.id === id) ?? null;
      openMessages = msgs;
      btnHistoryRematch.disabled = openRecord === null;
      // 会話がもう無い(古い検索結果から削除済みを開いた等)なら、その旨を出して操作は全部無効にする
      if (openRecord === null) {
        btnHistoryDelete.disabled = true;
        historyMessages.textContent = '';
        historyMessages.appendChild(el('div', 'drawer-empty', t('history.gone')));
        return;
      }
      // 「続きから」は止まった会話(停止 / エラー)で、発言があり、上限に達していないものだけ
      // (0 発言は先攻を復元できない。Runner 側の判定と揃える)
      const max = openRecord?.maxTurns ?? 0;
      const resumable =
        openRecord !== null &&
        (openRecord.status === 'stopped' || openRecord.status === 'error') &&
        msgs.length > 0 &&
        msgs.length < max;
      btnHistoryResume.classList.toggle('hidden', !resumable);
      historyMessages.textContent = '';
      if (msgs.length === 0) {
        historyMessages.appendChild(el('div', 'drawer-empty', t('history.noMessages')));
        return;
      }
      let target: HTMLElement | null = null;
      for (const msg of msgs) {
        const row = el('div', 'hist-msg');
        row.appendChild(el('span', `chip chip-${msg.speaker}`, SPEAKER_LABELS[msg.speaker]));
        const main = el('div', 'msg-main');
        main.appendChild(el('span', 'msg-body', msg.content));
        // この発言を引き出した送信文(0.8.0 から保存)。あるときだけ折りたたみで出す
        if (msg.prompt) {
          const det = document.createElement('details');
          det.className = 'msg-prompt';
          const sum = document.createElement('summary');
          sum.textContent = t('history.promptToggle');
          det.appendChild(sum);
          det.appendChild(el('div', 'msg-prompt-body', msg.prompt));
          main.appendChild(det);
        }
        row.appendChild(main);
        row.appendChild(el('span', 'msg-date', shortDate(msg.createdAt)));
        historyMessages.appendChild(row);
        if (msg.id === focusMessageId) target = row;
      }
      if (target) {
        target.scrollIntoView({ block: 'center' });
        target.classList.add('hit-flash');
      }
    } catch (err) {
      historyMessages.textContent = '';
      historyMessages.appendChild(el('div', 'drawer-empty', t('history.messagesFailed', { error: errMsg(err) })));
    }
  }

  // 確認は出さない(ネイティブ UI は当面使わない、利用者の決定 2026-08-23)。代わりに 5 秒だけ「取り消す」を出す
  // (main 側が少し長い猶予で削除を予約していて、その間は一覧から隠れる)
  const UNDO_SHOW_MS = 5000;
  let undoTimer = 0;
  let undoTargetId: number | null = null;
  function hideUndo(): void {
    window.clearTimeout(undoTimer);
    undoTargetId = null;
    historyUndo.classList.add('hidden');
  }
  async function deleteConversation(id: number, title: string, after: () => void | Promise<void>): Promise<void> {
    const ok = await api.deleteConversation(id);
    if (!ok) {
      localLog('warn', t('history.deleteFailed'));
      return;
    }
    const head = title.split('\n')[0] ?? '';
    localLog('info', t('history.deleted', { title: head }));
    if (openConversationId === id) openConversationId = null;
    await after();
    undoTargetId = id;
    historyUndoText.textContent = t('history.deleted', { title: head });
    historyUndo.classList.remove('hidden');
    window.clearTimeout(undoTimer);
    undoTimer = window.setTimeout(hideUndo, UNDO_SHOW_MS);
  }
  btnHistoryUndo.addEventListener('click', () => {
    const id = undoTargetId;
    hideUndo();
    if (id === null) return;
    void api.undoDeleteConversation(id).then((ok) => {
      localLog(ok ? 'info' : 'warn', t(ok ? 'history.undone' : 'history.undoFailed'));
      void loadHistory();
    });
  });

  // 改名: 題名をクリックで入力欄に切り替え、Enter / フォーカス外れで確定、Esc で取り消し。
  // 題名は複数行がありうる(テーマ欄の Enter は改行)が、input[type=text] は代入時に改行を黙って落とす。
  // 語が直結しないよう「 / 」に置き換えて入れ、変更判定はその置換後の初期値と比較する
  // (textContent と比較すると、複数行の題名は未編集でもフォーカスを外しただけで改名されてしまう)
  let renaming = false;
  let renameInitial = '';
  function beginRename(): void {
    if (openConversationId === null || renaming) return;
    renaming = true;
    renameInitial = (historyTitle.textContent ?? '').replace(/\s*\n\s*/g, ' / ');
    historyTitleInput.value = renameInitial;
    historyTitle.classList.add('hidden');
    historyTitleInput.classList.remove('hidden');
    historyTitleInput.focus();
    historyTitleInput.select();
  }
  function endRename(commit: boolean): void {
    if (!renaming) return;
    renaming = false;
    historyTitleInput.classList.add('hidden');
    historyTitle.classList.remove('hidden');
    const id = openConversationId;
    const title = historyTitleInput.value.trim();
    if (!commit || id === null || title === '' || title === renameInitial) return;
    historyTitle.textContent = title;
    // 詳細画面が持つスナップショットにも反映する(「もう一度」が改名前の題名を使わないように)
    if (openRecord && openRecord.id === id) openRecord = { ...openRecord, title };
    void api.renameConversation(id, title).then((ok) => {
      if (!ok) localLog('warn', t('history.renameFailed'));
    });
  }
  historyTitle.addEventListener('click', beginRename);
  historyTitle.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      beginRename();
    }
  });
  historyTitleInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      endRename(true);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation(); // document 側の Escape(ドロワーを閉じる)まで届かせない
      endRename(false);
    }
  });
  historyTitleInput.addEventListener('blur', () => endRename(true));

  btnHistoryDelete.addEventListener('click', () => {
    if (openConversationId === null) return;
    void deleteConversation(openConversationId, historyTitle.textContent ?? '', () => loadHistory());
  });
  // 再戦: 同じ議題・モード・ターン数を操作バーに入れ、先後を入れ替えて(1 発言目の話者の逆)新しい議論を始める
  btnHistoryRematch.addEventListener('click', () => {
    const rec = openRecord;
    if (!rec) return;
    // 「開始」が押せない状態(議論中・ペイン未準備)では、操作バーを黙って書き換えるだけになるので何もしない
    if (btnStart.disabled) {
      localLog('warn', t('history.cannotStart'));
      return;
    }
    topicInput.value = rec.title;
    ctlMode.value = rec.mode ?? 'debate';
    if (rec.maxTurns) setNextRunTurns(rec.maxTurns);
    const first = openMessages[0]?.speaker;
    if (first) ctlFirstSpeaker.value = first === 'chatgpt' ? 'gemini' : 'chatgpt';
    closeDrawer();
    btnStart.click();
  });
  // 続きから: 止まった会話を保存済みの発言の次のターンから、同じ会話に追記して再開する
  btnHistoryResume.addEventListener('click', () => {
    if (openConversationId === null) return;
    if (btnStart.disabled) {
      localLog('warn', t('history.cannotStart'));
      return;
    }
    const id = openConversationId;
    closeDrawer();
    void api.resumeConversation(id).then((ok) => {
      if (!ok) localLog('warn', t('history.resumeFailed'));
    });
  });
  btnHistoryCopy.addEventListener('click', () => {
    if (openConversationId === null) return;
    void api.copyTranscriptMarkdown(openConversationId).then((ok) => {
      // 失敗 = 発言が 0 件(main はその場合コピーしない)。無反応にしない
      localLog(ok ? 'info' : 'warn', t(ok ? 'history.copied' : 'history.copyFailed'));
    });
  });

  btnHistoryBack.addEventListener('click', () => {
    endRename(false);
    void loadHistory();
  });

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
        // クリックで履歴タブのその会話を開き、該当の発言へジャンプ
        row.addEventListener('click', () => {
          setTab('history');
          void openConversation(hit.message.conversationId, hit.conversationTitle, hit.message.id);
        });
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
