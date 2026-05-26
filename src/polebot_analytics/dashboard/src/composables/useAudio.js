import { ref } from 'vue'

let audioCtx = null

export function useAudio() {
  const isAudioEnabled = ref(false)

  function initAudio() {
    if (audioCtx) return
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      isAudioEnabled.value = true
      console.log("Web Audio Context initialized successfully!")
    } catch (e) {
      console.error("Failed to initialize Web Audio Context:", e)
    }
  }

  function playEstopAlarm() {
    if (!audioCtx) initAudio()
    if (!audioCtx) return
    if (audioCtx.state === 'suspended') {
      audioCtx.resume()
    }
    
    // Play a dual-tone industrial horn sound for emergency stop
    const now = audioCtx.currentTime
    
    // Osc 1 (higher tone)
    const osc1 = audioCtx.createOscillator()
    const gain1 = audioCtx.createGain()
    osc1.type = 'sawtooth'
    osc1.frequency.setValueAtTime(440, now) // A4
    gain1.gain.setValueAtTime(0.08, now)
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.25)
    osc1.connect(gain1)
    gain1.connect(audioCtx.destination)
    
    // Osc 2 (dissonant low tone to sound alarms)
    const osc2 = audioCtx.createOscillator()
    const gain2 = audioCtx.createGain()
    osc2.type = 'sawtooth'
    osc2.frequency.setValueAtTime(380, now) // dissonant pitch
    gain2.gain.setValueAtTime(0.08, now)
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.25)
    osc2.connect(gain2)
    gain2.connect(audioCtx.destination)

    osc1.start(now)
    osc1.stop(now + 0.25)
    osc2.start(now)
    osc2.stop(now + 0.25)
  }

  function playProximityAlarm() {
    if (!audioCtx) initAudio()
    if (!audioCtx) return
    if (audioCtx.state === 'suspended') {
      audioCtx.resume()
    }

    // Play a futuristic warning sweep (radar chirp)
    const now = audioCtx.currentTime
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(600, now)
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.15)
    
    gain.gain.setValueAtTime(0.07, now)
    gain.gain.exponentialRampToValueAtTime(0.005, now + 0.15)
    
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    
    osc.start(now)
    osc.stop(now + 0.15)
  }

  return {
    isAudioEnabled,
    initAudio,
    playEstopAlarm,
    playProximityAlarm
  }
}
