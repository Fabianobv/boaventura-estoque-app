/**
 * app/(tabs)/_layout.tsx — Navegação por abas
 */
import { Tabs, Redirect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { TouchableOpacity, StyleSheet } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useAuth } from "@/context/AuthContext"
import { emitSync } from "@/lib/syncEvent"

const BLUE = "#1e3a5f"
const GRAY = "#94a3b8"

export default function TabsLayout() {
  const { session, permissions } = useAuth()
  const insets = useSafeAreaInsets()

  if (!session) return <Redirect href="/(auth)/login" />

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: BLUE,
        tabBarInactiveTintColor: GRAY,
        tabBarStyle: {
          backgroundColor: "#fff",
          borderTopColor: "#e2e8f0",
          paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          height: 60 + (insets.bottom > 0 ? insets.bottom : 8),
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        headerStyle: { backgroundColor: BLUE },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "700", fontSize: 17 },
        headerRight: () => (
          <TouchableOpacity onPress={emitSync} style={styles.headerBtn}>
            <Ionicons name="sync-outline" size={22} color="#fff" />
          </TouchableOpacity>
        ),
      }}>

      {/* Rota index (redirect) — oculta na barra */}
      <Tabs.Screen name="index" options={{ href: null }} />

      {/* Aba 1: Abastecimento / Retirada */}
      <Tabs.Screen
        name="abastecimento"
        options={{
          title: "Abastecimento",
          tabBarLabel: "Abastec.",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="swap-vertical-outline" color={color} size={size} />
          ),
          href: permissions?.canAbastecimento !== false ? undefined : null,
        }}
      />

      {/* Aba 2: Contagem de Estoque */}
      <Tabs.Screen
        name="contagem"
        options={{
          title: "Contagem de Estoque",
          tabBarLabel: "Contagem",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="clipboard-outline" color={color} size={size} />
          ),
          href: permissions?.canContagem ? undefined : null,
        }}
      />

      {/* Aba 3: Perfil do Usuário */}
      <Tabs.Screen
        name="perfil"
        options={{
          title: "Meu Perfil",
          tabBarLabel: "Perfil",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  headerBtn: { paddingHorizontal: 16, paddingVertical: 8 },
})
