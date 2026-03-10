# Boaventura Estoque — App Mobile

App React Native / Expo que compartilha o mesmo Supabase do sistema web.

---

## Pré-requisitos

- Node.js 20+
- Expo CLI: `npm install -g expo-cli`
- EAS CLI: `npm install -g eas-cli`
- Conta EAS (expo.dev) vinculada ao projeto

---

## Setup local

```bash
# 1. Instalar dependências
npm install

# 2. Criar o arquivo de variáveis de ambiente
cp .env.example .env
# → Edite .env com a URL e anon key do seu projeto Supabase

# 3. Rodar no simulador / expo go
npm start
# ou direto no Android:
npm run android
```

---

## Build para Google Play Store

### 1. Configurar EAS

```bash
eas login
eas build:configure   # cria eas.json se não existir
```

### 2. Gerar build de produção (.aab)

```bash
npm run build:production
# equivale a: eas build --platform android --profile production
```

O arquivo `.aab` gerado pode ser enviado diretamente para o Google Play Console
(aba "Versões de produção" → "Criar nova versão").

### 3. Submissão automática (opcional)

```bash
# Requer google-play-service-account.json configurado no eas.json
npm run submit:production
```

---

## Estrutura de diretórios

```
app/
  _layout.tsx          → Layout raiz + AuthGuard
  (auth)/
    _layout.tsx
    login.tsx           → Tela de login
  (tabs)/
    _layout.tsx         → Bottom tab navigator (respeita roles)
    abastecimento.tsx   → Módulo 1: Abastecimento / Retirada
    contagem.tsx        → Módulo 2: Contagem de Estoque

context/
  AuthContext.tsx       → Sessão + permissões via JWT custom claims

lib/
  supabase.ts           → Cliente Supabase com SecureStore (PKCE)
  types.ts              → Tipos compartilhados
```

---

## Roles e permissões

| Role (JWT)      | Abastecimento | Contagem |
|-----------------|:---:|:---:|
| administrador   | ✅  | ✅  |
| operador        | ✅  | ✅  |
| visualizador    | ✅  | ❌  |

---

## Notas importantes

- O campo `updated_by` é preenchido com o `user.id` do usuário logado,
  permitindo que o módulo de Contagem detecte se a contagem foi feita
  por outro usuário.
- A trigger `fn_sync_vasilhame_movimentos` no Supabase atualiza os
  vasilhames automaticamente — o app não precisa fazer isso manualmente.
- O fluxo PKCE (`flowType: "pkce"`) é obrigatório para React Native.
- Tokens são armazenados via `expo-secure-store` (keychain no Android/iOS).
