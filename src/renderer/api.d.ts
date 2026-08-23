// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// preload が contextBridge で公開する window.api の型。契約本体は src/shared/ipc.ts(Project References で参照)。
import type { RendererApi } from '../shared/ipc';

declare global {
  interface Window {
    api: RendererApi;
  }
}

export {};
