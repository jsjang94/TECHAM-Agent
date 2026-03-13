import { app, BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

function createWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize

  // 시작 크기는 캐릭터 크기(250x250) 고정
  const initialSize = 250

  const mainWindow = new BrowserWindow({
    width: initialSize,
    height: initialSize,
    x: Math.floor((width - initialSize) / 2),
    y: Math.floor(height - initialSize),
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => { mainWindow.show() })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 창 크기 다이나믹 리사이징
  ipcMain.on('resize-window', (event, targetWidth, targetHeight) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const x = Math.floor((width - targetWidth) / 2)
    const y = Math.floor(height - targetHeight)
    win.setBounds({ x, y, width: targetWidth, height: targetHeight })
  })
}

app.whenReady().then(() => {
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  createWindow()

  // MCP 서버 연결 (환경변수 PATH 유지)
  // MCP 서버 연결 (환경변수 PATH 유지 및 Atlassian 인증 규격 맞춤)
  ipcMain.handle('connect-mcp', async (event, config) => {
    try {
      const envPath = process.env.PATH || process.env.Path || '';
      
      // 🌟 [핵심] URL에서 Atlassian Site Name만 영리하게 추출 (예: https://my-team.atlassian.net/wiki -> my-team)
      let siteName = config.confUrl || '';
      try {
        if (siteName.includes('atlassian.net')) {
          const urlObj = new URL(siteName.startsWith('http') ? siteName : `https://${siteName}`);
          siteName = urlObj.hostname.split('.')[0];
        } else {
          // 사용자가 'my-team' 처럼 이름만 넣었을 경우를 대비
          siteName = siteName.replace(/\/.*$/, '');
        }
      } catch (e) {
        console.error("URL 파싱 에러:", e);
      }

      const transport = new StdioClientTransport({
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: ['-y', '@aashari/mcp-server-atlassian-confluence'], 
        env: {
          ...process.env,
          PATH: envPath,
          // 🌟 [수정됨] React에서 넘어온 정확한 키값과 Atlassian 전용 환경변수명 완벽 매칭
          ATLASSIAN_SITE_NAME: siteName,
          ATLASSIAN_USER_EMAIL: config.confEmail,
          ATLASSIAN_API_TOKEN: config.confToken
        }
      })
      
      const client = new Client({ name: "hive-agent", version: "1.0.0" }, { capabilities: {} })
      await client.connect(transport)
      
      ;(global as any).mcpClient = client
      const tools = await client.listTools()
      return { success: true, tools: tools.tools }
    } catch (error: any) {
      console.error("MCP 연결 에러:", error)
      return { success: false, error: error.message }
    }
  })

  // MCP 도구 실행 요청 처리
  ipcMain.handle('call-mcp', async (event, name, args) => {
    const client = (global as any).mcpClient
    if (!client) throw new Error("MCP Server가 연결되지 않았습니다.")
    const result = await client.callTool({ name, arguments: args })
    return result.content
  })
})