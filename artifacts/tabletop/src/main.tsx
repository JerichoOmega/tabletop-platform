import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { registerCanonicalAssets } from '@/assets/visualAssets';
import { registerBuiltInExperiences } from '@/platform/experiences/registerBuiltIn';

import './index.css';

// Register all 44 canonical visual assets before React renders.
// The rules engine never calls this — it is UI-layer bootstrap only.
registerCanonicalAssets();

// Register built-in platform Experiences (RPG is the first) before the shell
// renders. The shell discovers Experiences only through the registry.
registerBuiltInExperiences();

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
