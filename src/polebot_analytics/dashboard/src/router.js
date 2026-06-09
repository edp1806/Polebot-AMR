import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import TeleoperationPage from './pages/TeleoperationPage.vue'

const routes = [
  {
    path: '/',
    component: App,
    meta: { title: 'Polebot AMR — Dashboard' }
  },
  {
    path: '/teleop',
    component: TeleoperationPage,
    meta: { title: 'Teleoperation — Polebot AMR' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.afterEach((to) => {
  document.title = to.meta.title || 'Polebot AMR'
})

export default router
