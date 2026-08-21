// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { WebContentsView } from 'electron';
import { SettingsData } from '../shared/types';
import { Chat } from './Chat';
import { CHATGPT_SELECTORS } from './selectors';

export class ChatGPT extends Chat {
  constructor(view: WebContentsView, getDetection: () => SettingsData['detection']) {
    super('chatgpt', view, CHATGPT_SELECTORS, getDetection);
  }
}
