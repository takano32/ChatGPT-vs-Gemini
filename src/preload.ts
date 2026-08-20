// contextIsolation:true / sandbox:false 前提。
// dist/preload.js から相対 require で dist/shared/ipc.js を読むため sandbox は無効であること。
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { IPC } from './shared/ipc';
import type { RendererApi } from './shared/ipc';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => {
    cb(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: RendererApi = {
  startDebate: (topic) => ipcRenderer.invoke(IPC.runnerStart, topic),
  stopDebate: () => ipcRenderer.invoke(IPC.runnerStop),
  pauseDebate: () => ipcRenderer.invoke(IPC.runnerPause),
  resumeDebate: () => ipcRenderer.invoke(IPC.runnerResume),

  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (settings) => ipcRenderer.invoke(IPC.settingsSet, settings),

  search: (query) => ipcRenderer.invoke(IPC.search, query),
  listConversations: () => ipcRenderer.invoke(IPC.listConversations),
  getMessages: (conversationId) => ipcRenderer.invoke(IPC.getMessages, conversationId),
  getChatStatus: () => ipcRenderer.invoke(IPC.chatStatus),
  toggleTranscript: () => ipcRenderer.invoke(IPC.transcriptToggle),
  showConversationTranscript: (conversationId) =>
    ipcRenderer.invoke(IPC.transcriptShowConversation, conversationId),
  copyTranscriptMarkdown: (conversationId) =>
    ipcRenderer.invoke(IPC.transcriptCopyMarkdown, conversationId),

  onLog: (cb) => subscribe(IPC.evLog, cb),
  onRunnerStatus: (cb) => subscribe(IPC.evRunnerStatus, cb),
  onMessage: (cb) => subscribe(IPC.evMessage, cb),
  onChatStatus: (cb) => subscribe(IPC.evChatStatus, cb),
  onTranscript: (cb) => subscribe(IPC.evTranscript, cb),
  onTranscriptVisible: (cb) => subscribe(IPC.evTranscriptVisible, cb),
};

contextBridge.exposeInMainWorld('api', api);
