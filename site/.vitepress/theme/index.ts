import DefaultTheme from 'vitepress/theme';

import AgentsHome from './components/AgentsHome.vue';
import MermaidDiagram from './components/MermaidDiagram.vue';
import './styles.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('AgentsHome', AgentsHome);
    app.component('MermaidDiagram', MermaidDiagram);
  },
};
