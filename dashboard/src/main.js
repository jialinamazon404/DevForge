import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './style.css'

import PipelineList from './views/PipelineList.vue'
import PipelineDetail from './views/PipelineDetail.vue'
import Reports from './views/Reports.vue'

const routes = [
  { path: '/', name: 'home', component: PipelineList },
  { path: '/pipeline/:id', name: 'pipeline', component: PipelineDetail },
  { path: '/reports', name: 'reports', component: Reports }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
