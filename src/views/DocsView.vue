<template>
  <el-container class="docs-page">
    <el-aside width="250px">
      <div class="name">
        <h2>User Guide</h2>
      </div>
      <el-menu :default-active="currentSlug" router>
        <el-sub-menu index="1">
          <template #title>Getting Started</template>
          <el-menu-item index="/docs/phlynx-introduction">Introduction</el-menu-item>
          <el-menu-item index="/docs/phlynx-tutorial">Quick Start</el-menu-item>
        </el-sub-menu>
        <el-sub-menu index="2">
          <template #title>How to Guides</template>
          <el-menu-item index="/docs/how-to-guides">Test</el-menu-item>
        </el-sub-menu>
      </el-menu>
    </el-aside>

    <el-main class="markdown-body">
      <component :is="currentPageComponent" v-if="currentPageComponent" />
      <div v-else>
        <h2>Documentation Page Not Found</h2>
        <p>Select a page from the sidebar.</p>
      </div>
    </el-main>

    <el-aside width="200px" class="toc-sidebar">
      <div class="toc-container">
        <h3 class="toc-title">On This Page</h3>
        <nav class="toc-nav">
          <ul v-if="headings.length > 0">
            <li v-for="heading in headings" :key="heading.id"
              :class="['toc-item', `toc-level-${heading.level}`, { 'active': activeHeading === heading.id }]">
              <a :href="`#${heading.id}`" @click.prevent="scrollToHeading(heading.id)">
                {{ heading.text }}
              </a>
            </li>
          </ul>
          <p v-else class="toc-empty">No headings found</p>
        </nav>
      </div>
    </el-aside>
  </el-container>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const markdownFiles = import.meta.glob('@docs/*.md', { eager: true })
const docsMap = {}

for (const path in markdownFiles) {
  const fileName = path.split('/').pop().replace('.md', '')
  docsMap[fileName] = markdownFiles[path].default
}

const currentSlug = computed(() => {
  return route.params.slug || 'phlynx-introduction'
})

const currentPageComponent = computed(() => {
  return docsMap[currentSlug.value]
})

// Table of Contents functionality
const headings = ref([])
const activeHeading = ref('')

const extractHeadings = () => {
  const mainElement = document.querySelector('.markdown-body')
  if (!mainElement) return []

  const headingElements = mainElement.querySelectorAll('h1, h2, h3, h4, h5, h6')
  const extractedHeadings = []

  headingElements.forEach((heading, index) => {
    if (!heading.id) {
      heading.id = heading.textContent
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
    }

    // Ignore the page title
    if (!(index === 0 && heading.tagName === 'H1')) {
      extractedHeadings.push({
        id: heading.id,
        text: heading.textContent,
        level: parseInt(heading.tagName.charAt(1))
      })
    }
  })

  return extractedHeadings
}

const scrollToHeading = (id) => {
  const element = document.getElementById(id)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

const updateActiveHeading = () => {
  const mainElement = document.querySelector('.el-main.markdown-body')
  if (!mainElement) return

  const headingElements = Array.from(mainElement.querySelectorAll('h1, h2, h3, h4, h5, h6'))
  const scrollPosition = mainElement.scrollTop + 100 

  for (let i = headingElements.length - 1; i >= 0; i--) {
    const heading = headingElements[i]
    if (heading.offsetTop <= scrollPosition) {
      activeHeading.value = heading.id
      return
    }
  }

  if (headingElements.length > 0) {
    activeHeading.value = headingElements[0].id
  }
}

// Setup scroll listener
let scrollElement = null

onMounted(() => {
  nextTick(() => {
    headings.value = extractHeadings()
    scrollElement = document.querySelector('.el-main.markdown-body')
    if (scrollElement) {
      scrollElement.addEventListener('scroll', updateActiveHeading)
      updateActiveHeading()
    }
  })
})

onUnmounted(() => {
  if (scrollElement) {
    scrollElement.removeEventListener('scroll', updateActiveHeading)
  }
})

watch(currentSlug, () => {
  nextTick(() => {
    headings.value = extractHeadings()
    pageTitle.value = 'On This Page' // Reset default
    if (scrollElement) {
      updateActiveHeading()
    }
  })
})
</script>

<style>
@import 'github-markdown-css/github-markdown.css';

.name {
  padding-left: 10%;
}

.markdown-body {
  padding: 40px;
  /* max-width: 1000px; */
}

.docs-page {
  height: 100%;
  overflow: hidden;
}

.left-sidebar {
  height: 100%;
  overflow-y: auto;
  border-right: 1px solid #dcdfe6;
}

.el-main.markdown-body {
  height: 100%;
  overflow-y: auto;
  padding: 40px;
  box-sizing: border-box;
}

.el-menu-item.is-active {
  background-color: #ecf5ff;
  color: #409eff;
  font-weight: 500;
}

.el-menu-item:hover {
  background-color: #ecf5ff;
}

.el-sub-menu.is-active>.el-sub-menu__title {
  color: #409eff;
}

.toc-sidebar {
  height: 100%;
  overflow-y: auto;
  border-left: 1px solid #dcdfe6;
  background-color: #fafafa;
}

.toc-container {
  padding: 20px 16px;
  position: sticky;
  top: 0;
}

.toc-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 12px 0;
  color: #333;
  padding-bottom: 8px;
  border-bottom: 1px solid #dcdfe6;
}

.toc-nav ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.toc-item {
  margin: 4px 0;
}

.toc-item a {
  display: block;
  padding: 4px 8px;
  color: #666;
  text-decoration: none;
  font-size: 13px;
  line-height: 1.4;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.toc-item a:hover {
  color: #409eff;
  background-color: #ecf5ff;
}

.toc-item.active a {
  color: #409eff;
  font-weight: 500;
  background-color: #ecf5ff;
}

.toc-level-1 {
  padding-left: 0;
}

.toc-level-2 {
  padding-left: 0;
}

.toc-level-3 {
  padding-left: 12px;
  font-size: 12px;
}

.toc-level-4 {
  padding-left: 24px;
  font-size: 12px;
}

.toc-level-5,
.toc-level-6 {
  padding-left: 36px;
  font-size: 11px;
}

.toc-empty {
  color: #999;
  font-size: 12px;
  font-style: italic;
}
</style>