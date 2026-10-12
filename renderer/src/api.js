import { createMock } from './mock.js';

// In the desktop app, preload.js provides window.api. Opening index.html in a plain
// browser (for UI development) falls back to an in-memory mock with sample data.
export const api = window.api || createMock();
export const isMock = !window.api;
