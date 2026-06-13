/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { Send, Wifi, WifiOff, Zap, Globe, AudioLines } from 'lucide-react';

export default function App() {
  const [messages, setMessages] = useState<{ id: number, text: string, sender: 'user' | 'bot', citations?: { title: string, url: string }[] }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [battery, setBattery] = useState<number | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("❌ Offline");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentlySpeakingId, setCurrentlySpeakingId] = useState<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'active' | 'offline'>('idle');
  
  const wsRef = useRef<WebSocket | null>(null);
  const deviceRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const aiStreamingRef = useRef(false);
  const aiStreamingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastAudioTimeRef = useRef(Date.now());
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startAudioStreaming = (socket: WebSocket) => {
    navigator.mediaDevices.getUserMedia({ 
      audio: { 
        echoCancellation: true, 
        noiseSuppression: true, 
        autoGainControl: true 
      } 
    }).then(stream => {
        const inputCtx = new AudioContext({ sampleRate: 24000 });
        const source = inputCtx.createMediaStreamSource(stream);
        
        // Low-pass filter to reduce high-frequency noise
        const lowPass = inputCtx.createBiquadFilter();
        lowPass.type = 'lowpass';
        lowPass.frequency.value = 5000; 
        lowPass.Q.value = 1;

        // High-pass filter to remove low-frequency rumble
        const highPass = inputCtx.createBiquadFilter();
        highPass.type = 'highpass';
        highPass.frequency.value = 200; 
        
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        
        source.connect(highPass);
        highPass.connect(lowPass);
        lowPass.connect(processor);
        processor.connect(inputCtx.destination);
        
        processor.onaudioprocess = (e) => {
            // Mute mic if AI is streaming to prevent feedback loop
            if (aiStreamingRef.current) return;
            
            const float32 = e.inputBuffer.getChannelData(0);

            // Noise Gate Logic - Simplified for performance
            const threshold = 0.02; 
            
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
                // Apply gate and simple normalization
                const sample = Math.abs(float32[i]) < threshold ? 0 : float32[i];
                int16[i] = Math.max(-1, Math.min(1, sample)) * 32767;
            }
            // Safe Base64 conversion without spread operator
            const uint8Array = new Uint8Array(int16.buffer);
            let binary = '';
            for (let i = 0; i < uint8Array.length; i++) {
                binary += String.fromCharCode(uint8Array[i]);
            }
            const base64 = btoa(binary);

            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ audio: base64 }));
            }
        };
    }).catch(err => {
      console.error("Microphone access denied:", err);
      setConnectionMessage("❌ Mic Access Denied");
    });
  };

  const disconnectSession = () => {
      if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
      }
      setStatus('idle');
      setConnectionMessage("❌ Offline");
  };

  const connectSession = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}`);
    
    socket.onopen = () => {                
        console.log('Connected to Audio WS');
        setConnectionMessage("🎧 Keira Live Connected");
        setStatus('active');
        lastAudioTimeRef.current = Date.now();
        startAudioStreaming(socket);
    };
    
    socket.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        if (msg.audio) {
            lastAudioTimeRef.current = Date.now();
            window.speechSynthesis.cancel();
            setIsSpeaking(false);
            setCurrentlySpeakingId(null);

            aiStreamingRef.current = true;
            if (aiStreamingTimeoutRef.current) clearTimeout(aiStreamingTimeoutRef.current);
            aiStreamingTimeoutRef.current = setTimeout(() => aiStreamingRef.current = false, 500);

            const audioData = Uint8Array.from(atob(msg.audio), c => c.charCodeAt(0));
            if (!audioCtxRef.current) {
                audioCtxRef.current = new AudioContext({ sampleRate: 24000 });
                await audioCtxRef.current.audioWorklet.addModule('/audio-processor.js');
                workletNodeRef.current = new AudioWorkletNode(audioCtxRef.current, 'audio-processor');
                workletNodeRef.current.connect(audioCtxRef.current.destination);
            }
            if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
            
            const float32Data = new Float32Array(audioData.length / 2);
            const view = new DataView(audioData.buffer);
            for (let i = 0; i < audioData.length / 2; i++) {
                float32Data[i] = view.getInt16(i * 2, true) / 32768;
            }
            
            if (workletNodeRef.current) {
                workletNodeRef.current.port.postMessage(float32Data);
            }
        } else if (msg.transcript) {
            const transcript = msg.transcript.toLowerCase();
            if (["chup ho jao", "abb tum chup ho jao", "band ho jao"].some(phrase => transcript.includes(phrase))) {
                disconnectSession();
            }
        }
    };
    
    wsRef.current = socket;
  };

  useEffect(() => {
    if (status === 'active') {
        silenceTimeoutRef.current = setInterval(() => {
            if (Date.now() - lastAudioTimeRef.current > 120000) {
                disconnectSession();
            }
        }, 5000);
    } else {
        if (silenceTimeoutRef.current) clearInterval(silenceTimeoutRef.current);
    }
    return () => {
        if (silenceTimeoutRef.current) clearInterval(silenceTimeoutRef.current);
    };
  }, [status]);



  useEffect(() => {
    connectSession();
  }, []);

  useEffect(() => {
    const autoConnect = async () => {
      const bluetooth = (navigator as any).bluetooth;
      if (bluetooth && typeof bluetooth.getDevices === 'function') {
        try {
          const devices = await bluetooth.getDevices();
          if (devices.length > 0) {
            connectEarbuds(devices[0]);
          }
        } catch (e) {
          console.warn("Auto-connect failed", e);
        }
      }
    };
    autoConnect();
  }, []);

  const disconnectEarbuds = () => {
      if (deviceRef.current && deviceRef.current.gatt.connected) {
        deviceRef.current.gatt.disconnect();
      }
      deviceRef.current = null;
      setIsConnected(false);
      setBattery(null);
      setConnectionMessage("❌ Earbuds Disconnected");
  };

  const speak = (text: string, messageId: number) => {
      const synth = window.speechSynthesis;
      synth.cancel(); // Stop any currently speaking text
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.pitch = 1.2; // Increase pitch for sweetness
      utterance.rate = 1.2; // Make it conversational

      const voices = synth.getVoices();
      
      // Prioritize clear English voice. Filter out all non-English voices.
      const englishVoices = voices.filter(v => v.lang.startsWith('en-'));
      // Prefer US or GB if available, otherwise any English voice, otherwise first voice.
      const voice = englishVoices.find(v => v.lang === 'en-US') || 
                    englishVoices.find(v => v.lang === 'en-GB') || 
                    englishVoices[0] || 
                    voices[0];
      utterance.voice = voice;
      
      utterance.onstart = () => {
          setIsSpeaking(true);
          setCurrentlySpeakingId(messageId);
      };
      
      utterance.onend = () => {
          setIsSpeaking(false);
          setCurrentlySpeakingId(null);
      };
      
      synth.speak(utterance);
  }

  const connectEarbuds = async (existingDevice?: any) => {
    if (!('bluetooth' in navigator)) {
      setConnectionMessage("❌ Web Bluetooth not supported.");
      return;
    }

    try {
      setIsScanning(true);
      
      const bluetooth = (navigator as any).bluetooth;
      let device = existingDevice;
      
      if (!device && typeof bluetooth.getDevices === 'function') {
        try {
          const devices = await bluetooth.getDevices();
          if (devices.length > 0) {
            setConnectionMessage("🔄 Detected existing device, connecting...");
            device = devices[0];
          }
        } catch (e) {
          console.warn("getDevices API call failed (might be unsupported or require user interaction), proceeding to requestDevice", e);
        }
      }
      
      if (!device) {
        setConnectionMessage("⏳ Scanning for Bluetooth devices...");
        device = await bluetooth.requestDevice({
          acceptAllDevices: true
        });
      }

      deviceRef.current = device;
      
      // If GATT is available, attempt to connect
      if (device.gatt) {
        const server = await device.gatt.connect();
        
        try {
          const service = await server.getPrimaryService('battery_service');
          const characteristic = await service.getCharacteristic('battery_level');
          const value = await characteristic.readValue();
          const batteryLevel = value.getUint8(0);
          setBattery(batteryLevel);
          setConnectionMessage(`🎧 Connected | Battery: ${batteryLevel}%`);
        } catch (e) {
          console.warn("Battery service not supported on this device, sticking to connected state.", e);
          setBattery(null);
          setConnectionMessage("🎧 Bluetooth Device Connected");
        }
      } else {
        // Fallback for non-GATT connected devices
        setConnectionMessage("🎧 Bluetooth Device Selected");
      }
      
      setIsConnected(true);
      
      if (device.gatt) {
        device.addEventListener('gattserverdisconnected', () => {
          setIsConnected(false);
          setBattery(null);
          setConnectionMessage("❌ Device Disconnected");
          deviceRef.current = null;
        });
      }
    } catch (error: any) {
      console.error("Bluetooth connection failed:", error);
      if (error.name === 'SecurityError') {
         setConnectionMessage("⚠️ Preview restricted. Open in new tab or deploy to use Bluetooth.");
      } else {
         setConnectionMessage("❌ Connection Cancelled / Failed");
      }
      setIsConnected(false);
      setBattery(null);
      deviceRef.current = null;
    } finally {
      setIsScanning(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    
    const userMessage = input;
    setMessages(prev => [...prev, { id: Date.now(), text: userMessage, sender: 'user' }]);
    setInput('');
    setLoading(true);

    if (userMessage.startsWith("[KEIRA]")) {
        const steps = ["🔍 Vectorizing Search Query...", "🌐 Grounding with Live Google Search Sources...", "🎯 Merging & Filtering Facts (Perplexity Mode)..."];
        for (const step of steps) {
            setMessages(prev => [...prev, { id: Date.now() + Math.random(), text: step, sender: 'bot' }]);
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      });
      
      const data = await response.json();
      const botId = Date.now() + 1;
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to get AI response");
      }
      
      setMessages(prev => [...prev, { id: botId, text: data.response, sender: 'bot', citations: data.citations }]);
      if (!data.citations) speak(data.response, botId);
    } catch (e) {
      console.error("Chat error:", e);
      const botId = Date.now() + 1;
      if (userMessage.startsWith("[KEIRA]")) {
           const botText = "[MODE: ONLINE KEIRA (SIMULATED)] -> Mumbai mein mausam suhana hai! Halka nasha aur chai ki chuski.";
           setMessages(prev => [...prev, {
               id: botId,
               text: botText,
               sender: 'bot',
               citations: [
                   { title: "Weather.com: Mumbai Forecast", url: "https://weather.com" },
                   { title: "Local Trends: Tea and Rain", url: "https://chai.com" }
               ]
           }]);
           // Citations exist, so we don't speak
      } else {
           setMessages(prev => [...prev, { id: botId, text: "Error: Could not connect to assistant.", sender: 'bot' }]);
           speak("Error: Could not connect to assistant.", botId);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen text-slate-200 font-sans p-8 overflow-hidden" style={{ background: 'radial-gradient(circle at top left, #1a2333 0%, #0a0c10 100%)' }}>
      <header className="flex justify-between items-center mb-8 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
        <div className="flex flex-col gap-1">
            <h1 className="text-xl font-bold tracking-tight text-white uppercase">KEIRA/NOW Assistant</h1>
            <div className={`text-xs font-mono ${isConnected ? 'text-green-500' : 'text-amber-500'}`}>
                {connectionMessage}
            </div>
        </div>
        <div className="flex gap-4">
            <button onClick={isConnected ? disconnectEarbuds : () => connectEarbuds()} disabled={isScanning} className={`${isConnected ? 'bg-green-600/80 hover:bg-green-600' : 'bg-indigo-600 hover:bg-indigo-500'} text-white px-4 py-2 rounded-xl text-xs font-mono transition-colors`}>
                {isConnected ? "🔋 Earbuds Active (Click to Disconnect)" : (isScanning ? "Scanning..." : "🔗 Connect Earbuds")}
            </button>
            <span className="flex items-center gap-2 text-xs text-slate-400 font-mono"><Wifi size={14} /> ONLINE KEIRA</span>
            <span className="flex items-center gap-2 text-xs text-slate-400 font-mono"><WifiOff size={14} /> OFFLINE NOW</span>
        </div>
      </header>

      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 flex flex-col h-[calc(100vh-220px)] shadow-2xl mb-4 overflow-hidden">
        <div className="flex-grow overflow-y-auto space-y-4 pr-2">
          {messages.map(m => (
            <div key={m.id} className={`p-4 rounded-xl backdrop-blur-sm ${m.sender === 'user' ? 'bg-indigo-500/20 ml-auto w-fit text-sm border border-indigo-500/30' : 'bg-white/5 w-fit text-sm border border-white/5'}`}>
              <div className="mb-2">{m.text}</div>
              {m.citations && (
                  <div className="pt-2 mt-2 border-t border-white/10 text-xs">
                      <div className="font-bold mb-1 text-slate-400">Sources:</div>
                      {m.citations.map((c, i) => (
                          <a key={i} href={c.url} target="_blank" className="block text-indigo-400 hover:underline overflow-hidden text-ellipsis whitespace-nowrap">
                              {c.title}
                          </a>
                      ))}
                  </div>
              )}
              {m.sender === 'bot' && !m.citations && (
                  <div className="pt-2 border-t border-white/10 flex items-center gap-2 text-slate-500 text-[10px] font-mono">
                      <div className="flex items-end gap-[2px] h-3">
                           <div className={`w-[2px] h-full bg-slate-500 ${currentlySpeakingId === m.id ? 'animate-wave' : ''} delay-75`}></div>
                           <div className={`w-[2px] h-full bg-slate-500 ${currentlySpeakingId === m.id ? 'animate-wave' : ''} delay-150`}></div>
                           <div className={`w-[2px] h-full bg-slate-500 ${currentlySpeakingId === m.id ? 'animate-wave' : ''} delay-300`}></div>
                      </div>
                      TTS -{'>'} QP Earbuds
                  </div>
              )}
            </div>
          ))}
          {loading && <div className="text-slate-500 font-mono text-sm px-4">Thinking...</div>}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button onClick={() => setInput('[NOW] ')} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 p-2 px-4 rounded-xl text-xs font-mono text-slate-300 transition-colors">
            <Zap size={14} className="text-yellow-500" /> NOW Mode
          </button>
          <button onClick={() => setInput('[KEIRA] ')} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 p-2 px-4 rounded-xl text-xs font-mono text-slate-300 transition-colors">
            <Globe size={14} className="text-purple-500" /> KEIRA Mode
          </button>
        </div>
        <div className="flex gap-2 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-2 items-center">
          <input 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isConnected ? "[NOW] ... or [KEIRA] ..." : "Please connect your QP Earbuds (or type to test)..."}
            className="flex-grow p-3 bg-transparent outline-none text-sm placeholder:text-slate-600"
          />
          <button onClick={sendMessage} disabled={loading} className="p-3 bg-indigo-600/80 hover:bg-indigo-600 disabled:bg-slate-700 disabled:opacity-50 rounded-xl transition-colors"><Send size={18} /></button>
        </div>
      </div>
    </div>
  );
}

