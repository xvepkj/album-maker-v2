const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  defaults:   ()      => ipcRenderer.invoke('defaults'),
  pickFolder: ()      => ipcRenderer.invoke('pick-folder'),
  design:     (job)   => ipcRenderer.invoke('design', job),
  exportPsd:  (job)   => ipcRenderer.invoke('export', job),
  inspectPsd: (job)   => ipcRenderer.invoke('inspect', job),
  deliver:    (job)   => ipcRenderer.invoke('deliver', job),
  reveal:     (p)     => ipcRenderer.invoke('reveal', p),
  openFile:   (p)     => ipcRenderer.invoke('open-file', p),
  onEvent:    (fn)    => ipcRenderer.on('service-event', (_e, payload) => fn(payload)),
});
