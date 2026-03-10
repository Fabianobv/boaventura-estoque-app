# Guia — Primeiro Build APK (EAS)

> Pré-requisito: Node.js 20+ instalado na sua máquina.

---

## 1. Instalar ferramentas globais

```bash
npm install -g expo-cli eas-cli
```

---

## 2. Fazer login no Expo

```bash
eas login
# Informe o e-mail e senha da sua conta em expo.dev
# (crie gratuitamente em https://expo.dev/signup se não tiver)
```

---

## 3. Configurar o projeto no EAS

Dentro da pasta `boaventura-estoque-app`:

```bash
eas build:configure
# Responda "Y" para tudo — ele vai linkar o projeto à sua conta Expo
# Isso cria/atualiza o campo "projectId" no app.json automaticamente
```

---

## 4. Criar o arquivo `.env`

```bash
cp .env.example .env
```

Edite o `.env` com os valores do seu projeto Supabase
(Dashboard → Project Settings → API):

```
EXPO_PUBLIC_SUPABASE_URL=https://nlkyisvvcfkkkrrititr.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<sua anon key>
```

---

## 5. Build de Preview (APK para instalar direto)

```bash
eas build --platform android --profile preview
```

- O EAS compila na nuvem (não precisa de Android Studio instalado)
- Duração: ~10–15 minutos na primeira vez
- Ao final, você recebe um link para baixar o `.apk`
- Instale no celular Android via o link ou QR code

---

## 6. Build de Produção (AAB para a Play Store)

```bash
eas build --platform android --profile production
```

- Gera um `.aab` (Android App Bundle)
- Envie no Google Play Console → Versões de produção → Criar nova versão

---

## Verificar status dos builds

```bash
eas build:list
```

Ou acesse: https://expo.dev/accounts/[seu-usuario]/projects/boaventura-estoque

---

## Dica: Assets finais

Os arquivos em `assets/images/` são placeholders (logo "B" simples).
Antes do build de produção, substitua por:

| Arquivo              | Tamanho     | Uso                          |
|----------------------|-------------|------------------------------|
| `icon.png`           | 1024×1024   | Ícone do app (Android/iOS)   |
| `adaptive-icon.png`  | 1024×1024   | Ícone adaptativo Android     |
| `splash.png`         | 1284×2778   | Tela de splash screen        |
| `favicon.png`        | 32×32       | Web (Expo web)               |

---

## Troubleshooting comum

**Erro: "Project not found"**
→ Rode `eas build:configure` para linkar o projeto.

**Erro: "Missing EXPO_PUBLIC_SUPABASE_URL"**
→ Verifique o `.env` na raiz do projeto.

**Erro: "Android keystore not found"**
→ Na primeira vez, o EAS gera e armazena o keystore automaticamente. Responda "Y" quando perguntado.

**Build falha em "Installing packages"**
→ Verifique o `package.json` e rode `npm install` localmente para garantir que as dependências estão corretas.
