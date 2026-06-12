import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json());

  // GEMINI setup
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || "",
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  app.post("/api/chat", async (req, res) => {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (message.startsWith("[NOW]")) {
        const responseText = `[MODE: OFFLINE NOW] -> Sahi hai bhai, system ready hai. (${message.substring(5).trim()})`;
        return res.json({ response: responseText });
    } else if (message.startsWith("[KEIRA]")) {
        // Online search mode
        try {
            const prompt = `Simulate an advanced online search, acting as KEIRA, a smart assistant, answering in Hinglish. Message: ${message.substring(7).trim()}`;
            
            let response: any;
            
            // Retry helper to handle transient 503 or other errors
            const callGeminiWithRetry = async (params: any, retries = 3) => {
              for (let i = 0; i < retries; i++) {
                try {
                  return await ai.models.generateContent(params);
                } catch (e: any) {
                  const isRetryable = e.status === 503 || e.status === 429;
                  if (isRetryable && i < retries - 1) {
                    await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
                    continue;
                  }
                  throw e;
                }
              }
            };

            try {
              response = await callGeminiWithRetry({
                model: "gemini-1.5-flash",
                contents: prompt,
                tools: [{ googleSearch: {} }],
              });
            } catch (toolError) {
              console.warn("Tool call failed, falling back to basic generation:", toolError);
              // Fallback
              response = await callGeminiWithRetry({
                model: "gemini-1.5-flash",
                contents: prompt,
              });
            }

            const citations = response.candidates?.[0]?.groundingMetadata?.groundingChunks
               ?.filter((chunk: any) => chunk.web?.uri)
               .map((chunk: any) => ({ title: chunk.web?.title || 'Source', url: chunk.web?.uri! }));
            
            const responseText = `[MODE: ONLINE KEIRA] -> ` + response.text;
            return res.json({ response: responseText, citations });
        } catch (e) {
            console.error("KEIRA error:", e);
            return res.json({ response: "[MODE: ONLINE KEIRA] -> Error, chat failed." });
        }
    } else {
        return res.json({ response: "Please use [NOW] or [KEIRA] to start." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
