// 議論経過ビュー。main から TranscriptPayload を受け取り、各発言を
// 話者チップ + ターン番号 + Markdown レンダリングの対話形式で表示する。
// AI 応答は信頼できないため、DOM は textContent と要素生成のみで組み立て、
// innerHTML には一切生文字列を入れない。

const SPEAKER_LABEL: Record<Speaker, string> = { chatgpt: 'ChatGPT', gemini: 'Gemini' };
const SPEAKER_EMOJI: Record<Speaker, string> = { chatgpt: '🟢', gemini: '🔵' };
const STATUS_LABEL: Record<string, string> = {
  running: '進行中',
  paused: '一時停止',
  stopped: '停止',
  error: 'エラー',
  done: '完了',
};

const titleEl = document.getElementById('tr-title') as HTMLElement;
const statusEl = document.getElementById('tr-status') as HTMLElement;
const bodyEl = document.getElementById('tr-body') as HTMLElement;
const copyBtn = document.getElementById('tr-copy') as HTMLButtonElement;
const copyFlash = document.getElementById('tr-copy-flash') as HTMLElement;
const backBtn = document.getElementById('tr-back') as HTMLButtonElement;

backBtn.addEventListener('click', () => {
  // 経過表示は現在前面なので、トグルで隠してライブのチャット表示へ戻る
  void window.api.toggleTranscript();
});

let lastConversationId: number | null = null;
let lastCount = 0;
let currentConversationId: number | null = null;
let flashTimer = 0;

window.api.onTranscript((payload) => {
  render(payload);
});

copyBtn.addEventListener('click', () => {
  if (currentConversationId === null) return;
  void window.api.copyTranscriptMarkdown(currentConversationId).then((ok) => {
    if (!ok) return;
    copyFlash.classList.add('show');
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => copyFlash.classList.remove('show'), 1600);
  });
});

function render(payload: TranscriptPayload): void {
  titleEl.textContent = payload.title || '(無題の議論)';
  if (payload.status) {
    statusEl.textContent = STATUS_LABEL[payload.status] ?? payload.status;
    statusEl.className = `tr-status st-${payload.status}`;
  } else {
    statusEl.textContent = '';
    statusEl.className = 'tr-status';
  }

  const isNewConversation = payload.conversationId !== lastConversationId;
  currentConversationId = payload.conversationId;
  copyBtn.disabled = payload.messages.length === 0;

  // 再構築でスクロール位置がリセットされるため、同じ議論への追記では元の位置へ戻す
  // (自動追従はしない。利用者が読んでいる位置を動かさない)
  const scrollBefore = bodyEl.scrollTop;

  bodyEl.textContent = '';
  if (payload.messages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tr-empty';
    empty.textContent = '発言はまだありません。';
    bodyEl.appendChild(empty);
  } else {
    payload.messages.forEach((m, i) => {
      bodyEl.appendChild(turnBlock(m, i + 1, payload.maxTurns));
    });
  }

  // 新しい議論に切り替わったら先頭から。同じ議論への追記では位置を維持する。
  bodyEl.scrollTop = isNewConversation ? 0 : scrollBefore;
  lastConversationId = payload.conversationId;
}

function turnBlock(m: MessageRecord, turn: number, maxTurns: number): HTMLElement {
  const block = document.createElement('section');
  block.className = `tr-turn tr-turn-${m.speaker}`;

  const head = document.createElement('div');
  head.className = 'tr-turn-head';
  const emoji = document.createElement('span');
  emoji.className = 'tr-emoji';
  emoji.textContent = SPEAKER_EMOJI[m.speaker];
  const name = document.createElement('span');
  name.className = `tr-name tr-name-${m.speaker}`;
  name.textContent = SPEAKER_LABEL[m.speaker];
  const counter = document.createElement('span');
  counter.className = 'tr-counter';
  counter.textContent = `(${turn}/${maxTurns})`;
  head.append(emoji, name, counter);

  const content = document.createElement('div');
  content.className = 'tr-content';
  content.appendChild(renderMarkdown(m.content));

  block.append(head, content);
  return block;
}

// ---------- 最小 Markdown レンダラ(安全: DOM 生成のみ) ----------

function renderMarkdown(md: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  const isBlockStart = (l: string): boolean =>
    /^\s*(#{1,6}\s|>|[-*+]\s|\d+\.\s|```)/.test(l) || /^\s*([-*_])\1{2,}\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // コードフェンス
    const fence = line.match(/^\s*```/);
    if (fence) {
      i++;
      const buf: string[] = [];
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 閉じフェンス
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = buf.join('\n');
      pre.appendChild(code);
      frag.appendChild(pre);
      continue;
    }

    // 見出し
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      const el = document.createElement(`h${Math.min(h[1].length, 6)}`);
      el.append(...renderInline(h[2]));
      frag.appendChild(el);
      i++;
      continue;
    }

    // 水平線
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      frag.appendChild(document.createElement('hr'));
      i++;
      continue;
    }

    // 引用
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      const bq = document.createElement('blockquote');
      bq.appendChild(renderMarkdown(buf.join('\n')));
      frag.appendChild(bq);
      continue;
    }

    // 箇条書き
    if (/^\s*[-*+]\s+/.test(line)) {
      const ul = document.createElement('ul');
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const li = document.createElement('li');
        li.append(...renderInline(lines[i].replace(/^\s*[-*+]\s+/, '')));
        ul.appendChild(li);
        i++;
      }
      frag.appendChild(ul);
      continue;
    }

    // 番号付きリスト
    if (/^\s*\d+\.\s+/.test(line)) {
      const ol = document.createElement('ol');
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const li = document.createElement('li');
        li.append(...renderInline(lines[i].replace(/^\s*\d+\.\s+/, '')));
        ol.appendChild(li);
        i++;
      }
      frag.appendChild(ol);
      continue;
    }

    // 段落(空行または次のブロック開始まで)。段落内の改行は <br> に。
    const buf: string[] = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    const p = document.createElement('p');
    buf.forEach((pl, idx) => {
      if (idx > 0) p.appendChild(document.createElement('br'));
      p.append(...renderInline(pl));
    });
    frag.appendChild(p);
  }

  return frag;
}

function renderInline(text: string): Node[] {
  const nodes: Node[] = [];
  // 優先順: `code` / **bold** / *italic* / _italic_ / [text](url)
  const re =
    /(`+)([^`]+?)\1|\*\*([^*]+?)\*\*|\*([^*]+?)\*|_([^_]+?)_|\[([^\]]+?)\]\(([^)\s]+?)\)/;
  let rest = text;
  for (let guard = 0; rest.length > 0 && guard < 5000; guard++) {
    const m = re.exec(rest);
    if (!m) {
      nodes.push(document.createTextNode(rest));
      break;
    }
    if (m.index > 0) nodes.push(document.createTextNode(rest.slice(0, m.index)));
    if (m[2] !== undefined) {
      const code = document.createElement('code');
      code.textContent = m[2];
      nodes.push(code);
    } else if (m[3] !== undefined) {
      const b = document.createElement('strong');
      b.append(...renderInline(m[3]));
      nodes.push(b);
    } else if (m[4] !== undefined) {
      const it = document.createElement('em');
      it.append(...renderInline(m[4]));
      nodes.push(it);
    } else if (m[5] !== undefined) {
      const it = document.createElement('em');
      it.append(...renderInline(m[5]));
      nodes.push(it);
    } else if (m[6] !== undefined && m[7] !== undefined) {
      const a = document.createElement('a');
      if (/^https?:\/\//i.test(m[7]) || /^mailto:/i.test(m[7])) a.href = m[7];
      a.textContent = m[6];
      a.rel = 'noreferrer';
      nodes.push(a);
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return nodes;
}
