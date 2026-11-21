import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('folioDesktop', {
  isElectron: true,
  platform: process.platform,
});
