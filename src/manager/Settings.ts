import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_SETTINGS, SettingsData } from '../shared/types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * 設定の永続化。JSON ファイル 1 枚 + アトミック書き込み。
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
    this.data = this.merge(structuredClone(DEFAULT_SETTINGS), parsed);
  }

  get(): SettingsData {
    return structuredClone(this.data);
  }

  set(next: SettingsData): void {
    this.data = structuredClone(next);
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
