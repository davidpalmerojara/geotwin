import React, { Component } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
// IBM Plex Sans Condensed and IBM Plex Mono (SIL Open Font License 1.1), Latin subset only.
import '@fontsource/ibm-plex-sans-condensed/latin-400.css';
import '@fontsource/ibm-plex-sans-condensed/latin-500.css';
import '@fontsource/ibm-plex-sans-condensed/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './styles/globals.css';
const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10000, retry: 1, refetchOnWindowFocus: true, refetchInterval: 30000 },
    mutations: { retry: false },
  },
});
class Boundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="state-box app-error">
        <h1>No se pudo mostrar esta vista</h1>
        <p>{this.state.error.message}</p>
        <button className="btn" onClick={() => location.reload()}>
          Recargar la aplicación
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Boundary>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </Boundary>
  </React.StrictMode>,
);
