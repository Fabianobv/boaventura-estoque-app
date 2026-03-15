/**
 * app/_layout.tsx — Layout raiz do Expo Router
 *
 * Responsabilidades:
 *  1. Envolve toda a aplicação com AuthProvider
 *  2. Aguarda o carregamento da sessão persisted (SecureStore)
 *  3. Redireciona automaticamente para /login ou /(tabs) conforme estado de auth
 *
 * IMPORTANTE: O <Stack> DEVE ser renderizado sempre (mesmo durante loading)
 * para que o expo-router considere a navegação pronta e esconda a splash screen.
 */
import { useEffect } from "react"
import { Stack, useRouter, useSegments } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { AuthProvider, useAuth } from "@/context/AuthContext"

// Impede a splash de esconder automaticamente — nós controlamos
SplashScreen.preventAutoHideAsync().catch(() => {})

// ─── Guard de autenticação ─────────────────────────────────────────
function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const router   = useRouter()
  const segments = useSegments()

  // Esconde a splash screen assim que o loading terminar
  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync().catch(() => {})
    }
  }, [loading])

  useEffect(() => {
    if (loading) return

    const inAuthGroup = segments[0] === "(auth)"

    if (!session && !inAuthGroup) {
      // Não autenticado → vai para login
      router.replace("/(auth)/login")
    } else if (session && inAuthGroup) {
      // Já autenticado → vai para as tabs
      router.replace("/(tabs)")
    }
  }, [session, loading, segments, router])

  // Sempre renderiza o children (Stack) para que o expo-router
  // considere a navegação pronta. A splash screen nativa cobre tudo
  // enquanto loading=true, então não precisa de spinner adicional.
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
