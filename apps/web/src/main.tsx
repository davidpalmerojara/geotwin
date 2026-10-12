import React, { Component } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
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
      <div className="state-box">
        <h1>No se pudo mostrar esta vista</h1>
        <p>{this.state.error.message}</p>
        <button onClick={() => location.reload()}>Recargar la aplicación</button>
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
