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
  const block = (e) => {
    if (!read(LOCK) || !e.isTrusted) return;
    if (
      (e.type === 'keydown' || e.type === 'keyup' || e.type === 'keypress') &&
      scrollKeys.has(e.key)
    ) {
      return; // スクロール系キーは許可
    }
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
