<template>
  <g>
    <path
      :d="pathData[0]"
      fill="none"
      :stroke="SUGGESTED_COLOUR"
      stroke-width="2"
      stroke-dasharray="6 4"
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
        <span class="suggested-edge-label">Suggested connection</span>
        <div class="suggested-edge-actions">
          <el-tooltip content="Accept connection" placement="top" :show-after="400">
            <button class="action-btn accept-btn" @click.stop="handleAccept">
              <el-icon><Check /></el-icon>
            </button>
          </el-tooltip>
          <el-tooltip content="Dismiss suggestion" placement="top" :show-after="400">
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

const SUGGESTED_COLOUR = 'var(--el-color-warning)'
const BADGE_WIDTH  = 180
const BADGE_HEIGHT = 48

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
.suggested-edge-path {
  pointer-events: none;
}

.suggested-edge-foreign {
  overflow: visible;
}

.suggested-edge-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: var(--el-bg-color);
  border: 1.5px dashed v-bind(SUGGESTED_COLOUR);
  border-radius: var(--el-border-radius-base);
  padding: 4px 8px;
  font-size: var(--el-font-size-extra-small);
  box-shadow: var(--el-box-shadow-light);
  width: 100%;
  box-sizing: border-box;
  pointer-events: all;
}

.suggested-edge-label {
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.suggested-edge-actions {
  display: flex;
  gap: 6px;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid currentColor;
  background: var(--el-bg-color);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  padding: 0;
}

.accept-btn {
  color: var(--el-color-success);
}

.accept-btn:hover {
  background: var(--el-color-success);
  color: #fff;
}

.dismiss-btn {
  color: var(--el-color-danger);
}

.dismiss-btn:hover {
  background: var(--el-color-danger);
  color: #fff;
}
</style>