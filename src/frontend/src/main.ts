import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'katex/dist/katex.min.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import App from './App.vue'
import router from './router'

const app = createApp(App)
app.use(ElementPlus, { locale: zhCn })
app.use(router)
app.mount('#app')

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
    const overlays = document.querySelectorAll('.el-overlay')
    for (let i = 0; i < overlays.length; i++) {
      if ((overlays[i] as HTMLElement).style.display !== 'none') return
    }
    window.history.back()
  }
})
