<script setup>
import { ref, onUnmounted } from 'vue'
import { useRos } from '../composables/useRos.js'
import { useControl } from '../composables/useControl.js'
import { useAuth } from '../auth/useAuth.js'
import Teleoperation from '../components/Teleoperation.vue'

const { connected, connecting, connectRos: _connectRos, disconnectRos: _disconnectRos } = useRos()
const { addLog, stopVel } = useControl()
const { isAuthenticated, currentUser, login, logout } = useAuth()

// Form state
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const showPassword = ref(false)

const hostIp = window.location.hostname || 'localhost'
const wsUrl = ref(`ws://${hostIp}:9090`)

async function handleLogin() {
  error.value = ''
  if (!username.value || !password.value) {
    error.value = 'Please enter your credentials.'
    return
  }
  loading.value = true
  // Small delay to prevent brute-force
  await new Promise(r => setTimeout(r, 400))
  const result = login(username.value.trim(), password.value)
  loading.value = false
  if (!result.success) {
    error.value = result.error
    password.value = ''
  }
}

function handleLogout() {
  stopVel()
  if (connected.value) _disconnectRos(addLog)
  logout()
}

function connect() { _connectRos(wsUrl.value, addLog, () => {}, () => {}) }
function disconnect() { stopVel(); _disconnectRos(addLog) }

onUnmounted(() => stopVel())
</script>

<template>
  <div class="page-wrap">

    <!-- ===== LOGIN SCREEN ===== -->
    <div v-if="!isAuthenticated" class="login-bg">
      <div class="login-card">

        <!-- Logo / Titre -->
        <div class="login-header">
          <div class="login-logo" style="display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; margin: 0 auto 12px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 14px;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="color: var(--accent-blue, #3b82f6);">
              <rect x="3" y="6" width="18" height="12" rx="3" stroke="currentColor" stroke-width="2"/>
              <circle cx="7" cy="18" r="2" fill="currentColor"/>
              <circle cx="17" cy="18" r="2" fill="currentColor"/>
              <path d="M8 12H16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M12 3V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <circle cx="12" cy="3" r="1.5" fill="currentColor"/>
            </svg>
          </div>
          <h1 class="login-title">Polebot AMR</h1>
          <p class="login-subtitle">Restricted Access — Teleoperation</p>
        </div>

        <!-- Warning -->
        <div class="login-warning">
          ⚠️ This interface allows direct control of the robot.<br>
          Authorized personnel only.
        </div>

        <!-- Form -->
        <form @submit.prevent="handleLogin" class="login-form">
          <div class="field">
            <label>Username</label>
            <input
              v-model="username"
              type="text"
              placeholder="Username"
              autocomplete="username"
              :disabled="loading"
            />
          </div>

          <div class="field">
            <label>Password</label>
            <div class="pw-wrap">
              <input
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="••••••••"
                autocomplete="current-password"
                :disabled="loading"
              />
              <button type="button" class="eye-btn" @click="showPassword = !showPassword" tabindex="-1">
                {{ showPassword ? '🙈' : '👁️' }}
              </button>
            </div>
          </div>

          <div v-if="error" class="login-error">{{ error }}</div>

          <button type="submit" class="login-btn" :disabled="loading">
            <span v-if="loading">⏳ Verifying...</span>
            <span v-else>🔓 Login</span>
          </button>
        </form>

        <p class="login-footer">
          Session valid until tab is closed.<br>
          To add an account: edit <code>src/auth/users.js</code>
        </p>
      </div>
    </div>

    <!-- ===== TELEOP INTERFACE ===== -->
    <div v-else class="teleop-wrap">

      <!-- Header -->
      <header class="tp-header">
        <div class="tp-left">
          <span style="font-size:20px;">🕹️</span>
          <div>
            <div class="tp-title">Manual Teleoperation</div>
            <div class="tp-sub">Polebot AMR — Maintenance Mode</div>
          </div>
        </div>

        <div class="tp-center">
          <input
            v-model="wsUrl"
            :disabled="connected"
            placeholder="ws://localhost:9090"
            class="ws-input"
          />
          <span class="conn-badge" :class="connected ? 'ok' : 'off'">
            {{ connected ? '● ROS2 Connected' : '● ROS2 Offline' }}
          </span>
          <button v-if="!connected" @click="connect" :disabled="connecting" class="hbtn primary">
            {{ connecting ? 'Connecting...' : '▶ Connect' }}
          </button>
          <button v-else @click="disconnect" class="hbtn danger">⏹ Disconnect</button>
        </div>

        <div class="tp-right">
          <div class="user-info">
            <span class="user-icon">👤</span>
            <div>
              <div class="user-name">{{ currentUser.displayName }}</div>
              <div class="user-role">{{ currentUser.role }}</div>
            </div>
          </div>
          <button class="hbtn logout" @click="handleLogout">⬅ Logout</button>
          <a href="/" class="hbtn back">Dashboard</a>
        </div>
      </header>

      <!-- Teleop component -->
      <Teleoperation style="flex:1; overflow:hidden;" />
    </div>
  </div>
</template>

<style>
:root {
  --bg-main: #e5e7eb;
  --bg-card: #1a2540;
  --bg-secondary: #1e2d45;
  --bg-header: #151e32;
  --text-primary: #f9fafb;
  --text-muted: #6b7280;
  --border-color: #2e3a53;
  --accent-blue: #3b82f6;
  --accent-green: #10b981;
  --accent-red: #ef4444;
  --accent-yellow: #f59e0b;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, sans-serif; color: var(--text-primary); }
</style>

<style scoped>
.page-wrap { width: 100vw; height: 100vh; overflow: hidden; overscroll-behavior: none; }

/* ===== LOGIN ===== */
.login-bg {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at center, #0f1b2d 0%, #060d18 100%);
}

.login-card {
  width: 100%; max-width: 420px;
  background: rgba(26, 37, 64, 0.9);
  border: 1px solid var(--border-color);
  border-radius: 16px; padding: 36px 32px;
  box-shadow: 0 25px 60px rgba(0,0,0,0.5);
  backdrop-filter: blur(12px);
}

.login-header { text-align: center; margin-bottom: 24px; }
.login-logo { font-size: 48px; margin-bottom: 12px; }
.login-title { font-size: 24px; font-weight: 800; color: #fff; }
.login-subtitle { font-size: 13px; color: var(--text-muted); margin-top: 4px; }

.login-warning {
  background: rgba(245,158,11,0.1);
  border: 1px solid rgba(245,158,11,0.3);
  border-left: 3px solid var(--accent-yellow);
  border-radius: 8px; padding: 10px 14px;
  font-size: 12px; color: var(--accent-yellow);
  line-height: 1.5; margin-bottom: 24px; text-align: center;
}

.login-form { display: flex; flex-direction: column; gap: 16px; }

.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.6px; }

.field input, .pw-wrap input {
  width: 100%; padding: 12px 14px;
  background: rgba(255,255,255,0.05);
  border: 1px solid var(--border-color);
  border-radius: 8px; color: #fff; font-size: 14px;
  outline: none; transition: border-color 0.2s;
}
.field input:focus, .pw-wrap input:focus { border-color: var(--accent-blue); }
.field input:disabled, .pw-wrap input:disabled { opacity: 0.5; cursor: not-allowed; }

.pw-wrap { position: relative; }
.pw-wrap input { padding-right: 44px; }
.eye-btn {
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer; font-size: 16px; padding: 4px;
}

.login-error {
  background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.3);
  border-radius: 8px; padding: 10px 14px;
  font-size: 12px; color: var(--accent-red); text-align: center;
}

.login-btn {
  padding: 14px; border-radius: 10px; border: none;
  background: var(--accent-blue); color: #fff;
  font-size: 15px; font-weight: 700; cursor: pointer;
  transition: all 0.2s; margin-top: 4px;
}
.login-btn:hover:not(:disabled) { background: #2563eb; box-shadow: 0 0 20px rgba(59,130,246,0.4); }
.login-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.login-footer { margin-top: 20px; font-size: 11px; color: var(--text-muted); text-align: center; line-height: 1.6; }
.login-footer code { background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 4px; font-size: 11px; color: var(--accent-yellow); }

/* ===== TELEOP WRAP ===== */
.teleop-wrap { width: 100%; height: 100%; display: flex; flex-direction: column; background: var(--bg-main); }

.tp-header {
  min-height: 62px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 20px; gap: 16px; flex-wrap: wrap;
  background: var(--bg-header);
  border-bottom: 1px solid var(--border-color);
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
}
.tp-left { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.tp-title { font-size: 15px; font-weight: 700; color: #fff; }
.tp-sub { font-size: 11px; color: var(--text-muted); }

.tp-center { display: flex; align-items: center; gap: 8px; flex: 1; justify-content: center; flex-wrap: wrap; }
.tp-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }

.ws-input {
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--border-color); color: #fff;
  padding: 6px 10px; border-radius: 6px; font-size: 12px; width: 190px;
}

.conn-badge {
  padding: 5px 12px; border-radius: 20px;
  font-size: 11px; font-weight: 600;
}
.conn-badge.ok  { background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); }
.conn-badge.off { background: rgba(239,68,68,0.15);  color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }

.hbtn {
  padding: 6px 14px; border-radius: 8px; border: none;
  font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;
  text-decoration: none; display: inline-flex; align-items: center;
}
.hbtn.primary { background: var(--accent-blue); color: #fff; }
.hbtn.primary:hover { background: #2563eb; }
.hbtn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.hbtn.danger  { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
.hbtn.logout  { background: rgba(245,158,11,0.12); color: var(--accent-yellow); border: 1px solid rgba(245,158,11,0.3); }
.hbtn.back    { background: rgba(255,255,255,0.06); color: var(--text-muted); border: 1px solid var(--border-color); }

.user-info { display: flex; align-items: center; gap: 8px; }
.user-icon { font-size: 18px; }
.user-name { font-size: 13px; font-weight: 600; color: #fff; }
.user-role { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }

@media (max-width: 600px) {
  .login-card { padding: 24px 20px; }
  .tp-header { flex-direction: column; align-items: stretch; }
  .tp-left { justify-content: center; }
  .tp-center { justify-content: stretch; }
  .ws-input { flex: 1; }
  .tp-right { justify-content: stretch; }
  .hbtn { flex: 1; justify-content: center; }
  .user-info { display: none; }
}
</style>
