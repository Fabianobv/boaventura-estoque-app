/**
 * app/_layout.tsx — Layout raiz do Expo Router
 *
 * Responsabilidades:
 *  1. Envolve toda a aplicação com AuthProvider
 *  2. Aguarda o carregamento da sessão persisted (SecureStore)
 *  3. Redireciona automaticamente para /login ou /(tabs) conforme estado de auth
 */
import { useEffect } from "react"
import { Stack, useRouter, useSegments } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { AuthProvider, useAuth } from "@/context/AuthContext"

// Impede a splash de esconder automaticamente
SplashScreen.preventAutoHideAsync().catch(() => {})

// ─── Guard de autenticação ─────────────────────────────────────────
function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const router   = useRouter()
  const segments = useSegments()

  useEffect(() => {
    if (loading) return

    // Esconde a splash screen
    SplashScreen.hideAsync().catch(() => {})

    const inAuthGroup = segments[0] === "(auth)"

    if (!session && !inAuthGroup) {
      router.replace("/(auth)/login")
    } else if (session && inAuthGroup) {
      router.replace("/(tabs)")
    }
  }, [session, loading, segments, router])

  // Sempre renderiza children (Stack) — a splash nativa cobre tudo durante loading
  return <>{children}</>
}

// ─── Layout raiz ───────────────────────────────────────────────────
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <AuthGuard>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
          </Stack>
        </AuthGuard>
      </AuthProvider>
    </SafeAreaProvider>
  )
}
