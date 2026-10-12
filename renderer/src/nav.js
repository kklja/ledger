// Tiny router hub so views can navigate without importing the shell.
const nav = { go: () => {}, current: 'today' };
export const go = (id, opts) => nav.go(id, opts);
export const setGo = (fn) => { nav.go = fn; };
export default nav;
