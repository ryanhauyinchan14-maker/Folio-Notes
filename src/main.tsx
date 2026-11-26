import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import 'katex/dist/katex.min.css';
import './index.css';
import { initPwaInstallPrompt, registerPwaServiceWorker } from './utils/pwa';

initPwaInstallPrompt();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

void registerPwaServiceWorker();
