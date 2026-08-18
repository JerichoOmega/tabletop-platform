import PlatformShell from '@/platform/PlatformShell';

// App is the PLATFORM entry point (M5): App → PlatformShell → platform
// destination → Experience. App owns no game-specific navigation; the RPG is
// mounted through the Experience registry like any future Experience.
function App() {
  return <PlatformShell />;
}

export default App;
