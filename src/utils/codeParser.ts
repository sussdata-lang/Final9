import { WebProject } from "../types";

export function parseGeneratedCode(rawText: string, current: WebProject): WebProject {
  const result: WebProject = {
    html: current.html,
    css: current.css,
    js: current.js,
    title: current.title || "موقعي الجديد",
  };

  // 1. Try extracting ```html ... ```, ```css ... ```, ```javascript ... ```
  const htmlMatch = rawText.match(/```(?:html|xml)\s*([\s\S]*?)```/i);
  const cssMatch = rawText.match(/```(?:css)\s*([\s\S]*?)```/i);
  const jsMatch = rawText.match(/```(?:javascript|js)\s*([\s\S]*?)```/i);

  if (htmlMatch) {
    let parsedHtml = htmlMatch[1].trim();

    // If the HTML has embedded style or script tags, extract or preserve them
    const embeddedStyleMatch = parsedHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    const embeddedScriptMatch = parsedHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/i);

    if (embeddedStyleMatch && !cssMatch) {
      result.css = embeddedStyleMatch[1].trim();
      parsedHtml = parsedHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/i, "").trim();
    }

    if (embeddedScriptMatch && !jsMatch) {
      result.js = embeddedScriptMatch[1].trim();
      parsedHtml = parsedHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/i, "").trim();
    }

    result.html = parsedHtml;
  }

  if (cssMatch) {
    result.css = cssMatch[1].trim();
  }

  if (jsMatch) {
    result.js = jsMatch[1].trim();
  }

  // Fallback: If no code blocks matched but rawText starts with <!DOCTYPE or <html
  if (!htmlMatch && !cssMatch && !jsMatch) {
    if (rawText.includes("<html") || rawText.includes("<!DOCTYPE") || rawText.includes("<div") || rawText.includes("<section")) {
      let content = rawText.trim();
      const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
      const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);

      if (styleMatch) {
        result.css = styleMatch[1].trim();
        content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/i, "").trim();
      }
      if (scriptMatch) {
        result.js = scriptMatch[1].trim();
        content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/i, "").trim();
      }
      result.html = content;
    }
  }

  return result;
}

export function buildCompleteHtml(project: WebProject): string {
  // Check if HTML already contains <html> and <head>
  const hasFullHtmlDoc = /<html[^>]*>/i.test(project.html);

  // Script to intercept console logs and send to parent window
  const consoleCatcherScript = `
    <script>
      (function() {
        const _log = console.log;
        const _warn = console.warn;
        const _error = console.error;
        const _info = console.info;

        function sendMessage(type, args) {
          try {
            const message = Array.from(args).map(arg => {
              if (typeof arg === 'object') {
                try { return JSON.stringify(arg); } catch(e) { return String(arg); }
              }
              return String(arg);
            }).join(' ');

            window.parent.postMessage({
              source: 'argon-preview-console',
              type: type,
              message: message,
              timestamp: new Date().toLocaleTimeString('ar-EG')
            }, '*');
          } catch(e) {}
        }

        console.log = function(...args) {
          _log.apply(console, args);
          sendMessage('log', args);
        };
        console.warn = function(...args) {
          _warn.apply(console, args);
          sendMessage('warn', args);
        };
        console.error = function(...args) {
          _error.apply(console, args);
          sendMessage('error', args);
        };
        console.info = function(...args) {
          _info.apply(console, args);
          sendMessage('info', args);
        };

        window.onerror = function(msg, url, lineNo, columnNo, error) {
          sendMessage('error', ['خطأ برمجي (سطر ' + lineNo + '): ' + msg]);
          return false;
        };
      })();
    </script>
  `;

  if (hasFullHtmlDoc) {
    let doc = project.html;
    // Inject custom CSS
    if (project.css.trim()) {
      const styleTag = `<style>\n${project.css}\n</style>`;
      if (doc.includes("</head>")) {
        doc = doc.replace("</head>", `${styleTag}\n</head>`);
      } else {
        doc = `${styleTag}\n${doc}`;
      }
    }
    // Inject console script & custom JS
    const scriptTag = `${consoleCatcherScript}\n<script>\ntry {\n${project.js}\n} catch(err) { console.error('JavaScript Error: ' + err.message); }\n</script>`;
    if (doc.includes("</body>")) {
      doc = doc.replace("</body>", `${scriptTag}\n</body>`);
    } else {
      doc = `${doc}\n${scriptTag}`;
    }
    return doc;
  }

  // Construct standardized HTML5 shell with Tailwind CDN, Google Fonts, and Lucide icons
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${project.title || "معاينة الموقع"}</title>
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            primary: {
              50: '#f0fdfa',
              100: '#ccfbf1',
              500: '#14b8a6',
              600: '#0d9488',
              700: '#0f766e',
            }
          }
        }
      }
    }
  </script>
  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800;900&family=JetBrains+Mono&display=swap" rel="stylesheet">
  <!-- FontAwesome Icons -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  ${consoleCatcherScript}
  <style>
    * {
      font-family: 'Cairo', system-ui, -apple-system, sans-serif;
    }
    ${project.css}
  </style>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen antialiased">
  ${project.html}

  <script>
    try {
      ${project.js}
    } catch(err) {
      console.error('حدث خطأ في تنفيذ JavaScript: ' + err.message);
    }
  </script>
</body>
</html>`;
}
