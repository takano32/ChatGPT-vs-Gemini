// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Settings(settings.json の読み書きと正規化)の自動テスト。node:test だけで動く(依存追加なし)。
// テスト対象はコンパイル済みの dist/manager/Settings.js なので、`npm run build` のあとに `npm test` で走る。
// テストごとに os.tmpdir() 配下へ新しい settings.json を作り、終了時に消す(互いに独立)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Settings, normalizeSettings } from '../dist/manager/Settings.js';
import { DEFAULT_SETTINGS } from '../dist/shared/types.js';

const D = DEFAULT_SETTINGS;

// 既定値と全項目が異なる、範囲内の正常な設定(「正常値はそのまま通る」ことの確認用)
const CUSTOM = {
  language: 'en',
  layout: { adminRatio: 0.3, chatSplit: 0.6, chatZoom: 1 },
  debate: {
    maxTurns: 4,
    firstSpeaker: 'gemini',
    templates: {
      ja: {
        openingTemplate: 'A {topic} {opponent}',
        counterTemplate: 'B {topic} {opponent} {message}',
        relayTemplate: 'C {opponent} {message}',
      },
      en: {
        openingTemplate: 'EA {topic} {opponent}',
        counterTemplate: 'EB {topic} {opponent} {message}',
        relayTemplate: 'EC {opponent} {message}',
      },
    },
    betweenTurnsMs: 1500,
  },
  detection: { pollMs: 200, stabilityMs: 3000, timeoutMs: 60000 },
  window: { width: 1400, height: 900 },
};

// 1 項目だけ入れた入力を作る: withValue('debate', 'maxTurns', 0) → { debate: { maxTurns: 0 } }
function withValue(section, key, value) {
  return { [section]: { [key]: value } };
}

// テスト 1 件ぶんの作業場。一時ディレクトリを終了時に片付ける
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chatgpt-vs-gemini-test-'));
  // set() が親ディレクトリを作ることも確かめるため 1 段深くする
  const filePath = join(dir, 'userData', 'settings.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return {
    dir: dirname(filePath),
    filePath,
    open() {
      const settings = new Settings(filePath);
      settings.load();
      return settings;
    },
    // Settings を通さずファイルを直接書く(手編集の再現用)
    writeRaw(text) {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, text);
    },
    readSaved() {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    },
  };
}

// ---------- normalizeSettings(純粋関数) ----------

test('normalizeSettings: オブジェクトでない入力や空オブジェクトは既定値になり、既定値そのものは変更されない', () => {
  for (const input of [undefined, null, 'abc', 42, true, [], {}]) {
    assert.deepEqual(normalizeSettings(input), D, `input: ${JSON.stringify(input)}`);
  }
  const out = normalizeSettings({});
  out.debate.maxTurns = 1;
  out.layout.adminRatio = 0.1;
  assert.equal(D.debate.maxTurns, 10, '返り値は既定値のコピーで、書き換えても既定値は変わらない');
  assert.equal(D.layout.adminRatio, 0.5);
});

test('normalizeSettings: 範囲内の正常値はそのまま通る(境界値を含む)', () => {
  assert.deepEqual(normalizeSettings(CUSTOM), CUSTOM);

  const lower = {
    language: 'ja',
    layout: { adminRatio: 0.05, chatSplit: 0.05, chatZoom: 0.25 },
    debate: { ...CUSTOM.debate, maxTurns: 1, betweenTurnsMs: 0 },
    detection: { pollMs: 100, stabilityMs: 500, timeoutMs: 1000 },
    window: { width: 1000, height: 700 },
  };
  assert.deepEqual(normalizeSettings(lower), lower, '下限ちょうどは丸めない');

  const upper = {
    ...lower,
    layout: { adminRatio: 0.95, chatSplit: 0.95, chatZoom: 3 },
    debate: { ...lower.debate, maxTurns: 99, betweenTurnsMs: 600000 },
    detection: { pollMs: 5000, stabilityMs: 60000, timeoutMs: 3600000 },
    window: { width: 5120, height: 2880 },
  };
  assert.deepEqual(normalizeSettings(upper), upper, '上限ちょうど・上限なしの大きな値は丸めない');
});

test('normalizeSettings: 欠けたキーは既定値で埋まり、知らないキーは捨てられる', () => {
  const input = {
    debate: { maxTurns: 5, bogus: 'x' },
    layout: 'oops', // セクション自体が型違い
    window: null,
    detection: [150],
    extra: { anything: true },
  };
  const expected = structuredClone(D);
  expected.debate.maxTurns = 5;
  assert.deepEqual(normalizeSettings(input), expected);
  assert.deepEqual(Object.keys(normalizeSettings(input)).sort(), Object.keys(D).sort(), '余計なトップレベルのキーは無い');
  assert.ok(!('bogus' in normalizeSettings(input).debate), '余計なネストのキーも無い');
});

test('normalizeSettings: 数値項目は範囲に丸め、数値でないものは既定値', () => {
  // [セクション, キー, 入力, 期待値, 説明]
  const cases = [
    ['debate', 'maxTurns', 0, 1, '下限 1'],
    ['debate', 'maxTurns', -5, 1, '負数も下限'],
    ['debate', 'maxTurns', 1000, 99, '上限 99'],
    ['debate', 'maxTurns', 2.7, 2, '小数は切り捨て'],
    ['debate', 'maxTurns', 'abc', D.debate.maxTurns, '文字列は既定値'],
    ['debate', 'maxTurns', '5', D.debate.maxTurns, '数字の文字列も既定値(数値だけ受け付ける)'],
    ['debate', 'maxTurns', null, D.debate.maxTurns, 'null は既定値'],
    ['debate', 'maxTurns', NaN, D.debate.maxTurns, 'NaN は既定値'],
    ['debate', 'maxTurns', Infinity, D.debate.maxTurns, 'Infinity は既定値'],
    ['debate', 'betweenTurnsMs', -100, 0, '下限 0'],
    ['debate', 'betweenTurnsMs', 'x', D.debate.betweenTurnsMs, '文字列は既定値'],
    ['detection', 'pollMs', 1, 100, '下限 100'],
    ['detection', 'pollMs', 0, 100, '0 も下限'],
    ['detection', 'pollMs', '200', D.detection.pollMs, '数字の文字列は既定値'],
    ['detection', 'stabilityMs', -1, 500, '下限 500'],
    ['detection', 'timeoutMs', 'x', D.detection.timeoutMs, '文字列は既定値'],
    ['detection', 'timeoutMs', 0, 1000, '下限 1000'],
    ['layout', 'adminRatio', 5, 0.95, '上限 0.95'],
    ['layout', 'adminRatio', 0, 0.05, '下限 0.05'],
    ['layout', 'adminRatio', -1, 0.05, '負数も下限'],
    ['layout', 'adminRatio', 'x', D.layout.adminRatio, '文字列は既定値'],
    ['layout', 'chatSplit', 1, 0.95, '上限 0.95'],
    ['layout', 'chatSplit', 0, 0.05, '下限 0.05'],
    ['layout', 'chatZoom', 0, 0.25, '下限 0.25'],
    ['layout', 'chatZoom', 10, 3, '上限 3'],
    ['layout', 'chatZoom', 'x', D.layout.chatZoom, '文字列は既定値'],
    ['window', 'width', 10, 1000, '下限 1000(Window.ts の minWidth)'],
    ['window', 'width', 'wide', D.window.width, '文字列は既定値'],
    ['window', 'width', 1280.6, 1281, 'ピクセルは整数に丸める'],
    ['window', 'height', 10, 700, '下限 700(Window.ts の minHeight)'],
    ['window', 'height', -5, 700, '負数も下限'],
  ];
  for (const [section, key, input, expected, why] of cases) {
    const out = normalizeSettings(withValue(section, key, input));
    assert.equal(out[section][key], expected, `${section}.${key} = ${String(input)} → ${expected}(${why})`);
    // 他の項目は既定値のまま
    const rest = structuredClone(out);
    rest[section][key] = D[section][key];
    assert.deepEqual(rest, D, `${section}.${key} 以外は既定値のまま`);
  }
});

test('normalizeSettings: firstSpeaker は chatgpt / gemini 以外なら既定値', () => {
  const speaker = (value) => normalizeSettings(withValue('debate', 'firstSpeaker', value)).debate.firstSpeaker;
  assert.equal(speaker('gemini'), 'gemini');
  assert.equal(speaker('chatgpt'), 'chatgpt');
  for (const bad of ['foo', 'GEMINI', 'Gemini ', '', 1, null, ['gemini'], { value: 'gemini' }]) {
    assert.equal(speaker(bad), D.debate.firstSpeaker, `firstSpeaker = ${JSON.stringify(bad)}`);
  }
});

test('normalizeSettings: テンプレートは言語ごとに、空でない文字列だけ採用し、空文字・空白のみ・文字列以外は既定値', () => {
  for (const lang of ['ja', 'en']) {
    for (const key of ['openingTemplate', 'counterTemplate', 'relayTemplate']) {
      const tpl = (value) =>
        normalizeSettings({ debate: { templates: { [lang]: { [key]: value } } } }).debate.templates[lang][key];
      assert.equal(tpl('ok {message}'), 'ok {message}', `${lang}.${key}: 普通の文字列はそのまま`);
      assert.equal(tpl(' x '), ' x ', `${lang}.${key}: 前後の空白は削らずそのまま`);
      for (const bad of ['', '   ', ' \n\t ', 123, null, true, ['x'], { text: 'x' }]) {
        assert.equal(tpl(bad), D.debate.templates[lang][key], `${lang}.${key} = ${JSON.stringify(bad)} は既定値`);
      }
    }
  }
  // 片方の言語だけ入れても、もう片方は既定値で埋まる
  const only = normalizeSettings({ debate: { templates: { en: { openingTemplate: 'E' } } } }).debate.templates;
  assert.equal(only.en.openingTemplate, 'E');
  assert.deepEqual(only.ja, D.debate.templates.ja);
});

test('normalizeSettings: language は ja / en だけ。他は既定値(ja)', () => {
  assert.equal(normalizeSettings({ language: 'en' }).language, 'en');
  assert.equal(normalizeSettings({ language: 'ja' }).language, 'ja');
  for (const bad of ['fr', 'EN', '', 1, null, ['en']]) {
    assert.equal(normalizeSettings({ language: bad }).language, 'ja', `language = ${JSON.stringify(bad)}`);
  }
});

test('normalizeSettings: 0.3.0 以前の settings.json(debate 直下の 3 テンプレート)は ja のテンプレートとして引き継ぐ', () => {
  const legacy = {
    debate: {
      openingTemplate: '旧 A {topic}',
      counterTemplate: '旧 B {message}',
      relayTemplate: '旧 C {message}',
    },
  };
  const s = normalizeSettings(legacy);
  assert.deepEqual(s.debate.templates.ja, {
    openingTemplate: '旧 A {topic}',
    counterTemplate: '旧 B {message}',
    relayTemplate: '旧 C {message}',
  });
  assert.deepEqual(s.debate.templates.en, D.debate.templates.en, 'en は既定値');
  assert.equal(s.language, 'ja');
  assert.equal('openingTemplate' in s.debate, false, '旧キーは残さない');
  // 新形式があれば旧キーは無視する
  const both = normalizeSettings({ debate: { ...legacy.debate, templates: { ja: { openingTemplate: '新 A' } } } });
  assert.equal(both.debate.templates.ja.openingTemplate, '新 A');
  assert.equal(both.debate.templates.ja.counterTemplate, D.debate.templates.ja.counterTemplate);
});

// ---------- Settings クラス(ファイルの読み書き) ----------

test('load: ファイルが無ければ既定値のまま、ファイルも作らない', (t) => {
  const { filePath, open } = setup(t);
  const settings = open();
  assert.deepEqual(settings.get(), D);
  assert.equal(existsSync(filePath), false, '初回 set までは書き込まない');
});

test('load: 手編集で壊れた値は丸めて読み込み、ファイルは書き換えない', (t) => {
  const { filePath, open, writeRaw } = setup(t);
  const raw = JSON.stringify(
    {
      layout: { adminRatio: 5, chatZoom: 0 },
      debate: { maxTurns: 0, firstSpeaker: 'foo', templates: { ja: { openingTemplate: '', relayTemplate: 42 } } },
      detection: { pollMs: 1, stabilityMs: -1, timeoutMs: 'x' },
      window: { width: 10 },
      junk: true,
    },
    null,
    2,
  );
  writeRaw(raw);

  const s = open().get();
  assert.equal(s.layout.adminRatio, 0.95);
  assert.equal(s.layout.chatSplit, D.layout.chatSplit, '欠けたキーは既定値');
  assert.equal(s.layout.chatZoom, 0.25);
  assert.equal(s.debate.maxTurns, 1);
  assert.equal(s.debate.firstSpeaker, 'chatgpt');
  assert.deepEqual(s.debate.templates, D.debate.templates);
  assert.equal(s.detection.pollMs, 100);
  assert.equal(s.detection.stabilityMs, 500);
  assert.equal(s.detection.timeoutMs, D.detection.timeoutMs);
  assert.deepEqual(s.window, { width: 1000, height: D.window.height });
  assert.ok(!('junk' in s), '知らないキーは捨てる');
  assert.equal(readFileSync(filePath, 'utf8'), raw, 'load だけではファイルを書き換えない');
});

test('load: JSON として壊れたファイルは .bak- に退避して既定値になる', (t) => {
  const { dir, filePath, open, writeRaw } = setup(t);
  writeRaw('{ これは JSON ではない');

  const settings = open();
  assert.deepEqual(settings.get(), D);
  assert.equal(existsSync(filePath), false, '壊れたファイルは元の場所から退避される');
  const backups = readdirSync(dir).filter((name) => name.startsWith('settings.json.bak-'));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(dir, backups[0]), 'utf8'), '{ これは JSON ではない', '中身はそのまま残る');
});

test('set → load の往復: 保存した設定がそのまま読め、get は毎回コピーを返す', (t) => {
  const { filePath, open, readSaved } = setup(t);
  const first = open();
  first.set(CUSTOM);
  assert.equal(existsSync(filePath), true, 'set が親ディレクトリごとファイルを作る');
  assert.deepEqual(readSaved(), CUSTOM);

  const second = open();
  assert.deepEqual(second.get(), CUSTOM);

  const snapshot = second.get();
  snapshot.debate.maxTurns = 77;
  assert.equal(second.get().debate.maxTurns, CUSTOM.debate.maxTurns, '返り値を書き換えても内部の値は変わらない');
});

test('set: 不正な値は正規化してから保存され、change イベントにも正規化後の値が流れる', (t) => {
  const { filePath, open, readSaved } = setup(t);
  const settings = open();
  const changes = [];
  settings.on('change', (data) => changes.push(data));

  settings.set({
    ...CUSTOM,
    debate: {
      ...CUSTOM.debate,
      maxTurns: 1000,
      firstSpeaker: 'foo',
      templates: { ...CUSTOM.debate.templates, en: { ...CUSTOM.debate.templates.en, relayTemplate: '' } },
    },
    detection: { ...CUSTOM.detection, pollMs: 1 },
    window: { width: 10, height: 'x' },
  });

  const expected = {
    ...CUSTOM,
    debate: {
      ...CUSTOM.debate,
      maxTurns: 99,
      firstSpeaker: 'chatgpt',
      templates: {
        ...CUSTOM.debate.templates,
        en: { ...CUSTOM.debate.templates.en, relayTemplate: D.debate.templates.en.relayTemplate },
      },
    },
    detection: { ...CUSTOM.detection, pollMs: 100 },
    window: { width: 1000, height: D.window.height },
  };
  assert.deepEqual(settings.get(), expected);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], expected, 'change イベントの値も正規化済み');
  assert.deepEqual(readSaved(), expected, 'ファイルにも正規化後の値が書かれる');
  assert.equal(existsSync(filePath + '.tmp'), false, 'アトミック書き込みの一時ファイルは残らない');
});

test('update: 部分的な変更は現在値にマージされ、正規化して保存される', (t) => {
  const { open, readSaved } = setup(t);
  const settings = open();
  settings.set(CUSTOM);

  // Window.ts のリサイズ保存と同じ形。width は下限に丸まり、height はそのまま
  settings.update({ window: { width: 10, height: 1000 } });
  assert.deepEqual(settings.get(), { ...CUSTOM, window: { width: 1000, height: 1000 } });
  assert.deepEqual(readSaved(), settings.get());

  // オブジェクトでないパッチは何も変えない
  settings.update('garbage');
  assert.deepEqual(settings.get(), { ...CUSTOM, window: { width: 1000, height: 1000 } });

  // 数値でない値で上書きしようとすると、その項目は既定値になる(現在値には戻らない)
  settings.update({ debate: { maxTurns: 'abc' } });
  assert.equal(settings.get().debate.maxTurns, D.debate.maxTurns);
  assert.equal(settings.get().debate.firstSpeaker, CUSTOM.debate.firstSpeaker, '触っていない項目はそのまま');
  assert.equal(readSaved().debate.maxTurns, D.debate.maxTurns);
});
