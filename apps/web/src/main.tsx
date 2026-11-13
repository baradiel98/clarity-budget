import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, StartupProblem } from './App';
import { SessionProvider } from './state/session';
import { ToastProvider } from './ui/Toast';
import './styles/tokens.css';
import './styles/base.css';
import { captureInstallPrompt } from './platform/persistence';

captureInstallPrompt();

/** Any unexpected error shows a message with a way out, never a blank page. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error) return <StartupProblem message={`Something went wrong (${this.state.error.name}: ${this.state.error.message.slice(0, 160)}). Your saved data is not affected.`} />;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <SessionProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SessionProvider>
    </ErrorBoundary>
  </StrictMode>,
);
