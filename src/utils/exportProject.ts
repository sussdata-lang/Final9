import JSZip from "jszip";
import { WebProject } from "../types";
import { buildCompleteHtml } from "./codeParser";

export function downloadStandaloneHtml(project: WebProject, filename = "index.html") {
  const fullHtml = buildCompleteHtml(project);
  const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadProjectZip(project: WebProject, zipName = "argon-website-project.zip") {
  const zip = new JSZip();

  // Create clean index.html linking to external styles.css and script.js
  const indexHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${project.title || "موقعي الإحترافي"}</title>
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <!-- FontAwesome Icons -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <link rel="stylesheet" href="styles.css">
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen antialiased">
  ${project.html}
  <script src="script.js"></script>
</body>
</html>`;

  zip.file("index.html", indexHtml);
  zip.file("styles.css", project.css || "/* تنسيقات CSS الإضافية */\n");
  zip.file("script.js", project.js || "// أكواد JavaScript التفاعلية\n");

  // Add README.md
  zip.file(
    "README.md",
    `# ${project.title || "مشروع موقع ويب"}
تم تطويره وتكويده عبر استوديو **Argon CodeStudio**.

## كيفية التشغيل:
1. قم بفك ضغط الملف.
2. افتح ملف \`index.html\` مباشرة في أي متصفح ويب، أو ارفعه على GitHub Pages أو Netlify أو Vercel.
`
  );

  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
