// Placeholder page for Layer 1. The UI arrives in later layers.
const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.innerHTML = `
    <h1>Combo Timing Trainer</h1>
    <p>Layer 1: timing engine only. Run <code>npm test</code> to check the engine.</p>
  `;
}
