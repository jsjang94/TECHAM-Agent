// src/main/credentials.ts
// 자격증명의 단일 소유자 (main 전용). 렌더러는 키를 절대 되읽지 않는다.
// 설정 코드(base64 JSON)를 받아 safeStorage로 암호화해 디스크에 저장하고,
// 복호화본을 이 모듈 메모리에만 보관한다. Atlassian/Zendesk 인증 헤더는
// 네트워크 없이 로컬에서 조립한다(기존 프록시가 하던 것과 동일 포맷).
import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

export interface Credentials {
  geminiApiKey: string
  atlassianBaseUrl: string
  atlassianEmail: string
  atlassianToken: string
  zendeskSubdomain: string
  zendeskEmail: string
  zendeskToken: string
}

const REQUIRED_FIELDS: (keyof Credentials)[] = [
  'geminiApiKey', 'atlassianBaseUrl', 'atlassianEmail', 'atlassianToken',
  'zendeskSubdomain', 'zendeskEmail', 'zendeskToken'
]

let creds: Credentials | null = null

const credentialsPath = (): string => join(app.getPath('userData'), 'credentials.enc')

// 앱 시작 시 best-effort 로드. 파일이 없거나 복호화 실패 시 조용히 미설정 상태 유지.
export function loadCredentials(): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[Credentials] safeStorage 암호화를 사용할 수 없습니다(예: Linux 키링 부재). 저장/로드가 불가할 수 있습니다.')
      return
    }
    const path = credentialsPath()
    if (!existsSync(path)) return
    const encrypted = readFileSync(path)
    const json = safeStorage.decryptString(encrypted)
    const parsed = JSON.parse(json) as Credentials
    if (REQUIRED_FIELDS.every((f) => typeof parsed[f] === 'string' && parsed[f])) {
      creds = parsed
      console.log('[Credentials] 로컬 자격증명 로드 완료')
    }
  } catch (err: any) {
    console.error(`[Credentials] 로드 실패: ${err.message}`)
  }
}

// 설정 코드(base64 JSON) 저장. 성공 시 메모리에 즉시 반영.
export function saveCredentials(setupCode: string): { success: boolean; error?: string } {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return { success: false, error: '이 환경에서는 보안 저장소(safeStorage)를 사용할 수 없습니다.' }
    }
    let parsed: Credentials
    try {
      parsed = JSON.parse(Buffer.from(setupCode.trim(), 'base64').toString('utf8'))
    } catch {
      return { success: false, error: '설정 코드 형식이 올바르지 않습니다. (base64 디코딩 실패)' }
    }
    const missing = REQUIRED_FIELDS.filter((f) => typeof parsed[f] !== 'string' || !parsed[f].trim())
    if (missing.length > 0) {
      return { success: false, error: `설정 코드에 누락된 값이 있습니다: ${missing.join(', ')}` }
    }
    // 정규화: baseUrl 끝 슬래시 제거, 값 trim
    const normalized: Credentials = {
      geminiApiKey: parsed.geminiApiKey.trim(),
      atlassianBaseUrl: parsed.atlassianBaseUrl.trim().replace(/\/$/, ''),
      atlassianEmail: parsed.atlassianEmail.trim(),
      atlassianToken: parsed.atlassianToken.trim(),
      zendeskSubdomain: parsed.zendeskSubdomain.trim(),
      zendeskEmail: parsed.zendeskEmail.trim(),
      zendeskToken: parsed.zendeskToken.trim()
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(normalized))
    writeFileSync(credentialsPath(), encrypted)
    creds = normalized
    console.log('[Credentials] 자격증명 저장 완료')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: `저장 중 오류: ${err.message}` }
  }
}

export function hasCredentials(): boolean {
  return creds !== null
}

function require(): Credentials {
  if (!creds) throw new Error('자격증명이 설정되지 않았습니다. 설정 코드를 먼저 등록하세요.')
  return creds
}

export function getGeminiApiKey(): string {
  return require().geminiApiKey
}

// 프록시 proxy.js 48행과 동일: Basic base64(email:token), baseUrl은 저장된 값.
export function getAtlassianAuth(): { authHeader: string; baseUrl: string } {
  const c = require()
  const auth = Buffer.from(`${c.atlassianEmail}:${c.atlassianToken}`).toString('base64')
  return { authHeader: `Basic ${auth}`, baseUrl: c.atlassianBaseUrl }
}

// 프록시 proxy.js 63·66행과 동일: Basic base64(email/token:token), baseUrl은 subdomain 조합.
export function getZendeskAuth(): { authHeader: string; baseUrl: string } {
  const c = require()
  const auth = Buffer.from(`${c.zendeskEmail}/token:${c.zendeskToken}`).toString('base64')
  return { authHeader: `Basic ${auth}`, baseUrl: `https://${c.zendeskSubdomain}.zendesk.com` }
}
