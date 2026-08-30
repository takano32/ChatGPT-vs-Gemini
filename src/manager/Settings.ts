// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import {
  DEFAULT_SETTINGS,
  MODES,
  isMode,
  type DebateTemplates,
  type Lang,
  type Mode,
  SettingsData,
  Speaker,
  type Timekeeper,
} from '../shared/types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** 有限の数値なら丸めて返す。数値でなければ null(= 記録なし) */
function finitePosition(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

/** 有限の数値なら [min, max] に収めて返す。数値でなければ(文字列・null・NaN など)fallback */
function clampNumber(value: unknown, fallback: number, min: number, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** 空でない文字列ならそのまま返す。空文字・空白だけ・文字列以外は fallback */
function nonEmptyText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

/** 'chatgpt' | 'gemini' 以外は fallback */
function speakerOf(value: unknown, fallback: Speaker): Speaker {
  return value === 'chatgpt' || value === 'gemini' ? value : fallback;
}

/** input[key] がプレーンオブジェクトならそれを、欠落や型違いなら空オブジェクトを返す */
function sectionOf(input: unknown, key: string): Record<string, unknown> {
  if (!isPlainObject(input)) return {};
  const section = input[key];
  return isPlainObject(section) ? section : {};
}

/**
 * どんな値からでも安全な SettingsData を作る純粋関数。settings.json の中身(手編集されうる)や
 * IPC で受け取った値は、必ずここを通してから使う。
 * - 欠けているキーは既定値で埋め、知らないキーは捨てる
 * - 数値は許容範囲に丸める。数値でないもの(文字列など)は既定値
 * - firstSpeaker は 'chatgpt' | 'gemini' 以外なら既定値、language は 'ja' | 'en' 以外なら既定値
 * - テンプレートは言語 × モード(templates.ja.debate など)。空なら既定値。旧形式も引き継ぐ:
 *   0.3.0 以前は debate 直下に openingTemplate 等(→ ja の対立)、0.4.x は templates.ja 直下に 3 本(→ その言語の対立)。
 *   旧 relayTemplate は先攻・後攻の両方の中継に入れる。mode は既知のモード名以外なら既定値
 *
 * 上限・下限は renderer.ts の丸め(clampRatio / setNextRunTurns)と Window.ts の minWidth / minHeight に
 * 合わせている。index.html の min / max は入力補助で、正とするのはここ。
 */
export function normalizeSettings(input: unknown): SettingsData {
  const d = DEFAULT_SETTINGS;
  const layout = sectionOf(input, 'layout');
  const debate = sectionOf(input, 'debate');
  const detection = sectionOf(input, 'detection');
  const win = sectionOf(input, 'window');
  const templates = sectionOf(debate, 'templates');
  const templatesOf = (lang: Lang, mode: Mode): DebateTemplates => {
    const byLang = sectionOf(templates, lang);
    let src: Record<string, unknown>;
    if (isPlainObject(byLang[mode])) src = byLang[mode];
    else if (mode === 'debate' && typeof byLang.openingTemplate === 'string') src = byLang; // 0.4.x: 言語直下の 3 本
    else if (mode === 'debate' && lang === 'ja' && !isPlainObject(templates.ja) && typeof debate.openingTemplate === 'string') {
      src = debate; // 0.3.0 以前: debate 直下の 3 本
    } else src = {};
    const def = d.debate.templates[lang][mode];
    const relay = typeof src.relayTemplate === 'string' ? src.relayTemplate : undefined; // 旧 1 本の中継
    return {
      openingTemplate: nonEmptyText(src.openingTemplate, def.openingTemplate),
      counterTemplate: nonEmptyText(src.counterTemplate, def.counterTemplate),
      relayFirstTemplate: nonEmptyText(src.relayFirstTemplate ?? relay, def.relayFirstTemplate),
      relaySecondTemplate: nonEmptyText(src.relaySecondTemplate ?? relay, def.relaySecondTemplate),
      closingTemplate: nonEmptyText(src.closingTemplate, def.closingTemplate),
    };
  };
  const timekeeperSection = sectionOf(debate, 'timekeeper');
  const timekeeperOf = (lang: Lang): Timekeeper => {
    const src = sectionOf(timekeeperSection, lang);
    const def = d.debate.timekeeper[lang];
    return {
      template: nonEmptyText(src.template, def.template),
      early: nonEmptyText(src.early, def.early),
      middle: nonEmptyText(src.middle, def.middle),
      late: nonEmptyText(src.late, def.late),
    };
  };
  const allTemplates = (lang: Lang): Record<Mode, DebateTemplates> =>
    Object.fromEntries(MODES.map((m) => [m, templatesOf(lang, m)])) as Record<Mode, DebateTemplates>;
  const langInput = isPlainObject(input) ? input.language : undefined;
  return {
    language: langInput === 'ja' || langInput === 'en' ? langInput : d.language,
    layout: {
      // 比率は 0 / 1 に潰れないよう 0.05〜0.95
      adminRatio: clampNumber(layout.adminRatio, d.layout.adminRatio, 0.05, 0.95),
      chatSplit: clampNumber(layout.chatSplit, d.layout.chatSplit, 0.05, 0.95),
      chatZoom: clampNumber(layout.chatZoom, d.layout.chatZoom, 0.25, 3),
    },
    debate: {
      // ターン数は整数。小数は切り捨て
      maxTurns: Math.floor(clampNumber(debate.maxTurns, d.debate.maxTurns, 1, 99)),
      firstSpeaker: speakerOf(debate.firstSpeaker, d.debate.firstSpeaker),
      mode: isMode(debate.mode) ? debate.mode : d.debate.mode,
      templates: { ja: allTemplates('ja'), en: allTemplates('en') },
      timekeeper: { ja: timekeeperOf('ja'), en: timekeeperOf('en') },
      betweenTurnsMs: clampNumber(debate.betweenTurnsMs, d.debate.betweenTurnsMs, 0),
    },
    detection: {
      pollMs: clampNumber(detection.pollMs, d.detection.pollMs, 100),
      stabilityMs: clampNumber(detection.stabilityMs, d.detection.stabilityMs, 500),
      timeoutMs: clampNumber(detection.timeoutMs, d.detection.timeoutMs, 1000),
    },
    window: {
      // 位置はどのモニタにあるかで負にもなるので範囲は絞らない(見えない位置の補正は Window.create() 側)
      x: finitePosition(win.x),
      y: finitePosition(win.y),
      // ピクセルなので整数に丸める
      width: Math.round(clampNumber(win.width, d.window.width, 1000)),
      height: Math.round(clampNumber(win.height, d.window.height, 700)),
    },
  };
}

/**
 * 設定の永続化。JSON ファイル 1 枚 + アトミック書き込み。
 * 読み込み時・保存時のどちらも normalizeSettings を通すので、保持している値は常に正規化済み。
 * 'change' イベントで最新の SettingsData を通知する。
 */
export class Settings extends EventEmitter {
  private data: SettingsData = structuredClone(DEFAULT_SETTINGS);

  constructor(private filePath: string) {
    super();
  }

  load(): void {
    if (!existsSync(this.filePath)) {
      // ファイルが無ければデフォルトのまま(初回 set まで書き込まない)
      this.data = structuredClone(DEFAULT_SETTINGS);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
    } catch {
      // 壊れたファイルは退避してデフォルトに戻す
      try {
        renameSync(this.filePath, this.filePath + '.bak-' + Date.now());
      } catch {
        // 退避失敗は無視(次回 set で上書きされる)
      }
      this.data = structuredClone(DEFAULT_SETTINGS);
      return;
    }
    // JSON としては読めても、手編集で範囲外・型違いの値が入っていることがある。
    // ここで既定値で埋めつつ丸める(ファイル自体は次の set まで書き換えない)
    this.data = normalizeSettings(parsed);
  }

  get(): SettingsData {
    return structuredClone(this.data);
  }

  set(next: SettingsData): void {
    // renderer(IPC)から来た値も信用せず、保存前に正規化する
    this.data = normalizeSettings(next);
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = this.filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(this.data, null, 2));
    renameSync(tmpPath, this.filePath);
    this.emit('change', this.get());
  }

  update(partial: unknown): void {
    this.set(this.merge(this.get(), partial));
  }

  // base に無いキーは無視。プレーンオブジェクトのみ再帰、配列/プリミティブは丸ごと置換。
  // 値の検証はしない(set が normalizeSettings で行う)
  private merge(base: SettingsData, patch: unknown): SettingsData {
    const mergeInto = (
      target: Record<string, unknown>,
      source: Record<string, unknown>,
    ): void => {
      for (const key of Object.keys(source)) {
        if (!(key in target)) continue;
        const targetValue = target[key];
        const sourceValue = source[key];
        if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
          mergeInto(targetValue, sourceValue);
        } else if (sourceValue !== undefined) {
          target[key] = structuredClone(sourceValue);
        }
      }
    };
    if (isPlainObject(patch)) {
      mergeInto(base as unknown as Record<string, unknown>, patch);
    }
    return base;
  }
}
