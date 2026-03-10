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
// Defina no arquivo .env (e configure no EAS como secrets de build)
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Variáveis EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY " +
    "devem estar definidas no arquivo .env"
  )
}

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
