## TECHAM agent 데스크톱 앱 개발

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

## 빌드 파일 뽑는 방법
코드 번역(Vite)을 먼저 한번 해주고
```bash
$ npm run build
```

애플 서명(도장)을 완벽하게 무시하고, 강제로 Mac용(M1/M2/M3) dmg를 뽑아내는 명령어!
```bash
$ npx electron-builder --mac --arm64 -c.mac.identity=null
```
