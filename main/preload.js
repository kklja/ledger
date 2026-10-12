'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('api', {
  getState: call('state:get'),
  updateSettings: call('settings:update'),
  saveCourses: call('courses:save'),
  ignoreLmsCourse: call('courses:ignoreLms'),
  saveReminders: call('reminders:save'),
  saveEvents: call('events:save'),
  clearActivity: call('activity:clear'),
  saveInbox: call('inbox:save'),
  resolvePending: call('pending:resolve'),
  listNotes: call('notes:list'),
  getNote: call('notes:get'),
  saveNote: call('notes:save'),
  deleteNote: call('notes:delete'),
  saveImage: call('image:save'),
  listQuizzes: call('quiz:list'),
  getQuiz: call('quiz:get'),
  saveQuiz: call('quiz:save'),
  checkCoursework: call('lms:check'),
  openLogin: call('lms:login'),
  syncFeeds: call('feeds:sync'),
  aiDetect: call('ai:detect'),
  aiRun: call('ai:run'),
  aiCancel: call('ai:cancel'),
  aiGet: call('ai:get'),
  phoneInfo: call('phone:info'),
  openExternal: call('open:external'),
  openDataDir: call('open:dataDir'),
  openCourseFiles: call('open:courseFiles'),
  testNotification: call('notify:test'),
  checkForUpdates: call('update:check'),
  installUpdate: call('update:install'),
  on(channel, fn) {
    const allowed = ['state:changed', 'check:log', 'ai:log', 'ai:done', 'phone:image', 'nav'];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
