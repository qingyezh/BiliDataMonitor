import { createRouter, createWebHashHistory } from 'vue-router'
import MonitorList from './views/MonitorList.vue'
import { monitorApi } from './api/monitor'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/Login.vue') },
    { path: '/', name: 'list', component: MonitorList },
    { path: '/detail/:type/:target', name: 'detail', component: () => import('./views/Detail.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/Settings.vue') },
    { path: '/users', name: 'users', component: () => import('./views/UserManage.vue'), meta: { requireRoot: true } },
  ],
})

router.beforeEach(async (to) => {
  if (to.path === '/login') return true
  if (!localStorage.getItem('api_key')) return '/login'
  try {
    const res = await monitorApi.checkAuth()
    if (!res.loggedIn) return '/login'
    if (to.meta.requireRoot && res.role !== 'root') return '/'
  } catch {
    return '/login'
  }
})

export default router
