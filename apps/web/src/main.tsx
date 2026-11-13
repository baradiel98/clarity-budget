import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SessionProvider } from './state/session';
import { ToastProvider } from './ui/Toast';
import './styles/tokens.css';
import './styles/base.css';
import { captureInstallPrompt } from './platform/persistence';

captureInstallPrompt();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </SessionProvider>
  </StrictMode>,
);
