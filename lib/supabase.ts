/**
 * lib/supabase.ts
 *
 * Inicialização do cliente Supabase para React Native.
 *
 * Diferença chave em relação ao sistema web:
 *   - Web usa  sessionStorage (token some ao fechar a aba)
 *   - Mobile usa SecureStore (token persiste com segurança no keychain)
 *
 * O ExpoSecureStoreAdapter implementa a interface Storage esperada
 * pelo Supabase Auth para guardar a sessão de forma persistente.
 */
import "react-native-url-polyfill/auto"
import * as SecureStore from "expo-secure-store"
import { createClient } from "@supabase/supabase-js"

// ─── Adapter: SecureStore como storage do Supabase Auth ───────────
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
}

// ─── Variáveis de ambiente ─────────────────────────────────────────
// Lidas do .env em desenvolvimento; fallback hardcoded para builds EAS.
// A anon key é uma chave pública (protegida por RLS no Supabase).
const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  "https://nlkyisvvcfkkkrrititr.supabase.co"

const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sa3lpc3Z2Y2Zra2tycml0aXRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5Njk3NzEsImV4cCI6MjA4ODU0NTc3MX0.qY9vTsMXvOmPvx7AcmL4kRHzhbei0a2UQPvvZgNzQ6o"

// ─── Cliente Supabase ──────────────────────────────────────────────
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // não aplicável no mobile (sem browser URL)
    flowType: "pkce",          // mesmo fluxo PKCE do sistema web
  },
})
