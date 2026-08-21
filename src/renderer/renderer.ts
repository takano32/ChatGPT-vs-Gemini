// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// 管理ペイン UI。フレームワークなし・import なし(型は api.d.ts の ambient 宣言)。
// メッセージ本文・検索スニペットは信頼できない文字列のため textContent のみで描画する。
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

  const topicInput = must<HTMLInputElement>('topic-input');
  const ctlMaxTurns = must<HTMLInputElement>('ctl-max-turns');
  const ctlTurnsUp = must<HTMLButtonElement>('ctl-turns-up');
  const ctlTurnsDown = must<HTMLButtonElement>('ctl-turns-down');
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
  const inBetweenTurns = must<HTMLInputElement>('set-between-turns');
  const inPoll = must<HTMLInputElement>('set-poll');
  const inStability = must<HTMLInputElement>('set-stability');
  const inTimeout = must<HTMLInputElement>('set-timeout');
  const inAdminRatio = must<HTMLInputElement>('set-admin-ratio');
  const inChatSplit = must<HTMLInputElement>('set-chat-split');
  const inChatZoom = must<HTMLInputElement>('set-chat-zoom');
  const taOpening = must<HTMLTextAreaElement>('set-opening');
  const taCounter = must<HTMLTextAreaElement>('set-counter');
  const taRelay = must<HTMLTextAreaElement>('set-relay');
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
    if (!status.ready) return status.loading ? '読み込み中' : 'ChatGPT / Gemini の画面になっていません';
    if (status.rateLimited) return 'レート制限中';
    return status.loggedIn ? 'ログイン済み' : 'ゲスト(ログインなしで利用中)';
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
      loginBannerText.textContent = `${stuck.join(' と ')} が ChatGPT / Gemini の画面になっていません`;
      loginBannerHint.textContent = 'ログイン中なら完了後に戻ります。戻らなければ下のパネルで確認してください';
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
    loginBannerText.textContent = `${guests.join(' と ')} はログインなしで使えます`;
    loginBannerHint.textContent =
      'ログインすると、会話がサイト側の履歴に残り、利用制限が緩くなることがあります' +
      (locked ? '(停止後に下のパネルでログインできます)' : '(下のパネルでログイン)');
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
  ctlTurnsUp.addEventListener('click', () => stepTurns(1));
  ctlTurnsDown.addEventListener('click', () => stepTurns(-1));

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
      localLog('warn', 'テーマを入力してください');
      topicInput.focus();
      return;
    }
    // 操作バーのターン数をそのラン用の上書きとして渡す(設定の既定は変えない)
    api.startDebate(topic, defaultMaxTurns).catch((err) => localLog('error', `開始失敗: ${errMsg(err)}`));
  });
  btnPause.addEventListener('click', () => {
    api.pauseDebate().catch((err) => localLog('error', `一時停止失敗: ${errMsg(err)}`));
  });
  btnResume.addEventListener('click', () => {
    api.resumeDebate().catch((err) => localLog('error', `再開失敗: ${errMsg(err)}`));
  });
  btnStop.addEventListener('click', () => {
    api.stopDebate().catch((err) => localLog('error', `停止失敗: ${errMsg(err)}`));
  });
  btnTranscript.addEventListener('click', () => {
    api.toggleTranscript().catch((err) => localLog('error', `表示切替失敗: ${errMsg(err)}`));
  });

  topicInput.addEventListener('keydown', (ev) => {
    // IME の変換確定 Enter で議論が開始してしまわないよう isComposing を除外
    if (ev.key === 'Enter' && !ev.isComposing && !btnStart.disabled) btnStart.click();
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
      taOpening.value = s.debate.openingTemplate;
      taCounter.value = s.debate.counterTemplate;
      taRelay.value = s.debate.relayTemplate;
      setNextRunTurns(s.debate.maxTurns);
    } catch (err) {
      localLog('error', `設定読込失敗: ${errMsg(err)}`);
    }
  }

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
            openingTemplate: taOpening.value,
            counterTemplate: taCounter.value,
            relayTemplate: taRelay.value,
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
        localLog('error', `設定保存失敗: ${errMsg(err)}`);
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
    historyList.appendChild(el('div', 'drawer-empty', '読み込み中…'));
    try {
      const convs = await api.listConversations();
      historyList.textContent = '';
      if (convs.length === 0) {
        historyList.appendChild(el('div', 'drawer-empty', '履歴はまだありません'));
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
      historyList.appendChild(el('div', 'drawer-empty', `履歴読込失敗: ${errMsg(err)}`));
    }
  }

  async function openConversation(conv: ConversationRecord): Promise<void> {
    historyList.classList.add('hidden');
    historyDetail.classList.remove('hidden');
    historyTitle.textContent = conv.title;
    historyMessages.textContent = '';
    historyMessages.appendChild(el('div', 'drawer-empty', '読み込み中…'));
    try {
      const msgs = await api.getMessages(conv.id);
      historyMessages.textContent = '';
      if (msgs.length === 0) {
        historyMessages.appendChild(el('div', 'drawer-empty', 'メッセージがありません'));
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
      historyMessages.appendChild(el('div', 'drawer-empty', `読込失敗: ${errMsg(err)}`));
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
    searchResults.appendChild(el('div', 'drawer-empty', '検索中…'));
    try {
      const hits = await api.search(query);
      if (seq !== searchSeq) return; // 古い応答は捨てる
      searchResults.textContent = '';
      if (hits.length === 0) {
        searchResults.appendChild(el('div', 'drawer-empty', '該当なし'));
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
      searchResults.appendChild(el('div', 'drawer-empty', `検索失敗: ${errMsg(err)}`));
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
    btnTranscript.textContent = visible ? 'ライブ' : '経過';
  });

  async function init(): Promise<void> {
    try {
      const [settings, chatStatus] = await Promise.all([api.getSettings(), api.getChatStatus()]);
      setNextRunTurns(settings.debate.maxTurns);
      chats = chatStatus;
    } catch (err) {
      localLog('error', `初期化失敗: ${errMsg(err)}`);
    }
    updateRunnerUi();
    updateChatUi();
    localLog('info', '管理パネル起動');
  }

  void init();
})();
