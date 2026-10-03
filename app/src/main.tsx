import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadProtocolDefaults } from './protocolDefaults';
import { strings } from './strings';
import './styles/base.css';

document.title = strings.appName;
const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element in index.html');
const root = createRoot(container);

// The Admin-set PCR defaults (Settings) are read first so a form never opens with stale numbers.
void loadProtocolDefaults().then(() => {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
