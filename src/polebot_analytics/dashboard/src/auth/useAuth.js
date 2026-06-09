import { ref } from 'vue'
import { authenticate } from './users.js'

const SESSION_KEY = 'polebot_teleop_session'

// Global session state
const currentUser = ref(JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'))
const isAuthenticated = ref(currentUser.value !== null)

export function useAuth() {

  function login(username, password) {
    const user = authenticate(username, password)
    if (user) {
      const session = {
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        loginTime: new Date().toISOString()
      }
      currentUser.value = session
      isAuthenticated.value = true
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
      return { success: true, user: session }
    }
    return { success: false, error: 'Incorrect username or password.' }
  }

  function logout() {
    currentUser.value = null
    isAuthenticated.value = false
    sessionStorage.removeItem(SESSION_KEY)
  }

  return {
    currentUser,
    isAuthenticated,
    login,
    logout
  }
}
