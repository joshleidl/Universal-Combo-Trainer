import './style.css';
import { renderDebugPage } from './ui/debug';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) renderDebugPage(app);
