// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
import * as path from 'path';
import { Settings } from './Settings';
import { Window } from './Window';
import { Layout, LayoutMountConfig } from './Layout';

/** Settings / Window / Layout を束ねる起動コア */
export class Manager {
  public readonly settings: Settings;
  public readonly window: Window;
  public readonly layout: Layout;

  constructor(userDataPath: string) {
    this.settings = new Settings(path.join(userDataPath, 'settings.json'));
    this.window = new Window(this.settings);
    this.layout = new Layout(this.window, this.settings);
  }

  init(config: LayoutMountConfig): void {
    this.settings.load();
    this.window.create();
    this.layout.mount(config);
  }
}
