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
import { StatusBar } from "expo-status-bar"
import { View, ActivityIndicator, StyleSheet } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { AuthProvider, useAuth } from "@/context/AuthContext"

// ─── Guard de autenticação ─────────────────────────────────────────
function AuthGuard() {
  const { session, loading } = useAuth()
  const router   = useRouter()
  const segments = useSegments()

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

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#1e3a5f" />
      </View>
    )
  }

  return null
}

// ─── Layout raiz ───────────────────────────────────────────────────
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AuthGuard />
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8fafc",
  },
})
