import { render } from 'preact';
import { App } from './app';
import { initTheme } from './lib/theme';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

initTheme();
render(<App />, document.getElementById('app')!);
