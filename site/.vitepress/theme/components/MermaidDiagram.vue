<script lang="ts">
let diagramIdCounter = 0;
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useData } from 'vitepress';

const props = defineProps<{
  code: string;
}>();

const { isDark } = useData();
const diagramRoot = ref<HTMLElement | null>(null);
const renderError = ref<string | null>(null);
const decodedCode = computed(() => decodeMermaidCode(props.code));

let renderVersion = 0;

async function renderDiagram() {
  const root = diagramRoot.value;

  if (!root) {
    return;
  }

  const currentVersion = ++renderVersion;
  renderError.value = null;
  root.innerHTML = '';

  try {
    const mermaid = (await import('mermaid')).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isDark.value ? 'dark' : 'default',
      fontFamily:
        '"Source Han Sans SC", "Source Han Sans", "Noto Sans CJK SC", Inter, ui-sans-serif, system-ui, sans-serif',
    });

    const diagramId = `agents-mermaid-${++diagramIdCounter}-${currentVersion}`;
    const { svg, bindFunctions } = await mermaid.render(diagramId, decodedCode.value);

    if (currentVersion !== renderVersion) {
      return;
    }

    root.innerHTML = svg;
    bindFunctions?.(root);
  } catch (error) {
    root.innerHTML = '';
    renderError.value = error instanceof Error ? error.message : String(error);
  }
}

function decodeMermaidCode(code: string) {
  try {
    return decodeURIComponent(code);
  } catch {
    return code;
  }
}

onMounted(renderDiagram);

watch([decodedCode, isDark], () => {
  void nextTick(renderDiagram);
});
</script>

<template>
  <figure class="mermaid-diagram" :class="{ 'mermaid-diagram--error': renderError }">
    <div ref="diagramRoot" class="mermaid-diagram__viewport" aria-label="Mermaid diagram"></div>
    <figcaption v-if="renderError" class="mermaid-diagram__error">
      Mermaid render failed: {{ renderError }}
    </figcaption>
    <pre v-if="renderError" class="mermaid-diagram__source"><code>{{ decodedCode }}</code></pre>
  </figure>
</template>
