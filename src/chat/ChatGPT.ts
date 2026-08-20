import { WebContentsView } from 'electron';
import { SettingsData } from '../shared/types';
import { Chat } from './Chat';
import { CHATGPT_SELECTORS } from './selectors';

export class ChatGPT extends Chat {
  constructor(view: WebContentsView, getDetection: () => SettingsData['detection']) {
    super('chatgpt', view, CHATGPT_SELECTORS, getDetection);
  }
}
