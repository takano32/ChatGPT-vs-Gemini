// チャットビュー(ChatGPT/Gemini)用 preload。
// document_start(ページ本体のスクリプトより前)で毎回走るため、遷移をまたいでも
// 隙間なく操作ロックが効く。ロック状態は localStorage に持たせて遷移を越えて継続する。
//   __cvgLock  : '1' のとき実ユーザ操作(スクロール以外)を遮断
//   __cvgLockUi: '1' のときロック表示バッジを出す
// main 側は webContents.executeJavaScript で上記キーを書き換える(localStorage は
// origin 単位で全ワールド共有なので、isolated world の本 preload から読める)。
(() => {
  'use strict';
  const LOCK = '__cvgLock';
  const UI = '__cvgLockUi';
  const read = (k) => {
    try {
      return localStorage.getItem(k) === '1';
    } catch {
      return false;
    }
  };

  const scrollKeys = new Set([
    'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', ' ', 'Spacebar',
  ]);
  // 遮断したポインタ操作(スクロールバーのつまみ等)も「利用者がスクロールしようとしている」事実は
  // ページ側のスクロール追従(Chat.ts の follower、main world)に伝える必要がある。ワールドをまたぐので
  // <html> の data 属性で渡す: cvgIntent=最後の操作時刻(ms)、cvgDown=押下中なら '1'。
  const noteIntent = (e) => {
    const html = document.documentElement; // document_start では未生成のことがあるので都度取る
    if (!html) return;
    if (e.type === 'pointerdown' || e.type === 'mousedown' || e.type === 'touchstart') {
      html.dataset.cvgIntent = String(Date.now());
      html.dataset.cvgDown = '1';
    } else if (e.type === 'pointerup' || e.type === 'mouseup' || e.type === 'touchend') {
      html.dataset.cvgDown = '0';
    }
  };
  const block = (e) => {
    if (!read(LOCK) || !e.isTrusted) return;
    if (
      (e.type === 'keydown' || e.type === 'keyup' || e.type === 'keypress') &&
      scrollKeys.has(e.key)
    ) {
      return; // スクロール系キーは許可
    }
    noteIntent(e);
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
  };
  // wheel / scroll は遮断しない(スクロールは常に許可)
  const types = [
    'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu',
    'keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'paste', 'cut',
    'drop', 'dragstart', 'dragover', 'pointerdown', 'pointerup', 'touchstart',
    'touchend', 'submit',
  ];
  for (const t of types) window.addEventListener(t, block, true);

  // ロック表示バッジ
  let badge = null;
  const ensureBadge = () => {
    if (!document.body) return;
    if (badge && document.body.contains(badge)) return;
    badge = document.createElement('div');
    badge.id = '__cvg_lock_badge';
    badge.textContent = '🔒 操作ロック中 — スクロールのみ可';
    const s = badge.style;
    s.position = 'fixed';
    s.top = '8px';
    s.right = '8px';
    s.zIndex = '2147483647';
    s.background = 'rgba(20,24,30,0.92)';
    s.color = '#f5b453';
    s.font = '600 12px ui-monospace, "Noto Sans Mono CJK JP", monospace';
    s.padding = '5px 10px';
    s.borderRadius = '4px';
    s.border = '1px solid rgba(245,180,83,0.5)';
    s.pointerEvents = 'none';
    s.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';
    document.body.appendChild(badge);
  };
  const updateBadge = () => {
    ensureBadge();
    if (badge) badge.style.display = read(UI) ? 'block' : 'none';
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateBadge);
  } else {
    updateBadge();
  }
  // 同一ドキュメント内の localStorage 変更は 'storage' が飛ばないため軽くポーリング
  setInterval(updateBadge, 400);
})();
