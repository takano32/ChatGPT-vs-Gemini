// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// 議論 1 件のインメモリ集約。永続化は Repository が担当し、ここでは状態のみ持つ。

import type { ConversationRecord, ConversationStatus, MessageRecord } from '../shared/types';

export class Conversation {
  readonly id: number;
  readonly title: string;
  status: ConversationStatus;
  readonly messages: MessageRecord[];

  constructor(record: ConversationRecord) {
    this.id = record.id;
    this.title = record.title;
    this.status = record.status;
    this.messages = [];
  }

  addMessage(m: MessageRecord): void {
    this.messages.push(m);
  }

  /** 1 AI 発言 = 1 ターン */
  get turnCount(): number {
    return this.messages.length;
  }
}
