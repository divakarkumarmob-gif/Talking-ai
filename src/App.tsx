/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Send, Wifi, WifiOff, Zap, Globe, AudioLines } from 'lucide-react';

export default function App() {
  const [messages, setMessages] = useState<{ id: number, text: string, sender: 'user' | 'bot', citations?: { title: string, url: string }[] }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [battery, setBattery] = useState<number | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("❌ Earbuds Disconnected");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentlySpeakingId, setCurrentlySpeakingId] = useState<number | null>(null);

  const speak = (text: string, messageId: number) => {
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(text);
      const voices = synth.getVoices();
      // Try to find a good voice (English-Indian if possible)
      const voice = voices.find(v => v.lang.includes('en-IN')) || voices.find(v => v.lang.includes('en-US')) || voices[0];
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

  const connectEarbuds = async () => {
    if (!('bluetooth' in navigator)) {
      setConnectionMessage("❌ Web Bluetooth not supported.");
      return;
    }

    try {
      setIsScanning(true);
      
      const bluetooth = (navigator as any).bluetooth;
      let device;
      
      // Try to get already authorized devices first
      if (typeof bluetooth.getDevices === 'function') {
        try {
          const devices = await bluetooth.getDevices();
          if (devices.length > 0) {
            setConnectionMessage("🔄 Detected existing device, connecting...");
            device = devices[0]; // Connect to the first authorized device found
          }
        } catch (e) {
          console.warn("getDevices API call failed (might be unsupported or require user interaction), proceeding to requestDevice", e);
        }
      }
      
      if (!device) {
        setConnectionMessage("⏳ Scanning for QP Earbuds over BLE...");
        device = await bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ['battery_service']
        });
      }

      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService('battery_service');
      const characteristic = await service.getCharacteristic('battery_level');
      const value = await characteristic.readValue();
      const batteryLevel = value.getUint8(0);
      
      setIsConnected(true);
      setBattery(batteryLevel);
      setConnectionMessage(`🎧 QP Earbuds Connected (BLE) | Battery: ${batteryLevel}%`);
      
      device.addEventListener('gattserverdisconnected', () => {
        setIsConnected(false);
        setBattery(null);
        setConnectionMessage("❌ Earbuds Disconnected");
      });
    } catch (error: any) {
      console.error("Bluetooth connection failed:", error);
      if (error.name === 'SecurityError') {
         setConnectionMessage("⚠️ Preview restricted. Open in new tab or deploy to use Bluetooth.");
      } else {
         setConnectionMessage("❌ Connection Cancelled / Failed");
      }
      setIsConnected(false);
      setBattery(null);
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
      setMessages(prev => [...prev, { id: botId, text: data.response, sender: 'bot', citations: data.citations }]);
      if (!data.citations) speak(data.response, botId);
    } catch (e) {
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
            {!isConnected && <button onClick={connectEarbuds} disabled={isScanning} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-mono transition-colors">🔗 {isScanning ? "Scanning..." : "Connect Earbuds"}</button>}
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

