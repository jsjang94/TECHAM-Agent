#!/usr/bin/env node
// 설정 코드 생성기 (관리자 1회 실행용)
//
// 사용법:
//   node scripts/make-setup-code.mjs [path]
//
//   path 가 .env 형식이면(예: ~/techam-proxy/.env.local) 프록시 환경변수 이름을 매핑하고,
//   .json 이면 아래 7개 필드를 그대로 읽는다. 인자를 생략하면 ./keys.json 을 찾는다.
//
//   keys.json 예시:
//   {
//     "geminiApiKey": "...",
//     "atlassianBaseUrl": "https://xxx.atlassian.net",
//     "atlassianEmail": "admin@company.com",
//     "atlassianToken": "ATATT...",
//     "zendeskSubdomain": "com2us",
//     "zendeskEmail": "agent@company.com",
//     "zendeskToken": "..."
//   }
//
// 출력된 "설정 코드"를 각 팀원에게 아웃오브밴드(1회성)로 전달 → 앱 최초 설정 화면에 붙여넣기.

import { readFileSync, existsSync } from 'fs'

const REQUIRED = [
  'geminiApiKey', 'atlassianBaseUrl', 'atlassianEmail', 'atlassianToken',
  'zendeskSubdomain', 'zendeskEmail', 'zendeskToken'
]

// 프록시 .env.local 변수명 → 설정 코드 필드명 매핑
const ENV_MAP = {
  GEMINI_API_KEY: 'geminiApiKey',
  ATLASSIAN_BASE_URL: 'atlassianBaseUrl',
  ATLASSIAN_ADMIN_EMAIL: 'atlassianEmail',
  ATLASSIAN_TOKEN: 'atlassianToken',
  ZENDESK_SUBDOMAIN: 'zendeskSubdomain',
  ZENDESK_ADMIN_EMAIL: 'zendeskEmail',
  ZENDESK_TOKEN: 'zendeskToken'
}

const parseDotenv = (text) => {
  const out = {}
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (ENV_MAP[key]) out[ENV_MAP[key]] = val
  }
  return out
}

const path = process.argv[2] || 'keys.json'
if (!existsSync(path)) {
  console.error(`파일을 찾을 수 없습니다: ${path}`)
  console.error('사용법: node scripts/make-setup-code.mjs <keys.json | .env.local 경로>')
  process.exit(1)
}

const text = readFileSync(path, 'utf8')
const isEnv = /\.env(\.|$)/.test(path) || (!text.trimStart().startsWith('{') && text.includes('='))
const values = isEnv ? parseDotenv(text) : JSON.parse(text)

const missing = REQUIRED.filter((f) => typeof values[f] !== 'string' || !values[f].trim())
if (missing.length > 0) {
  console.error(`누락된 값: ${missing.join(', ')}`)
  process.exit(1)
}

const payload = {}
for (const f of REQUIRED) payload[f] = values[f].trim()
payload.atlassianBaseUrl = payload.atlassianBaseUrl.replace(/\/$/, '')

const setupCode = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')

console.log('\n===== 설정 코드 (앱 최초 설정 화면에 붙여넣기) =====\n')
console.log(setupCode)
console.log('\n===================================================')
console.log('⚠️  이 코드는 모든 키를 담고 있습니다. 아웃오브밴드(1회성)로만 전달하고 공유 문서/채널에 남기지 마세요.\n')
