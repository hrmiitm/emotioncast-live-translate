const { contextBridge, ipcRenderer, webFrame } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  call: (method, ...args) => ipcRenderer.invoke(method, ...args),
  onEvent: (fn) => {
    const cb = (_, v) => fn(v);
    ipcRenderer.on("live-event", cb);
    return () => ipcRenderer.removeListener("live-event", cb);
  },
  setZoom: (factor) => {
    try {
      webFrame.setZoomFactor(factor);
    } catch {}
  },
  getZoom: () => {
    try {
      return webFrame.getZoomFactor();
    } catch {
      return 1;
    }
  },
});
