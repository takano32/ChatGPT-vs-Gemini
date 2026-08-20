import { WebContentsView } from 'electron';
import { SettingsData } from '../shared/types';
import { Chat } from './Chat';
import { GEMINI_SELECTORS } from './selectors';

export class Gemini extends Chat {
  constructor(view: WebContentsView, getDetection: () => SettingsData['detection']) {
    super('gemini', view, GEMINI_SELECTORS, getDetection);
  }
}
