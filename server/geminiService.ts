import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Create Gemini client server-side only
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in environment variables.");
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface GenerationOptions {
  prompt: string;
  currentCode?: {
    html: string;
    css: string;
    js: string;
  };
  action?: "create" | "update" | "fix" | "explain";
  model?: string;
  language?: "ar" | "en";
}

const SYSTEM_PROMPT = `You are Argon CodeStudio AI, an elite full-stack web developer and UI/UX designer.
Your mission is to write clean, complete, modern, production-grade frontend code that runs directly in web browsers.

GUIDELINES:
1. Generate complete, executable code without placeholders or 'TODO' comments.
2. Structure response with three clear markdown code blocks:
   - \`\`\`html
     (HTML5 body content or full page structure)
     \`\`\`
   - \`\`\`css
     (Modern CSS, animations, glassmorphism, responsive styles)
     \`\`\`
   - \`\`\`javascript
     (Vanilla JavaScript or modern DOM manipulation, interactive features, event handlers)
     \`\`\`
   Or if generating a single comprehensive file, you can output:
   - \`\`\`html
     (Complete HTML with embedded modern <style> and <script> tags)
     \`\`\`
3. Design Quality:
   - Beautiful, modern typography (Cairo & Tajawal for Arabic, Inter for Latin).
   - Rich interactive states (hover, focus, transitions, active effects).
   - Responsive across mobile, tablet, and desktop viewports.
   - Support RTL if the request is in Arabic or for Arabic users.
   - Include mock data and realistic Arabic/English copy where appropriate.
4. You may utilize standard CDN libraries if helpful (e.g., Tailwind CSS CDN, FontAwesome / Lucide icons, Google Fonts).
5. Always return working, bug-free code that can immediately render in an iframe sandbox.`;

export async function generateWebsiteStream(
  options: GenerationOptions,
  onChunk: (chunkText: string) => void
) {
  const ai = getGeminiClient();
  const selectedModel = options.model || "gemini-3.8-flash";

  let userPrompt = options.prompt;
  if (options.action === "update" && options.currentCode) {
    userPrompt = `The user wants to update the existing website with the following instruction:
"${options.prompt}"

Here is the current code:
--- HTML ---
${options.currentCode.html}

--- CSS ---
${options.currentCode.css}

--- JavaScript ---
${options.currentCode.js}

Please provide the updated complete code. Keep existing working features and cleanly incorporate the new requested changes.`;
  } else if (options.action === "fix" && options.currentCode) {
    userPrompt = `Fix the errors or issues described:
"${options.prompt}"

Current Code:
--- HTML ---
${options.currentCode.html}
--- CSS ---
${options.currentCode.css}
--- JS ---
${options.currentCode.js}

Provide the corrected code and fix any syntax or logical bugs.`;
  }

  const streamResponse = await ai.models.generateContentStream({
    model: selectedModel,
    contents: userPrompt,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.7,
    },
  });

  let fullText = "";
  for await (const chunk of streamResponse) {
    const text = chunk.text || "";
    if (text) {
      fullText += text;
      onChunk(text);
    }
  }

  return fullText;
}

export async function generateWebsite(options: GenerationOptions): Promise<string> {
  const ai = getGeminiClient();
  const selectedModel = options.model || "gemini-3.8-flash";

  let userPrompt = options.prompt;
  if (options.action === "update" && options.currentCode) {
    userPrompt = `Update existing website:
Instruction: "${options.prompt}"

Current HTML:
${options.currentCode.html}

Current CSS:
${options.currentCode.css}

Current JS:
${options.currentCode.js}

Provide the complete updated code.`;
  }

  const response = await ai.models.generateContent({
    model: selectedModel,
    contents: userPrompt,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.7,
    },
  });

  return response.text || "";
}
