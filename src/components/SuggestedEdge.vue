<template>
  <g>
    <path
      :d="pathData[0]"
      fill="none"
      :stroke="SUGGESTED_COLOUR"
      stroke-width="6"
      stroke-linecap="round"
      opacity="0.15"
      class="suggested-edge-glow"
    />

    <path
      :d="pathData[0]"
      fill="none"
      :stroke="SUGGESTED_COLOUR"
      stroke-width="1.5"
      stroke-dasharray="8 5"
      stroke-linecap="round"
      class="suggested-edge-path"
    />

    <foreignObject
      :x="pathData[1] - BADGE_WIDTH / 2"
      :y="pathData[2] - BADGE_HEIGHT / 2"
      :width="BADGE_WIDTH"
      :height="BADGE_HEIGHT"
      class="suggested-edge-foreign"
    >
      <div class="suggested-edge-badge">
        <span class="suggested-edge-label">Suggested</span>
        <div class="suggested-edge-actions">
          <el-tooltip content="Accept" placement="top" :show-after="400">
            <button class="action-btn accept-btn" @click.stop="handleAccept">
              <el-icon><Check /></el-icon>
            </button>
          </el-tooltip>
          <el-tooltip content="Dismiss" placement="top" :show-after="400">
            <button class="action-btn dismiss-btn" @click.stop="handleDismiss">
              <el-icon><Close /></el-icon>
            </button>
          </el-tooltip>
        </div>
      </div>
    </foreignObject>
  </g>
</template>

<script setup>
import { computed } from 'vue'
import { getBezierPath } from '@vue-flow/core'
import { Check, Close } from '@element-plus/icons-vue'
import { useAutoCoupling } from '../composables/useAutoCouplings'
import { useFlowHistoryStore } from '../stores/historyStore'

const SUGGESTED_COLOUR = 'var(--el-color-info)'
const BADGE_WIDTH  = 120
const BADGE_HEIGHT = 40

const props = defineProps({
  id:             { type: String,  required: true },
  source:         { type: String,  required: true },
  target:         { type: String,  required: true },
  sourceX:        { type: Number,  required: true },
  sourceY:        { type: Number,  required: true },
  targetX:        { type: Number,  required: true },
  targetY:        { type: Number,  required: true },
  sourcePosition: { type: String,  required: true },
  targetPosition: { type: String,  required: true },
  data:           { type: Object,  default: () => ({}) },
  markerEnd:      { type: String,  default: undefined },
})

const { acceptSuggestion, dismissSuggestion } = useAutoCoupling()
const historyStore = useFlowHistoryStore()

const pathData = computed(() =>
  getBezierPath({
    sourceX:        props.sourceX,
    sourceY:        props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX:        props.targetX,
    targetY:        props.targetY,
    targetPosition: props.targetPosition,
  })
)

// Build edge snapshot from props directly — no need for useEdge()
function getEdgeSnapshot() {
  return {
    id:     props.id,
    source: props.source,
    target: props.target,
    data:   props.data,
  }
}

function handleAccept() {
  const edge = getEdgeSnapshot()
  historyStore.executeAndAddCommand({
    type: 'accept-suggested-edge',
    redo: () => acceptSuggestion(edge),
    undo: () => dismissSuggestion(edge),
  })
}

function handleDismiss() {
  const edge = getEdgeSnapshot()
  historyStore.executeAndAddCommand({
    type: 'dismiss-suggested-edge',
    redo: () => dismissSuggestion(edge),
    undo: () => acceptSuggestion(edge),
  })
}
</script>

<style scoped>
.suggested-edge-glow {
  pointer-events: none;
}

.suggested-edge-path {
  pointer-events: none;
  animation: dash-march 1.2s linear infinite;
}

@keyframes dash-march {
  to { stroke-dashoffset: -26; }  /* 8 + 5 + 8 + 5 = one full cycle */
}

.suggested-edge-foreign {
  overflow: visible;
}

.suggested-edge-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--el-bg-color);
  border: 1.5px solid v-bind(SUGGESTED_COLOUR);
  border-radius: 20px;           /* pill shape */
  padding: 4px 8px 4px 10px;
  font-size: var(--el-font-size-extra-small);
  box-shadow: 0 2px 8px rgba(139, 92, 246, 0.2);
  width: fit-content;
  pointer-events: all;
  white-space: nowrap;
}

.suggested-edge-label {
  color: v-bind(SUGGESTED_COLOUR);
  font-weight: 500;
  letter-spacing: 0.01em;
}

.suggested-edge-actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, transform 0.1s;
  padding: 0;
}

.action-btn:hover {
  transform: scale(1.15);
}

.accept-btn {
  color: var(--el-color-success);
}

.accept-btn:hover {
  background: var(--el-color-success);
  color: #fff;
}

.dismiss-btn {
  color: var(--el-text-color-placeholder);
}

.dismiss-btn:hover {
  background: var(--el-fill-color-dark);
  color: var(--el-text-color-primary);
}
</style>