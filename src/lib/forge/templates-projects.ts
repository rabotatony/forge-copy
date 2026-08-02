// ============================================================
// Forge — project templates (quick-start)
// ============================================================
// Instead of uploading, users can create a project from a template.
// Templates generate the starter files automatically.
// ============================================================

export interface ProjectTemplate {
  id: string;
  name: string;
  emoji: string;
  description: string;
  kind: 'node' | 'python' | 'go' | 'rust' | 'unknown';
  // Files to create (path → content).
  files: Record<string, string>;
  dev?: boolean;
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'html-app',
    name: 'HTML App',
    emoji: '🌐',
    description: 'Single-page HTML app — build into an APK or static site',
    kind: 'unknown',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>My App</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; background: #10b981; color: white; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { text-align: center; padding: 40px; }
    h1 { font-size: 2em; margin-bottom: 10px; }
    button { background: rgba(255,255,255,0.2); border: none; color: white; padding: 12px 24px; border-radius: 8px; font-size: 1em; margin-top: 20px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🚀 My App</h1>
    <p>Built with Forge</p>
    <button onclick="alert('Hello!')">Click me</button>
  </div>
</body>
</html>`,
    },
  },
  {
    id: 'nextjs-app',
    name: 'Next.js App',
    emoji: '⚛️',
    description: 'Next.js starter with TypeScript',
    kind: 'node',
    files: {
      'package.json': `{
  "name": "my-next-app",
  "version": "1.0.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "echo 'add tests'"
  },
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  }
}`,
      'next.config.js': `/** @type {import('next').NextConfig} */
module.exports = { reactStrictMode: true };`,
      'pages/index.js': `export default function Home() {
  return <div><h1>Hello from Forge!</h1></div>;
}`,
    },
  },
  {
    id: 'python-app',
    name: 'Python App',
    emoji: '🐍',
    description: 'Python starter with tests',
    kind: 'python',
    files: {
      'requirements.txt': `requests==2.31.0\npytest==7.4.0`,
      'main.py': `def greet(name):
    return f"Hello, {name}!"

if __name__ == "__main__":
    print(greet("Forge"))`,
      'test_main.py': `from main import greet

def test_greet():
    assert greet("World") == "Hello, World!"
    assert greet("Forge") == "Hello, Forge!"`,
    },
  },
  {
    id: 'go-app',
    name: 'Go App',
    emoji: '🐹',
    description: 'Go module starter',
    kind: 'go',
    files: {
      'go.mod': `module example.com/myapp\n\ngo 1.21`,
      'main.go': `package main

import "fmt"

func main() {
    fmt.Println("Hello from Forge!")
}`,
    },
  },
  {
    id: 'rust-app',
    name: 'Rust App',
    emoji: '🦀',
    description: 'Rust crate starter',
    kind: 'rust',
    files: {
      'Cargo.toml': `[package]
name = "my-app"
version = "0.1.0"
edition = "2021"

[dependencies]`,
      'src/main.rs': `fn main() {
    println!("Hello from Forge!");
}`,
    },
  },
  {
    id: 'docker-app',
    name: 'Docker App',
    emoji: '🐳',
    description: 'Dockerized Node.js app',
    kind: 'node',
    files: {
      'Dockerfile': `FROM node:18-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]`,
      'package.json': `{"name":"docker-app","version":"1.0.0","scripts":{"start":"node server.js"},"dependencies":{"express":"^4.18.0"}}`,
      'server.js': `const express = require('express');
const app = express();
app.get('/', (req, res) => res.json({ hello: 'Forge' }));
app.listen(3000);`,
    },
  },
];
